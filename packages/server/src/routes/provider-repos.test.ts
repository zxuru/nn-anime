/**
 * Las rutas de los repositorios, contra un GitHub de mentira y un disco de verdad.
 *
 * No hay cargador falso: el archivo se descarga, se escanea y el loader real lo
 * importa cuando se habilita. Es la única forma de comprobar lo que prometen
 * estas rutas —«instalar no ejecuta nada» y «habilitar lo ejecuta y se ve sin
 * reiniciar»—, porque lo que puede fallar es justo la parte que un doble
 * sustituiría.
 *
 * Y una prueba que sólo se puede hacer así: **actualizar trae el código nuevo**.
 * Bun cachea los módulos por URL, de modo que actualizar sobre la misma carpeta
 * volvería a importar el archivo viejo y el usuario vería que actualizó y no
 * cambió nada. Se mide con dos descargas del mismo archivo con contenidos
 * distintos.
 */

import { describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import {
  type ProviderRepoView,
  providerRepoResponseSchema,
  providerReposResponseSchema,
  providersResponseSchema,
} from '@nn-anime/core'
import type { Resolver } from '@nn-anime/media-proxy'
import { fakeGithub, type GithubFixture, type TreeEntry } from '../__fixtures__/github'
import { type AppOptions, createApp } from '../app'
import { createContainer } from '../container'
import { SESSION_COOKIE, type Session } from '../session'

const PORT = 7717
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const JSON_HEADERS = {
  cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`,
  origin: BASE,
  'content-type': 'application/json',
}
const RESOLVER: Resolver = async () => ['140.82.121.3']
const REPO = 'https://github.com/zxuru/nn-anime-plugins'
const PRIMERA = Date.parse('2026-10-13T10:00:00.000Z')

/** El texto de un proveedor mínimo, con el `id` que se le pida. */
function providerSource(id: string, name = id): string {
  return `const provider = {
  id: ${JSON.stringify(id)},
  name: ${JSON.stringify(name)},
  apiVersion: '1',
  capabilities: { search: true, sub: false, dub: false, trending: false },
  async search() { return [] },
  async getAnime() { return { ref: { providerId: ${JSON.stringify(id)}, value: 'a' }, title: 'A', genres: [], studios: [] } },
  async getEpisodes() { return [] },
  async resolveStream() { return [] },
}

export default provider
`
}

function fakeSession(): Session {
  return {
    cookieName: SESSION_COOKIE,
    value: SESSION_VALUE,
    matches: (candidate) => candidate === SESSION_VALUE,
  }
}

/** El mismo doble, pero con las piezas cambiables: una actualización es eso. */
interface MutableGithub {
  branch?: string
  tree?: readonly TreeEntry[]
  blobs?: Readonly<Record<string, string>>
  truncated?: boolean
  status?: Readonly<Record<string, number>>
}

/** Las carpetas de versión que hay en el disco para un repositorio. */
async function versionEnDisco(dataDir: string): Promise<readonly string[]> {
  const home = join(dataDir, 'repos', 'zxuru__nn-anime-plugins')

  return (await readdir(home)).map((name) => join(home, name))
}

interface Contexto {
  readonly dataDir: string
  readonly pedir: (ruta: string, init?: RequestInit) => Promise<Response>
  readonly instalar: (body: unknown) => Promise<Response>
  readonly seleccionar: (body: unknown) => Promise<Response>
  readonly quitar: (url: string) => Promise<Response>
  /** Los identificadores activos según el server. */
  readonly activos: () => Promise<readonly string[]>
  /** Adelanta el reloj de la descarga: cada descarga estrena carpeta. */
  readonly avanzarReloj: () => void
  readonly existe: (path: string) => Promise<boolean>
}

async function conApp<T>(
  github: GithubFixture,
  body: (contexto: Contexto) => Promise<T>,
  overrides: Partial<AppOptions> = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-repos-'))
  const providersDir = join(dir, 'providers')
  const db = openDb(join(dir, 'nn-anime.db'))
  runMigrations(db)
  const container = createContainer({ db })
  const fake = fakeGithub(github)
  let reloj = PRIMERA

  try {
    const app = createApp({
      port: PORT,
      session: fakeSession(),
      bootToken: 'token',
      version: '0.1.0',
      providersDir,
      container,
      paths: {
        dataDir: dir,
        configDir: dir,
        cacheDir: join(dir, 'cache'),
        providersDir,
        dbPath: join(dir, 'nn-anime.db'),
        configFile: join(dir, 'nn-anime.json'),
      },
      githubFetchImpl: fake.impl,
      githubResolver: RESOLVER,
      githubClock: () => reloj,
      ...overrides,
    })

    const pedir = async (ruta: string, init?: RequestInit): Promise<Response> =>
      await Promise.resolve(app.request(`${BASE}${ruta}`, init ?? { headers: JSON_HEADERS }))

    return await body({
      dataDir: dir,
      pedir,
      instalar: async (payload) =>
        await pedir('/api/provider-repos', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(payload),
        }),
      seleccionar: async (payload) =>
        await pedir('/api/provider-repos', {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify(payload),
        }),
      quitar: async (url) =>
        await pedir(`/api/provider-repos?url=${encodeURIComponent(url)}`, {
          method: 'DELETE',
          headers: JSON_HEADERS,
        }),
      activos: async () => {
        const salida = providersResponseSchema.parse(await (await pedir('/api/providers')).json())

        return salida.providers.filter((it) => it.status === 'active').map((it) => it.id)
      },
      avanzarReloj: () => {
        reloj += 60_000
      },
      existe: (path) =>
        stat(path).then(
          () => true,
          () => false,
        ),
    })
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

async function repoDe(respuesta: Response): Promise<ProviderRepoView> {
  return providerRepoResponseSchema.parse(await respuesta.json()).repo
}

/** El árbol de un repositorio con un proveedor y su texto. */
function simple(id: string): GithubFixture {
  return { tree: [{ path: 'jkanime.ts' }], blobs: { 'jkanime.ts': providerSource(id) } }
}

describe('GET /api/provider-repos', () => {
  test('sin nada instalado devuelve la lista vacía', async () => {
    await conApp({}, async ({ pedir }) => {
      const salida = providerReposResponseSchema.parse(
        await (await pedir('/api/provider-repos')).json(),
      )

      expect(salida.repos).toEqual([])
    })
  })

  test('con el contenido borrado a mano la ficha sigue y dice que falta', async () => {
    await conApp(simple('jkanime'), async ({ instalar, pedir, dataDir, existe }) => {
      await instalar({ url: REPO })
      const dir = join(dataDir, 'repos', 'zxuru__nn-anime-plugins')

      await rm(dir, { recursive: true, force: true })

      const salida = providerReposResponseSchema.parse(
        await (await pedir('/api/provider-repos')).json(),
      )
      const repo = salida.repos[0]

      expect(repo?.present).toBe(false)
      expect(repo?.candidates).toEqual([])
      expect(await existe(dir)).toBe(false)
    })
  })
})

describe('POST /api/provider-repos: instalar no ejecuta nada', () => {
  test('descarga, escanea y deja el repositorio sin ningún archivo habilitado', async () => {
    await conApp(simple('jkanime'), async ({ instalar, activos }) => {
      const respuesta = await instalar({ url: 'zxuru/nn-anime-plugins' })
      const repo = await repoDe(respuesta)

      expect(respuesta.status).toBe(201)
      // La dirección se guarda normalizada, que es la que se compara después.
      expect(repo.url).toBe(REPO)
      expect(repo.ref).toBe('main')
      expect(repo.enabled).toEqual([])
      expect(repo.present).toBe(true)
      expect(repo.candidates.map((c) => c.path)).toEqual(['jkanime.ts'])
      expect(repo.candidates[0]?.id).toBe('jkanime')
      // Lo que se está midiendo: el archivo está en el disco y **no** se cargó.
      expect(await activos()).toEqual([])
    })
  })

  test('una dirección que no es de GitHub no se acepta', async () => {
    await conApp(simple('jkanime'), async ({ instalar }) => {
      const respuesta = await instalar({ url: 'https://gitlab.com/zxuru/nn-anime-plugins' })

      expect(respuesta.status).toBe(400)
      expect(await respuesta.json()).toMatchObject({ error: expect.stringContaining('inválida') })
    })
  })

  test('instalar dos veces el mismo repositorio lo actualiza, no lo duplica', async () => {
    await conApp(simple('jkanime'), async ({ instalar, pedir, avanzarReloj }) => {
      await instalar({ url: REPO })
      avanzarReloj()
      const segunda = await instalar({ url: REPO })
      const salida = providerReposResponseSchema.parse(
        await (await pedir('/api/provider-repos')).json(),
      )

      expect(segunda.status).toBe(200)
      expect(salida.repos).toHaveLength(1)
    })
  })

  test('un fallo de GitHub se cuenta con su motivo', async () => {
    const infoUrl = 'https://api.github.com/repos/zxuru/nn-anime-plugins'

    await conApp({ status: { [infoUrl]: 404 } }, async ({ instalar }) => {
      const respuesta = await instalar({ url: REPO })

      expect(respuesta.status).toBe(502)
      expect(await respuesta.json()).toMatchObject({
        error: expect.stringContaining('no existen'),
      })
    })
  })
})

describe('PATCH /api/provider-repos: habilitar es elegir de una lista', () => {
  test('habilita un archivo y el loader real lo carga sin reiniciar', async () => {
    await conApp(simple('jkanime'), async ({ instalar, seleccionar, activos, pedir }) => {
      await instalar({ url: REPO })
      const respuesta = await seleccionar({ url: REPO, enabled: ['jkanime.ts'] })
      const repo = await repoDe(respuesta)

      expect(respuesta.status).toBe(200)
      expect(repo.enabled).toEqual(['jkanime.ts'])
      expect(await activos()).toEqual(['jkanime'])
      // Y los ajustes ven lo mismo: es el mismo informe.
      expect(await (await pedir('/api/settings')).text()).toContain('jkanime')
    })
  })

  test('una ruta que el escáner no reconoció es un 400, no un archivo que se importa', async () => {
    await conApp(simple('jkanime'), async ({ instalar, seleccionar, activos }) => {
      await instalar({ url: REPO })
      const respuesta = await seleccionar({ url: REPO, enabled: ['../../../etc/passwd'] })

      expect(respuesta.status).toBe(400)
      expect(await respuesta.json()).toMatchObject({
        error: expect.stringContaining('no son proveedores del repositorio'),
      })
      expect(await activos()).toEqual([])
    })
  })

  test('quitar la marca descarga el proveedor: deja de estar activo', async () => {
    await conApp(simple('jkanime'), async ({ instalar, seleccionar, activos }) => {
      await instalar({ url: REPO })
      await seleccionar({ url: REPO, enabled: ['jkanime.ts'] })
      const respuesta = await seleccionar({ url: REPO, enabled: [] })

      expect(respuesta.status).toBe(200)
      expect(await activos()).toEqual([])
    })
  })

  test('un repositorio que no está instalado es un 404 explicable', async () => {
    await conApp(simple('jkanime'), async ({ seleccionar }) => {
      const respuesta = await seleccionar({ url: REPO, enabled: [] })

      expect(respuesta.status).toBe(404)
      expect(await respuesta.json()).toMatchObject({
        error: expect.stringContaining('no hay ningún repositorio'),
      })
    })
  })
})

describe('actualizar un repositorio', () => {
  test('al volver a descargar, la selección se queda con lo que existe', async () => {
    // El doble se lee en cada petición, así que cambiar el árbol por dentro es
    // como cambiar el repositorio en GitHub entre dos descargas.
    const github: MutableGithub = {
      tree: [{ path: 'a.ts' }, { path: 'b.ts' }],
      blobs: { 'a.ts': providerSource('alfa'), 'b.ts': providerSource('beta') },
    }

    await conApp(github, async ({ instalar, seleccionar, activos, avanzarReloj }) => {
      await instalar({ url: REPO })
      await seleccionar({ url: REPO, enabled: ['a.ts', 'b.ts'] })
      expect(await activos()).toEqual(['alfa', 'beta'])

      github.tree = [{ path: 'a.ts' }]
      github.blobs = { 'a.ts': providerSource('alfa') }
      avanzarReloj()

      const repo = await repoDe(await instalar({ url: REPO }))

      expect(repo.candidates.map((c) => c.path)).toEqual(['a.ts'])
      expect(repo.enabled).toEqual(['a.ts'])
      expect(await activos()).toEqual(['alfa'])
    })
  })

  test('el código nuevo de verdad: la misma ruta con otro contenido', async () => {
    const github: MutableGithub = {
      tree: [{ path: 'jkanime.ts' }],
      blobs: { 'jkanime.ts': providerSource('primera') },
    }

    await conApp(github, async ({ instalar, seleccionar, activos, avanzarReloj }) => {
      await instalar({ url: REPO })
      await seleccionar({ url: REPO, enabled: ['jkanime.ts'] })
      expect(await activos()).toEqual(['primera'])

      github.blobs = { 'jkanime.ts': providerSource('segunda') }
      avanzarReloj()
      await instalar({ url: REPO })
      await seleccionar({ url: REPO, enabled: ['jkanime.ts'] })

      // Sin carpeta nueva, el módulo seguiría cacheado y aquí seguiría diciendo
      // «primera»: es la prueba de que actualizar actualiza.
      expect(await activos()).toEqual(['segunda'])
    })
  })

  test('la copia anterior se borra: no se acumulan versiones en el disco', async () => {
    await conApp(simple('jkanime'), async ({ instalar, dataDir, existe, avanzarReloj }) => {
      await instalar({ url: REPO })
      const primera = await versionEnDisco(dataDir)

      avanzarReloj()
      await instalar({ url: REPO })
      const segunda = await versionEnDisco(dataDir)

      expect(primera).toHaveLength(1)
      expect(segunda).toHaveLength(1)
      expect(segunda[0]).not.toBe(primera[0])
      expect(await existe(primera[0] ?? '')).toBe(false)
    })
  })
})

describe('DELETE /api/provider-repos', () => {
  test('quita la ficha, borra el contenido y deja de cargar sus archivos', async () => {
    await conApp(
      simple('jkanime'),
      async ({ instalar, seleccionar, quitar, activos, pedir, existe, dataDir }) => {
        await instalar({ url: REPO })
        await seleccionar({ url: REPO, enabled: ['jkanime.ts'] })
        expect(await activos()).toEqual(['jkanime'])

        const respuesta = await quitar(REPO)

        expect(respuesta.status).toBe(204)
        expect(await activos()).toEqual([])
        expect(await existe(join(dataDir, 'repos', 'zxuru__nn-anime-plugins'))).toBe(false)
        const salida = providerReposResponseSchema.parse(
          await (await pedir('/api/provider-repos')).json(),
        )
        expect(salida.repos).toEqual([])
      },
    )
  })

  test('quitar algo que no está es un 404 explicable', async () => {
    await conApp(simple('jkanime'), async ({ quitar }) => {
      const respuesta = await quitar(REPO)

      expect(respuesta.status).toBe(404)
    })
  })
})
