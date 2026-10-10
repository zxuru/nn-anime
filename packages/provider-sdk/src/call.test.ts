import { describe, expect, test } from 'bun:test'
import { getAnime, getEpisodes, getTrending, resolveStream, search } from './call'
import { createRegistry } from './registry'
import type { CallOptions, Provider } from './types'

const REF = { providerId: 'fixture', value: 'titulo-1' }

const OPTIONS: CallOptions = { signal: new AbortController().signal, timeoutMs: 8000 }

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'fixture',
    name: 'Fixture',
    apiVersion: '1',
    capabilities: { search: true, sub: true, dub: false, trending: false },
    search: async () => [],
    getAnime: async () => ({ ref: REF, title: 'Un título', genres: [], studios: [] }),
    getEpisodes: async () => [],
    resolveStream: async () => [],
    ...overrides,
  }
}

const RESULT = { ref: REF, title: 'Un título' }

/**
 * Un proveedor registrado a partir de una forma cruda.
 *
 * Se pasa por el registro a propósito: permite escribir métodos que devuelven
 * lo que no deben —un `undefined`, un objeto al que le falta un campo— **sin
 * ninguna conversión de tipo en la prueba**. El registro valida la forma del
 * plugin, no lo que sus métodos devuelven, que es exactamente lo que aquí se
 * quiere probar.
 */
function rawProvider(overrides: Record<string, unknown> = {}): Provider {
  const registry = createRegistry([
    {
      id: 'fixture',
      name: 'Fixture',
      apiVersion: '1',
      capabilities: { search: true, sub: true, dub: false, trending: false },
      search: async () => [],
      getAnime: async () => ({ ref: REF, title: 'Un título', genres: [], studios: [] }),
      getEpisodes: async () => [],
      resolveStream: async () => [],
      ...overrides,
    },
  ])

  const registered = registry.get('fixture')
  if (registered === undefined) throw new Error('el proveedor de prueba no se registró')

  return registered
}

describe('call: la excepción del plugin se convierte en Result', () => {
  test('un search que lanza devuelve un error y no rechaza la promesa', async () => {
    const boom = new Error('el sitio cambió de forma')
    const result = await search(
      provider({
        search: async () => {
          throw boom
        },
      }),
      'naruto',
      OPTIONS,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('fixture')
      expect(result.error.message).toContain('search')
      expect(result.error.message).toContain('el sitio cambió de forma')
      expect(result.error.context.kind).toBe('threw')
      expect(result.error.cause).toBe(boom)
    }
  })

  test('un plugin que lanza algo que no es un Error tampoco escapa', async () => {
    const result = await search(
      provider({
        search: async () => {
          throw 'texto suelto'
        },
      }),
      'naruto',
      OPTIONS,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('texto suelto')
      expect(result.error.context.kind).toBe('threw')
    }
  })

  test('un timeout y una cancelación no se confunden', async () => {
    const timeout = await search(
      provider({
        search: async () => {
          throw new DOMException('se agotó', 'TimeoutError')
        },
      }),
      'naruto',
      OPTIONS,
    )
    const aborted = await search(
      provider({
        search: async () => {
          throw new DOMException('cancelado', 'AbortError')
        },
      }),
      'naruto',
      OPTIONS,
    )

    expect(timeout.ok).toBe(false)
    expect(aborted.ok).toBe(false)
    if (!timeout.ok) expect(timeout.error.context.kind).toBe('timeout')
    if (!aborted.ok) expect(aborted.error.context.kind).toBe('aborted')
  })

  test('la cancelación del usuario se distingue por la señal que se pasó', async () => {
    const controller = new AbortController()
    const result = await search(
      provider({
        search: async (_query, options) => {
          controller.abort()
          throw options.signal.reason
        },
      }),
      'naruto',
      { signal: controller.signal, timeoutMs: 8000 },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.context.kind).toBe('aborted')
  })
})

describe('call: la capacidad declarada manda', () => {
  test('sin capabilities.search no se llama al plugin', async () => {
    let calls = 0
    const quiet = provider({
      capabilities: { search: false, sub: true, dub: false, trending: false },
      search: async () => {
        calls += 1
        return []
      },
    })

    const result = await search(quiet, 'naruto', OPTIONS)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.context.kind).toBe('unsupported')
    expect(calls).toBe(0)
  })

  test('sin capabilities.trending no se llama a getTrending', async () => {
    let calls = 0
    const quiet = provider({
      getTrending: async () => {
        calls += 1
        return []
      },
    })

    const result = await getTrending(quiet, OPTIONS)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.context.kind).toBe('unsupported')
    expect(calls).toBe(0)
  })

  test('con capabilities.trending pero sin método, se responde sin lanzar', async () => {
    const lying = provider({
      capabilities: { search: true, sub: true, dub: false, trending: true },
    })

    const result = await getTrending(lying, OPTIONS)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.context.kind).toBe('unsupported')
  })

  test('con capabilities.trending y método, se devuelve lo validado', async () => {
    const trending = provider({
      capabilities: { search: true, sub: true, dub: false, trending: true },
      getTrending: async () => [RESULT],
    })

    const result = await getTrending(trending, OPTIONS)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual([RESULT])
  })
})

describe('call: la respuesta se valida antes de salir', () => {
  test('un campo que falta se rechaza nombrando el campo', async () => {
    const result = await search(
      rawProvider({ search: async () => [{ ref: REF }] }),
      'naruto',
      OPTIONS,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.context.kind).toBe('invalid-shape')
      expect(result.error.message).toContain('title')
    }
  })

  test('un campo de más también se rechaza, porque los schemas son estrictos', async () => {
    const result = await search(
      provider({ search: async () => [{ ...RESULT, sobra: true }] }),
      'naruto',
      OPTIONS,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('sobra')
  })

  test('un header inválido de un stream se rechaza nombrando el header', async () => {
    const result = await resolveStream(
      provider({
        resolveStream: async () => [
          {
            url: 'https://ejemplo/a.mp4',
            kind: 'file',
            headers: { 'X Malo': 'x' },
          },
        ],
      }),
      { episodeRef: REF, mode: 'sub' },
      OPTIONS,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('X Malo')
  })

  test('un body que no es el tipo prometido no llega a quien llama', async () => {
    const result = await search(rawProvider({ search: async () => undefined }), 'naruto', OPTIONS)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.context.kind).toBe('invalid-shape')
  })

  test('una resolución de stream válida devuelve las cabeceras al consumidor', async () => {
    const source = {
      url: 'https://ejemplo/a.mp4',
      kind: 'file' as const,
      headers: { Referer: 'https://sitio.example' },
    }
    const result = await resolveStream(
      provider({ resolveStream: async () => [source] }),
      { episodeRef: REF, mode: 'sub' },
      OPTIONS,
    )

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value[0]?.headers).toEqual({ Referer: 'https://sitio.example' })
  })
})

describe('call: los otros métodos se comportan igual', () => {
  test('getAnime devuelve el detalle validado', async () => {
    const result = await getAnime(provider(), REF, OPTIONS)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.title).toBe('Un título')
  })

  test('getEpisodes convierte la excepción en error', async () => {
    const result = await getEpisodes(
      provider({
        getEpisodes: async () => {
          throw new Error('sin episodios')
        },
      }),
      REF,
      OPTIONS,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('getEpisodes')
  })

  test('un detalle sin géneros ni estudios se rechaza: el contrato los exige', async () => {
    const result = await getAnime(
      rawProvider({ getAnime: async () => ({ ref: REF, title: 'T' }) }),
      REF,
      OPTIONS,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('genres')
  })
})
