import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { type ProviderDraft, providerDraftSchema, providerFieldMapSchema } from '@nn-anime/core'
import { assertConforms, type CallOptions, type Provider } from '@nn-anime/provider-sdk'
import { pluginFileName, renderProviderModule } from './provider-template'

/**
 * El generador se prueba ejecutando lo que genera.
 *
 * Comparar el texto con una cadena esperada comprobaría que el archivo no cambió,
 * no que funcione: un plugin puede tener el texto perfecto y devolver basura. Aquí
 * el archivo se escribe en un directorio temporal, se importa de verdad y se le
 * llaman los métodos, con `fetch` interceptado. Es lo mismo que hará la
 * aplicación, sin red de por medio.
 */

function draft(overrides: Partial<ProviderDraft> = {}): ProviderDraft {
  return providerDraftSchema.parse({
    id: 'mio',
    name: 'Mío',
    baseUrl: 'https://e.example',
    capabilities: { search: true, sub: true, dub: false, trending: false },
    endpoints: {
      search: '/buscar?q={query}',
      anime: '/anime/{ref}',
      episodes: '/anime/{ref}/episodios',
      stream: '/ver/{ref}',
    },
    fields: providerFieldMapSchema.parse({}),
    ...overrides,
  })
}

const CALL: CallOptions = { signal: new AbortController().signal, timeoutMs: 1000 }

/** Escribe el módulo, lo importa y devuelve lo que el proveedor devuelva. */
async function withProvider<T>(
  source: string,
  body: (provider: Provider) => Promise<T> | T,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-plugin-'))
  const file = join(dir, 'generado.ts')
  await writeFile(file, source)

  try {
    const module = (await import(pathToFileURL(file).href)) as { default: Provider }

    return await body(module.default)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** `fetch` interceptado, con la URL en la mano de quien decide qué contestar. */
function stubFetch(
  respond: (url: string) => { readonly status?: number; readonly body: unknown },
): () => void {
  const original = globalThis.fetch

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const { status = 200, body } = respond(url)

    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  return () => {
    globalThis.fetch = original
  }
}

describe('el texto generado', () => {
  test('es determinista: la misma descripción da el mismo archivo', () => {
    const descripcion = draft()

    expect(renderProviderModule(descripcion)).toBe(renderProviderModule(descripcion))
  })

  test('lleva el identificador y el nombre', () => {
    const source = renderProviderModule(draft({ id: 'mi-fuente', name: 'Mi fuente' }))

    expect(source).toContain('const ID = "mi-fuente"')
    expect(source).toContain('const NAME = "Mi fuente"')
    expect(source).toContain('Proveedor «Mi fuente» (mi-fuente)')
  })

  test('no importa nada en tiempo de ejecución', () => {
    const source = renderProviderModule(draft())

    // Un plugin vive fuera del proyecto: un import de valor no se podría resolver.
    expect(source).toContain('import type { CallOptions, Provider, SearchResult } from')
    expect(source).not.toMatch(/^import (?!type)/m)
  })

  test('un nombre que intenta cerrar el comentario no lo cierra', () => {
    const source = renderProviderModule(draft({ name: '*/ const malo = 1; //' }))

    // El primer cierre de comentario es el del preámbulo: el nombre quedó como
    // texto dentro (`* /`) y el `import` que viene después sigue siendo código.
    expect(source.indexOf('*/')).toBeLessThan(source.indexOf('import type'))
    expect(source).toContain('Proveedor «* / const malo')
    // El nombre se conserva tal cual en su literal: ahí `*/` es texto citado.
    expect(source).toContain('const NAME = "*/ const malo = 1; //"')
  })

  test('un nombre con salto de línea no parte el comentario', () => {
    const source = renderProviderModule(draft({ name: 'dos\nlineas' }))

    expect(source).toContain('Proveedor «dos lineas» (mio)')
  })

  test('el nombre del archivo es el identificador más la extensión', () => {
    expect(pluginFileName('mi-fuente')).toBe('mi-fuente.ts')
  })
})

describe('lo que el plugin generado hace', () => {
  test('conforma el contrato', async () => {
    await withProvider(renderProviderModule(draft()), (provider) => {
      const resultado = assertConforms(provider)

      expect(resultado.ok).toBe(true)
      if (!resultado.ok) throw new Error(resultado.error.message)
    })
  })

  test('la búsqueda pide su ruta y traduce las filas', async () => {
    const urls: string[] = []
    const restore = stubFetch((url) => {
      urls.push(url)

      return {
        body: {
          datos: [
            { id: 'a1', titulo: 'Uno' },
            { id: 'a2', titulo: 'Dos' },
          ],
        },
      }
    })

    try {
      await withProvider(
        renderProviderModule(
          draft({
            fields: {
              ...providerFieldMapSchema.parse({}),
              searchItems: 'datos',
              searchId: 'id',
              searchTitle: 'titulo',
            },
          }),
        ),
        async (provider) => {
          const results = await provider.search('uno dos', CALL)

          expect(results).toEqual([
            { ref: { providerId: 'mio', value: 'a1' }, title: 'Uno' },
            { ref: { providerId: 'mio', value: 'a2' }, title: 'Dos' },
          ])
        },
      )
    } finally {
      restore()
    }

    // El marcador se sustituye codificado, no en crudo.
    expect(urls[0]).toBe('https://e.example/buscar?q=uno%20dos')
  })

  test('una fila sin identificador o sin título se descarta en vez de romper', async () => {
    const restore = stubFetch(() => ({
      body: [{ id: 'a1', title: 'Uno' }, { id: 'a2' }, 'basura'],
    }))

    try {
      await withProvider(renderProviderModule(draft()), async (provider) => {
        expect(await provider.search('x', CALL)).toEqual([
          { ref: { providerId: 'mio', value: 'a1' }, title: 'Uno' },
        ])
      })
    } finally {
      restore()
    }
  })

  test('la ruta de una cadena vacía también se resuelve', async () => {
    const urls: string[] = []
    const restore = stubFetch((url) => {
      urls.push(url)

      return { body: [] }
    })

    try {
      await withProvider(renderProviderModule(draft()), async (provider) => {
        await provider.search('x', CALL)
      })
    } finally {
      restore()
    }

    expect(urls[0]?.startsWith('https://e.example/')).toBe(true)
  })

  test('el detalle rellena géneros y estudios, que es lo que puntúa el recomendador', async () => {
    const restore = stubFetch(() => ({
      body: { title: 'Una obra', genres: ['Acción', ''], studios: ['Estudio'] },
    }))

    try {
      await withProvider(renderProviderModule(draft()), async (provider) => {
        const detalle = await provider.getAnime({ providerId: 'mio', value: 'a1' }, CALL)

        expect(detalle.title).toBe('Una obra')
        expect(detalle.genres).toEqual(['Acción'])
        expect(detalle.studios).toEqual(['Estudio'])
      })
    } finally {
      restore()
    }
  })

  test('sin título en el detalle se usa la referencia, que algo hay que enseñar', async () => {
    const restore = stubFetch(() => ({ body: {} }))

    try {
      await withProvider(renderProviderModule(draft()), async (provider) => {
        const detalle = await provider.getAnime({ providerId: 'mio', value: 'a1' }, CALL)

        expect(detalle.title).toBe('a1')
        expect(detalle.genres).toEqual([])
      })
    } finally {
      restore()
    }
  })

  test('los episodios sin número se numeran por su posición', async () => {
    const restore = stubFetch(() => ({ body: [{ title: 'Piloto' }, { number: '7' }] }))

    try {
      await withProvider(renderProviderModule(draft()), async (provider) => {
        const episodios = await provider.getEpisodes({ providerId: 'mio', value: 'a1' }, CALL)

        expect(episodios).toEqual([
          {
            ref: { providerId: 'mio', value: 'a1#1' },
            animeRef: { providerId: 'mio', value: 'a1' },
            number: 1,
            mode: 'sub',
            title: 'Piloto',
          },
          {
            ref: { providerId: 'mio', value: 'a1#7' },
            animeRef: { providerId: 'mio', value: 'a1' },
            number: 7,
            mode: 'sub',
          },
        ])
      })
    } finally {
      restore()
    }
  })

  test('una sola fuente de video se envuelve en una lista de una', async () => {
    const restore = stubFetch(() => ({ body: { url: '/v/1.m3u8' } }))

    try {
      await withProvider(renderProviderModule(draft()), async (provider) => {
        const fuentes = await provider.resolveStream(
          { episodeRef: { providerId: 'mio', value: 'a1#1' }, mode: 'sub' },
          CALL,
        )

        // La URL relativa del sitio se resuelve contra su dirección base: el proxy
        // recibe algo absoluto, que es lo único que puede pedir.
        expect(fuentes).toEqual([{ url: 'https://e.example/v/1.m3u8', kind: 'hls' }])
      })
    } finally {
      restore()
    }
  })

  test('un `kind` distinto de `file` es `hls`', async () => {
    const restore = stubFetch(() => ({ body: [{ url: 'https://c.example/v.mp4', kind: 'FILE' }] }))

    try {
      await withProvider(renderProviderModule(draft()), async (provider) => {
        const fuentes = await provider.resolveStream(
          { episodeRef: { providerId: 'mio', value: 'a1#1' }, mode: 'sub' },
          CALL,
        )

        expect(fuentes).toEqual([{ url: 'https://c.example/v.mp4', kind: 'hls' }])
      })
    } finally {
      restore()
    }
  })

  test('un error del sitio se lanza, para que el SDK lo convierta en Result', async () => {
    const restore = stubFetch(() => ({ status: 500, body: { error: 'boom' } }))

    try {
      await withProvider(renderProviderModule(draft()), async (provider) => {
        await expect(provider.search('x', CALL)).rejects.toThrow('500')
      })
    } finally {
      restore()
    }
  })

  test('sin ruta de tendencias no se declara el método', async () => {
    await withProvider(renderProviderModule(draft()), (provider) => {
      expect(provider.getTrending).toBeUndefined()
      expect(provider.capabilities.trending).toBe(false)
    })
  })

  test('con ruta de tendencias, el método devuelve resultados', async () => {
    const restore = stubFetch(() => ({ body: [{ id: 'a1', title: 'Uno' }] }))

    try {
      await withProvider(
        renderProviderModule(
          draft({
            capabilities: { search: true, sub: true, dub: false, trending: true },
            endpoints: {
              search: '/buscar?q={query}',
              anime: '/anime/{ref}',
              episodes: '/anime/{ref}/episodios',
              stream: '/ver/{ref}',
              trending: '/top',
            },
          }),
        ),
        async (provider) => {
          expect(await provider.getTrending?.(CALL)).toEqual([
            { ref: { providerId: 'mio', value: 'a1' }, title: 'Uno' },
          ])
        },
      )
    } finally {
      restore()
    }
  })
})
