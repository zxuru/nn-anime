import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { createApp, createContainer } from '../index'

const PORT = 7717
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }
const JSON_HEADERS = { ...GOOD, 'content-type': 'application/json' }

const REF = 'aurora-nocturna'
const ALTA = {
  animeRef: { providerId: 'fixture', value: REF },
  episodeRef: { providerId: 'fixture', value: `${REF}#1` },
  mode: 'sub' as const,
}

interface Contexto {
  readonly pedir: (ruta: string, init?: RequestInit) => Promise<Response>
  readonly db: ReturnType<typeof openDb>
  readonly recientes: () => Promise<readonly { positionS: number; mode: string }[]>
}

async function conApp<T>(body: (contexto: Contexto) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-watch-'))
  const db = openDb(join(dir, 'nn-anime.db'))
  runMigrations(db)
  const container = createContainer({ db })
  const proveedor = createFixtureProvider()

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
      plugins: { active: [{ provider: proveedor, file: '/plugins/fixture.ts' }], rejected: [] },
      container,
    })

    // El episodio tiene que estar en la base: la clave foránea lo exige, y el
    // flujo real es abrir la ficha antes de darle a reproducir.
    await servidor.request(`${BASE}/api/anime/fixture/${REF}/episodes`, { headers: GOOD })

    return await body({
      pedir: async (ruta, init) =>
        await Promise.resolve(servidor.request(`${BASE}${ruta}`, init ?? { headers: GOOD })),
      db,
      recientes: async () => {
        const filas = await container.store.listRecentlyWatched(10)

        return filas.map((fila) => ({ positionS: fila.positionS, mode: fila.mode }))
      },
    })
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

function alta(pedir: Contexto['pedir'], cuerpo: unknown = ALTA) {
  return pedir('/api/watch', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(cuerpo),
  })
}

describe('POST /api/watch', () => {
  test('abre una fila y devuelve su identificador', async () => {
    await conApp(async ({ pedir, recientes }) => {
      const respuesta = await alta(pedir)
      const cuerpo = (await respuesta.json()) as { id: number }

      expect(respuesta.status).toBe(201)
      expect(cuerpo.id).toBeGreaterThan(0)
      expect(await recientes()).toEqual([{ positionS: 0, mode: 'sub' }])
    })
  })

  test('sin reproducción real no se registra nada', async () => {
    await conApp(async ({ pedir, db }) => {
      // Sólo cargar la ficha no abre ningún visionado: el alta es de quien
      // reproduce, y el reproductor es quien la manda.
      await pedir(`/api/anime/fixture/${REF}`)

      const filas = db.query('SELECT COUNT(*) AS total FROM watch_event').get() as { total: number }

      expect(filas.total).toBe(0)
    })
  })

  test('`startAtS` se guarda como posición inicial', async () => {
    await conApp(async ({ pedir, recientes }) => {
      await alta(pedir, { ...ALTA, startAtS: 120 })

      expect(await recientes()).toEqual([{ positionS: 120, mode: 'sub' }])
    })
  })

  test('un episodio que no está en la base es 404', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await alta(pedir, {
        ...ALTA,
        episodeRef: { providerId: 'fixture', value: 'no-existe#9' },
      })

      expect(respuesta.status).toBe(404)
    })
  })

  test('un cuerpo inválido es 400', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await alta(pedir, { episodeRef: ALTA.episodeRef })

      expect(respuesta.status).toBe(400)
    })
  })

  test('exige sesión', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/watch', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify(ALTA),
      })

      expect(respuesta.status).toBe(401)
    })
  })
})

describe('PATCH /api/watch/:id', () => {
  test('mueve la posición y aparece en «continuar viendo»', async () => {
    await conApp(async ({ pedir, recientes }) => {
      const { id } = (await (await alta(pedir)).json()) as { id: number }

      const avance = await pedir(`/api/watch/${id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 300, durationS: 1440 }),
      })

      expect(avance.status).toBe(204)
      expect(await recientes()).toEqual([{ positionS: 300, mode: 'sub' }])
    })
  })

  test('varios avances dejan la última posición', async () => {
    await conApp(async ({ pedir, recientes }) => {
      const { id } = (await (await alta(pedir)).json()) as { id: number }

      for (const positionS of [15, 30, 45]) {
        await pedir(`/api/watch/${id}`, {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ positionS, durationS: 1440 }),
        })
      }

      expect(await recientes()).toEqual([{ positionS: 45, mode: 'sub' }])
    })
  })

  test('un identificador que no existe es 404 y uno inválido, 400', async () => {
    await conApp(async ({ pedir }) => {
      const inexistente = await pedir('/api/watch/9999', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 1, durationS: 2 }),
      })
      const invalido = await pedir('/api/watch/abc', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 1, durationS: 2 }),
      })

      expect([inexistente.status, invalido.status]).toEqual([404, 400])
    })
  })

  test('una posición negativa es 400', async () => {
    await conApp(async ({ pedir }) => {
      const { id } = (await (await alta(pedir)).json()) as { id: number }
      const respuesta = await pedir(`/api/watch/${id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: -5, durationS: 10 }),
      })

      expect(respuesta.status).toBe(400)
    })
  })
})

describe('los dos modos son dos visionados', () => {
  test('sub y dub abren filas distintas', async () => {
    await conApp(async ({ pedir, db }) => {
      await alta(pedir)
      await alta(pedir, { ...ALTA, mode: 'dub' })

      const filas = db.query('SELECT COUNT(*) AS total FROM watch_event').get() as { total: number }

      expect(filas.total).toBe(2)
    })
  })
})

describe('GET /api/watch/recent', () => {
  test('sin nada visto, la lista está vacía', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/watch/recent')

      expect(respuesta.status).toBe(200)
      expect(await respuesta.json()).toEqual({ items: [] })
    })
  })

  test('un visionado a medias aparece con su posición y su proporción', async () => {
    await conApp(async ({ pedir }) => {
      const { id } = (await (await alta(pedir)).json()) as { id: number }
      await pedir(`/api/watch/${id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 720, durationS: 1440 }),
      })

      const cuerpo = (await (await pedir('/api/watch/recent')).json()) as {
        items: { positionS: number; ratio: number; episodeNumber: number; mode: string }[]
      }

      expect(cuerpo.items).toHaveLength(1)
      expect(cuerpo.items[0]?.positionS).toBe(720)
      expect(cuerpo.items[0]?.ratio).toBeCloseTo(0.5, 6)
      expect(cuerpo.items[0]?.mode).toBe('sub')
    })
  })

  test('lo terminado no aparece: ya se vio', async () => {
    await conApp(async ({ pedir }) => {
      const { id } = (await (await alta(pedir)).json()) as { id: number }
      await pedir(`/api/watch/${id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 1440, durationS: 1440 }),
      })

      const cuerpo = (await (await pedir('/api/watch/recent')).json()) as { items: unknown[] }

      expect(cuerpo.items).toEqual([])
    })
  })

  test('abrir y cerrar no es «estar viendo»: por debajo del 2 % no aparece', async () => {
    await conApp(async ({ pedir }) => {
      const { id } = (await (await alta(pedir)).json()) as { id: number }
      await pedir(`/api/watch/${id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 5, durationS: 1440 }),
      })

      const cuerpo = (await (await pedir('/api/watch/recent')).json()) as { items: unknown[] }

      expect(cuerpo.items).toEqual([])
    })
  })

  test('lo que está a punto de acabarse tampoco', async () => {
    await conApp(async ({ pedir }) => {
      const { id } = (await (await alta(pedir)).json()) as { id: number }
      await pedir(`/api/watch/${id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 1430, durationS: 1440 }),
      })

      const cuerpo = (await (await pedir('/api/watch/recent')).json()) as { items: unknown[] }

      expect(cuerpo.items).toEqual([])
    })
  })

  test('sin duración conocida no se inventa una proporción', async () => {
    await conApp(async ({ pedir }) => {
      await alta(pedir)

      const cuerpo = (await (await pedir('/api/watch/recent')).json()) as { items: unknown[] }

      // Duración cero y sin terminar: proporción cero, así que no es «continuar».
      expect(cuerpo.items).toEqual([])
    })
  })

  test('exige sesión', async () => {
    await conApp(async ({ pedir }) => {
      expect((await pedir('/api/watch/recent', { headers: {} })).status).toBe(401)
    })
  })
})
