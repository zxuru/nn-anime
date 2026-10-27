import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import { tmdbMetadataResponseSchema } from '@nn-anime/core'
import { createFixtureProvider, FIXTURE_PROVIDER_ID } from '@nn-anime/providers-fixture'
import { createApp, createContainer } from '../index'
import { TMDB_KEY } from './settings'

const PORT = 7717
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }
const CLAVE = '0123456789abcdef0123456789abcdef'
const PELICULA = 'el-jardin-de-hierro'

interface Contexto {
  readonly pedir: (ruta: string) => Promise<Response>
  readonly llamadas: string[]
  readonly store: ReturnType<typeof createContainer>['store']
}

async function conApp<T>(
  body: (contexto: Contexto) => Promise<T>,
  opciones: {
    readonly media?: 'anime' | 'movies' | 'both'
    readonly respuesta?: () => Response
  } = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-tmdb-'))
  const db = openDb(join(dir, 'nn-anime.db'))
  runMigrations(db)
  const container = createContainer({ db })
  const proveedor = createFixtureProvider({ media: opciones.media ?? 'movies' })
  const llamadas: string[] = []

  try {
    const servidor = createApp({
      port: PORT,
      session: {
        cookieName: SESSION_COOKIE,
        value: SESSION_VALUE,
        matches: (candidate) => candidate === SESSION_VALUE,
      },
      bootToken: 'token',
      version: '0.1.0',
      plugins: {
        active: [{ provider: proveedor, file: '/plugins/fixture.ts' }],
        rejected: [],
      },
      container,
      tmdbFetchImpl: async (url) => {
        llamadas.push(url)
        return opciones.respuesta?.() ?? new Response('{}', { status: 500 })
      },
    })

    return await body({
      pedir: async (ruta) =>
        await Promise.resolve(servidor.request(`${BASE}${ruta}`, { headers: GOOD })),
      llamadas,
      store: container.store,
    })
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

function conResultados(resultados: unknown, status = 200): Response {
  return new Response(JSON.stringify({ results: resultados }), { status })
}

describe('GET /api/anime/:providerId/:ref/metadata', () => {
  test('sin clave no sale a la red y devuelve null', async () => {
    await conApp(async ({ pedir, llamadas }) => {
      const respuesta = await pedir(`/api/anime/${FIXTURE_PROVIDER_ID}/${PELICULA}/metadata`)
      const cuerpo = tmdbMetadataResponseSchema.parse(await respuesta.json())

      expect(respuesta.status).toBe(200)
      expect(cuerpo.metadata).toBeNull()
      expect(llamadas).toEqual([])
    })
  })

  test('para una fuente de anime no pregunta a TMDB', async () => {
    await conApp(
      async ({ pedir, llamadas, store }) => {
        await store.setSetting(TMDB_KEY, CLAVE)
        const respuesta = await pedir(`/api/anime/${FIXTURE_PROVIDER_ID}/aurora-nocturna/metadata`)
        const cuerpo = tmdbMetadataResponseSchema.parse(await respuesta.json())

        expect(cuerpo.metadata).toBeNull()
        expect(llamadas).toEqual([])
      },
      { media: 'anime' },
    )
  })

  test('con clave, una película recibe sinopsis, géneros y año', async () => {
    await conApp(
      async ({ pedir, llamadas, store }) => {
        await store.setSetting(TMDB_KEY, CLAVE)

        const respuesta = await pedir(`/api/anime/${FIXTURE_PROVIDER_ID}/${PELICULA}/metadata`)
        const cuerpo = tmdbMetadataResponseSchema.parse(await respuesta.json())

        expect(cuerpo.metadata).toEqual({
          source: 'tmdb',
          synopsis: 'Dos jardineros y el último parque de la ciudad.',
          genres: ['Drama', 'Ciencia ficción'],
          year: 2020,
        })
        // La petición va al host de TMDB, por HTTPS y con el tipo del título.
        expect(llamadas[0]).toStartWith('https://api.themoviedb.org/3/search/movie?')
        expect(llamadas[0]).toContain('api_key=')
      },
      {
        respuesta: () =>
          conResultados([
            {
              title: 'El Jardín de Hierro',
              overview: 'Dos jardineros y el último parque de la ciudad.',
              genre_ids: [18, 878],
              release_date: '2020-05-01',
            },
          ]),
      },
    )
  })

  test('un fallo de TMDB degrada a null, no a error de la ficha', async () => {
    await conApp(
      async ({ pedir, store }) => {
        await store.setSetting(TMDB_KEY, CLAVE)

        const respuesta = await pedir(`/api/anime/${FIXTURE_PROVIDER_ID}/${PELICULA}/metadata`)
        const cuerpo = tmdbMetadataResponseSchema.parse(await respuesta.json())

        expect(respuesta.status).toBe(200)
        expect(cuerpo.metadata).toBeNull()
      },
      { respuesta: () => new Response('boom', { status: 500 }) },
    )
  })

  test('una respuesta con otra forma también degrada a null', async () => {
    await conApp(
      async ({ pedir, store }) => {
        await store.setSetting(TMDB_KEY, CLAVE)

        const respuesta = await pedir(`/api/anime/${FIXTURE_PROVIDER_ID}/${PELICULA}/metadata`)
        const cuerpo = tmdbMetadataResponseSchema.parse(await respuesta.json())

        expect(cuerpo.metadata).toBeNull()
      },
      { respuesta: () => new Response(JSON.stringify({ resultados: 'no' }), { status: 200 }) },
    )
  })

  test('la segunda lectura usa la caché y no vuelve a TMDB', async () => {
    await conApp(
      async ({ pedir, llamadas, store }) => {
        await store.setSetting(TMDB_KEY, CLAVE)

        await pedir(`/api/anime/${FIXTURE_PROVIDER_ID}/${PELICULA}/metadata`)
        await pedir(`/api/anime/${FIXTURE_PROVIDER_ID}/${PELICULA}/metadata`)

        expect(llamadas).toHaveLength(1)
      },
      {
        respuesta: () =>
          conResultados([
            { title: 'El Jardín de Hierro', overview: 'Una.', genre_ids: [18], release_date: '2020-01-01' },
          ]),
      },
    )
  })

  test('un proveedor que no existe es 404', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir(`/api/anime/no-existe/${PELICULA}/metadata`)

      expect(respuesta.status).toBe(404)
    })
  })
})
