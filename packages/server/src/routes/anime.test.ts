import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import { animeResponseSchema, episodesResponseSchema } from '@nn-anime/core'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { createApp, createContainer } from '../index'
import { findProvider, statusFor } from './anime'

const PORT = 7717
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BOOT_TOKEN = 'token'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }

const REF = 'aurora-nocturna'

interface Contexto {
  readonly proveedor: ReturnType<typeof createFixtureProvider>
  readonly db: ReturnType<typeof openDb>
  readonly pedir: (
    ruta: string,
    headers?: Record<string, string>,
  ) => Promise<{ status: number; cache: string | null; body: unknown }>
}

async function conApp<T>(
  body: (contexto: Contexto) => Promise<T>,
  opciones: {
    readonly proveedor?: ReturnType<typeof createFixtureProvider>
    readonly sinContenedor?: boolean
  } = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-detalle-'))
  const db = openDb(join(dir, 'nn-anime.db'))
  runMigrations(db)
  const container = createContainer({ db })
  const proveedor = opciones.proveedor ?? createFixtureProvider()

  try {
    const servidor = createApp({
      port: PORT,
      session: {
        cookieName: SESSION_COOKIE,
        value: SESSION_VALUE,
        matches: (candidate) => candidate === SESSION_VALUE,
      },
      bootToken: BOOT_TOKEN,
      version: '0.1.0',
      plugins: { active: [{ provider: proveedor, file: '/plugins/fixture.ts' }], rejected: [] },
      ...(opciones.sinContenedor === true ? {} : { container }),
    })

    const pedir = async (ruta: string, headers: Record<string, string> = GOOD) => {
      const respuesta = await servidor.request(`${BASE}${ruta}`, { headers })

      let cuerpo: unknown = null
      try {
        cuerpo = await respuesta.json()
      } catch {
        cuerpo = null
      }

      return { status: respuesta.status, cache: respuesta.headers.get('x-cache'), body: cuerpo }
    }

    return await body({ proveedor, db, pedir })
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

describe('resolución del proveedor', () => {
  test('encuentra el proveedor activo por su id', () => {
    const proveedor = createFixtureProvider({ id: 'mio' })

    expect(findProvider([proveedor], 'mio')?.id).toBe('mio')
    expect(findProvider([proveedor], 'otro')).toBeUndefined()
  })

  test('un 404 del upstream es 404; lo demás es 502', () => {
    const conEstado = (estado: number) => ({
      message: 'x',
      scope: 'p',
      op: 'getAnime',
      context: { estado },
      name: 'ProviderError',
      code: 'provider' as const,
    })

    expect(statusFor(conEstado(404) as never)).toBe(404)
    expect(statusFor(conEstado(500) as never)).toBe(502)
    expect(statusFor({ message: 'x', context: {} } as never)).toBe(502)
  })
})

describe('GET /api/anime/:providerId/:ref', () => {
  test('devuelve el detalle con géneros y estudios', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir(`/api/anime/fixture/${REF}`)
      const detalle = animeResponseSchema.parse(respuesta.body)

      expect(respuesta.status).toBe(200)
      expect(detalle.title).toBe('Aurora Nocturna')
      expect(detalle.genres).toContain('Acción')
      expect(detalle.studios).toContain('Estudio Cobre')
      expect(detalle.synopsis?.length).toBeGreaterThan(0)
    })
  })

  test('el primer acceso es MISS y el segundo HIT, sin volver al proveedor', async () => {
    await conApp(async ({ pedir, proveedor }) => {
      const primera = await pedir(`/api/anime/fixture/${REF}`)
      const segunda = await pedir(`/api/anime/fixture/${REF}`)

      expect(primera.cache).toBe('miss')
      expect(segunda.cache).toBe('hit')
      expect(proveedor.calls.count('getAnime')).toBe(1)
    })
  })

  test('con el dato vencido responde STALE y refresca por detrás', async () => {
    await conApp(async ({ pedir, db, proveedor }) => {
      await pedir(`/api/anime/fixture/${REF}`)
      db.query('UPDATE anime SET fetched_at = fetched_at - 200000000').run()

      const vencida = await pedir(`/api/anime/fixture/${REF}`)

      expect(vencida.cache).toBe('stale')

      for (let intento = 0; intento < 50 && proveedor.calls.count('getAnime') < 2; intento++) {
        await Bun.sleep(10)
      }

      expect(proveedor.calls.count('getAnime')).toBe(2)
    })
  })

  test('un proveedor desconocido es 404 con su nombre en el mensaje', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir(`/api/anime/otro/${REF}`)

      expect(respuesta.status).toBe(404)
      expect(JSON.stringify(respuesta.body)).toContain('otro')
    })
  })

  test('una referencia que el proveedor no conoce es 404, no 500', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/anime/fixture/no-existe')

      expect(respuesta.status).toBe(404)
      expect(JSON.stringify(respuesta.body)).toContain('no-existe')
    })
  })

  test('un proveedor que falla de verdad es 502', async () => {
    await conApp(
      async ({ pedir }) => {
        const respuesta = await pedir(`/api/anime/fixture/${REF}`)

        expect(respuesta.status).toBe(502)
        expect(JSON.stringify(respuesta.body)).toContain('500')
      },
      { proveedor: createFixtureProvider({ failures: { getAnime: 'http500' } }) },
    )
  })

  test('un fallo del proveedor no deja nada escrito en la caché', async () => {
    await conApp(
      async ({ pedir, db }) => {
        await pedir(`/api/anime/fixture/${REF}`)

        const filas = db.query('SELECT COUNT(*) AS total FROM anime').get() as { total: number }
        expect(filas.total).toBe(0)
      },
      { proveedor: createFixtureProvider({ failures: { getAnime: 'http500' } }) },
    )
  })

  test('exige sesión', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir(`/api/anime/fixture/${REF}`, {})

      expect(respuesta.status).toBe(401)
    })
  })

  test('sin contenedor la ruta no existe: 404 y no 500', async () => {
    await conApp(
      async ({ pedir }) => {
        const respuesta = await pedir(`/api/anime/fixture/${REF}`)

        expect(respuesta.status).toBe(404)
      },
      { sinContenedor: true },
    )
  })

  test('con `?q=` el detalle deja rastro en el historial de búsquedas', async () => {
    await conApp(async ({ pedir, db }) => {
      await pedir(`/api/anime/fixture/${REF}?q=aurora`)

      const filas = db
        .query('SELECT query, provider_id, hits FROM search_history')
        .all() as readonly { query: string; provider_id: string; hits: number }[]

      expect(filas).toEqual([{ query: 'aurora', provider_id: 'fixture', hits: 1 }])
    })
  })

  test('sin `?q=` no se anota ninguna búsqueda', async () => {
    await conApp(async ({ pedir, db }) => {
      await pedir(`/api/anime/fixture/${REF}`)

      const filas = db.query('SELECT COUNT(*) AS total FROM search_history').get() as {
        total: number
      }
      expect(filas.total).toBe(0)
    })
  })

  test('una `?q=` en blanco no se anota', async () => {
    await conApp(async ({ pedir, db }) => {
      await pedir(`/api/anime/fixture/${REF}?q=%20%20`)

      const filas = db.query('SELECT COUNT(*) AS total FROM search_history').get() as {
        total: number
      }
      expect(filas.total).toBe(0)
    })
  })
})

describe('GET /api/anime/:providerId/:ref/episodes', () => {
  test('devuelve los episodios con número, título, duración y modo', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir(`/api/anime/fixture/${REF}/episodes`)
      const lista = episodesResponseSchema.parse(respuesta.body)

      expect(respuesta.status).toBe(200)
      expect(lista.episodes.length).toBeGreaterThan(0)
      expect(lista.episodes[0]?.number).toBe(1)
      expect(lista.episodes[0]?.title).toBe('Episodio 1')
      expect(lista.episodes[0]?.durationS).toBe(1440)
      expect(lista.episodes[0]?.mode).toBe('sub')
    })
  })

  test('el primer acceso es MISS y el segundo HIT', async () => {
    await conApp(async ({ pedir, proveedor }) => {
      const primera = await pedir(`/api/anime/fixture/${REF}/episodes`)
      const segunda = await pedir(`/api/anime/fixture/${REF}/episodes`)

      expect(primera.cache).toBe('miss')
      expect(segunda.cache).toBe('hit')
      expect(proveedor.calls.count('getEpisodes')).toBe(1)
    })
  })

  test('pedir los episodios deja el detalle escrito: la lista lo necesita', async () => {
    await conApp(async ({ pedir, db }) => {
      await pedir(`/api/anime/fixture/${REF}/episodes`)

      const filas = db.query('SELECT COUNT(*) AS total FROM anime').get() as { total: number }
      expect(filas.total).toBe(1)

      // Y el detalle, ya cacheado, no vuelve a preguntar.
      const detalle = await pedir(`/api/anime/fixture/${REF}`)
      expect(detalle.cache).toBe('hit')
    })
  })

  test('un proveedor desconocido es 404', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir(`/api/anime/otro/${REF}/episodes`)

      expect(respuesta.status).toBe(404)
    })
  })

  test('una referencia desconocida es 404', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/anime/fixture/no-existe/episodes')

      expect(respuesta.status).toBe(404)
    })
  })

  test('exige sesión', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir(`/api/anime/fixture/${REF}/episodes`, {})

      expect(respuesta.status).toBe(401)
    })
  })

  test('un título sin episodios devuelve la lista vacía, no un error', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/anime/fixture/orbita-corta/episodes')
      const lista = episodesResponseSchema.parse(respuesta.body)

      expect(respuesta.status).toBe(200)
      expect(lista.episodes).toEqual([])
    })
  })
})
