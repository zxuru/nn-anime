import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import { settingsResponseSchema } from '@nn-anime/core'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { createApp, createContainer } from '../index'

const PORT = 7717
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }
const JSON_HEADERS = { ...GOOD, 'content-type': 'application/json' }

interface Contexto {
  readonly pedir: (ruta: string, init?: RequestInit) => Promise<Response>
  readonly db: ReturnType<typeof openDb>
}

async function conApp<T>(
  body: (contexto: Contexto) => Promise<T>,
  opciones: { readonly mpvAvailable?: boolean; readonly mpvVersion?: string } = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-ajustes-'))
  const db = openDb(join(dir, 'nn-anime.db'))
  runMigrations(db)
  const container = createContainer({ db, mpvAvailable: opciones.mpvAvailable ?? false })
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
      plugins: {
        active: [{ provider: proveedor, file: '/plugins/fixture.ts' }],
        rejected: [
          { file: '/plugins/roto.ts', reason: { message: 'no exporta un proveedor válido' } },
        ],
      },
      container,
      paths: {
        dataDir: '/datos',
        configDir: '/config',
        cacheDir: '/cache',
        providersDir: '/config/providers',
        dbPath: '/datos/nn-anime.db',
        configFile: '/config/nn-anime.json',
      },
      ...(opciones.mpvVersion === undefined ? {} : { mpvVersion: opciones.mpvVersion }),
    })

    return await body({
      pedir: async (ruta, init) =>
        await Promise.resolve(servidor.request(`${BASE}${ruta}`, init ?? { headers: GOOD })),
      db,
    })
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

describe('GET /api/settings', () => {
  test('devuelve el tema, las rutas, mpv y los proveedores', async () => {
    await conApp(async ({ pedir }) => {
      const salida = settingsResponseSchema.parse(await (await pedir('/api/settings')).json())

      expect(salida.theme).toBe('system')
      expect(salida.paths).toEqual({ data: '/datos', config: '/config', cache: '/cache' })
      expect(salida.mpv.available).toBe(false)
      expect(salida.providers).toHaveLength(2)
    })
  })

  test('no se cachea: la respuesta lleva las rutas del disco', async () => {
    // `paths` viene del arranque, que es quien las calculó. En loopback no hay
    // caché compartida, pero el navegador guarda en disco lo que no se le
    // prohíbe.
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/settings')

      expect(respuesta.headers.get('cache-control')).toBe('no-store')
    })
  })

  test('el proveedor rechazado sale con su motivo', async () => {
    await conApp(async ({ pedir }) => {
      const salida = settingsResponseSchema.parse(await (await pedir('/api/settings')).json())
      const rechazado = salida.providers.find((provider) => provider.status === 'rejected')

      expect(rechazado?.reason).toContain('no exporta')
      expect(rechazado?.capabilities.search).toBe(false)
    })
  })

  test('la versión de mpv se enseña cuando se sabe', async () => {
    await conApp(
      async ({ pedir }) => {
        const salida = settingsResponseSchema.parse(await (await pedir('/api/settings')).json())

        expect(salida.mpv.available).toBe(true)
        expect(salida.mpv.version).toBe('0.41.0')
      },
      { mpvAvailable: true, mpvVersion: '0.41.0' },
    )
  })

  test('sin saber la versión no se inventa ninguna', async () => {
    await conApp(async ({ pedir }) => {
      const salida = settingsResponseSchema.parse(await (await pedir('/api/settings')).json())

      expect(salida.mpv.version).toBeUndefined()
    })
  })

  test('sin rutas configuradas lo dice, no las inventa', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/settings')

      expect(respuesta.status).toBe(200)
    })
  })

  test('exige sesión', async () => {
    await conApp(async ({ pedir }) => {
      expect((await pedir('/api/settings', { headers: {} })).status).toBe(401)
    })
  })

  /**
   * Sin nada guardado la lista sale vacía, no ausente: la interfaz lee siempre el
   * mismo campo y «no hay preferencia» es una lista sin elementos.
   */
  test('sin prioridad guardada devuelve una lista vacía', async () => {
    await conApp(async ({ pedir }) => {
      const salida = settingsResponseSchema.parse(await (await pedir('/api/settings')).json())

      expect(salida.providerPriority).toEqual([])
    })
  })
})

describe('PATCH /api/settings', () => {
  test('guarda el tema y se lee de vuelta', async () => {
    await conApp(async ({ pedir }) => {
      const guardar = await pedir('/api/settings', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ theme: 'light' }),
      })
      const salida = settingsResponseSchema.parse(await (await pedir('/api/settings')).json())

      expect(guardar.status).toBe(204)
      expect(salida.theme).toBe('light')
    })
  })

  test('el tema sobrevive a una segunda lectura: está en la base', async () => {
    await conApp(async ({ pedir, db }) => {
      await pedir('/api/settings', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ theme: 'dark' }),
      })

      const filas = db.query('SELECT COUNT(*) AS total FROM setting').get() as { total: number }

      expect(filas.total).toBe(1)
    })
  })

  test('un tema que no existe es 400', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/settings', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ theme: 'arcoiris' }),
      })

      expect(respuesta.status).toBe(400)
    })
  })

  /**
   * El orden es el dato: se guarda tal cual se pidió y se lee en el mismo orden.
   * Mutar el guardado —invertirlo, ordenarlo alfabéticamente— deja esta prueba en
   * rojo, que es lo que la hace servir de algo.
   */
  test('guarda el orden de prioridad y lo devuelve igual', async () => {
    await conApp(async ({ pedir }) => {
      const guardar = await pedir('/api/settings', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ providerPriority: ['jkanime', 'animeav1'] }),
      })
      const salida = settingsResponseSchema.parse(await (await pedir('/api/settings')).json())

      expect(guardar.status).toBe(204)
      expect(salida.providerPriority).toEqual(['jkanime', 'animeav1'])
    })
  })

  test('los ids repetidos se guardan una sola vez', async () => {
    await conApp(async ({ pedir }) => {
      await pedir('/api/settings', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ providerPriority: ['uno', 'dos', 'uno'] }),
      })
      const salida = settingsResponseSchema.parse(await (await pedir('/api/settings')).json())

      expect(salida.providerPriority).toEqual(['uno', 'dos'])
    })
  })

  /** Reordenar no es cambiar el tema: lo que el parche no nombra se queda. */
  test('reordenar proveedores no toca el tema guardado', async () => {
    await conApp(async ({ pedir }) => {
      await pedir('/api/settings', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ theme: 'light' }),
      })
      await pedir('/api/settings', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ providerPriority: ['uno'] }),
      })
      const salida = settingsResponseSchema.parse(await (await pedir('/api/settings')).json())

      expect(salida.theme).toBe('light')
      expect(salida.providerPriority).toEqual(['uno'])
    })
  })

  test('un parche que no cambia nada es 400', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/settings', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({}),
      })

      expect(respuesta.status).toBe(400)
    })
  })

  test('un id de proveedor vacío es 400', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/settings', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ providerPriority: [''] }),
      })

      expect(respuesta.status).toBe(400)
    })
  })

  test('un cuerpo que no es JSON es 400', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/settings', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: 'no es json',
      })

      expect(respuesta.status).toBe(400)
    })
  })
})
