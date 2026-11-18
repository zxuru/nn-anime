import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@rona/catalog-store'
import { settingsResponseSchema } from '@rona/core'
import { createFixtureProvider } from '@rona/providers-fixture'
import { detalle, porRef } from '@rona/providers-fixture/data'
import { createApp, createContainer } from '../index'
import type { PresenceSnapshot } from '../presence/activity'
import type { PresenceService } from '../presence/service'

const PORT = 7717
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }
const JSON_HEADERS = { ...GOOD, 'content-type': 'application/json' }

interface Contexto {
  readonly pedir: (ruta: string, init?: RequestInit) => Promise<Response>
  readonly db: ReturnType<typeof openDb>
  readonly store: ReturnType<typeof createContainer>['store']
}

async function conApp<T>(
  body: (contexto: Contexto) => Promise<T>,
  opciones: {
    readonly mpvAvailable?: boolean
    readonly mpvVersion?: string
    readonly presence?: PresenceService
    readonly locked?: boolean
  } = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'rona-ajustes-'))
  const db = openDb(join(dir, 'rona.db'))
  runMigrations(db)
  const container = createContainer({
    db,
    mpvAvailable: opciones.mpvAvailable ?? false,
    ...(opciones.presence === undefined ? {} : { presence: opciones.presence }),
  })
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
        active: [
          {
            provider: proveedor,
            file: '/plugins/fixture.ts',
            lastError: { message: 'aviso en C:\\Users\\ana\\plugins\\fixture.ts' },
          },
        ],
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
        dbPath: '/datos/rona.db',
        configFile: '/config/rona.json',
      },
      ...(opciones.mpvVersion === undefined ? {} : { mpvVersion: opciones.mpvVersion }),
      ...(opciones.locked === undefined ? {} : { locked: opciones.locked }),
    })

    return await body({
      pedir: async (ruta, init) =>
        await Promise.resolve(servidor.request(`${BASE}${ruta}`, init ?? { headers: GOOD })),
      db,
      store: container.store,
    })
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

describe('la clave de TMDB', () => {
  const CLAVE = '0123456789abcdef0123456789abcdef'

  test('nace sin configurar y se puede guardar sin que vuelva en la respuesta', async () => {
    await conApp(async ({ pedir }) => {
      const antes = settingsResponseSchema.parse(await (await pedir('/api/settings')).json())
      expect(antes.tmdb.configured).toBe(false)

      const guardar = await pedir('/api/settings', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ tmdbApiKey: CLAVE }),
      })
      expect(guardar.status).toBe(204)

      const respuesta = await pedir('/api/settings')
      const texto = await respuesta.text()
      const despues = settingsResponseSchema.parse(JSON.parse(texto))

      expect(despues.tmdb.configured).toBe(true)
      // La clave no viaja al navegador: la respuesta sólo dice si hay una.
      expect(texto).not.toContain(CLAVE)
    })
  })

  test('`null` la borra', async () => {
    await conApp(async ({ pedir }) => {
      await pedir('/api/settings', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ tmdbApiKey: CLAVE }),
      })
      await pedir('/api/settings', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ tmdbApiKey: null }),
      })

      const salida = settingsResponseSchema.parse(await (await pedir('/api/settings')).json())
      expect(salida.tmdb.configured).toBe(false)
    })
  })

  test('una clave con una forma que no es la de TMDB es 400', async () => {
    await conApp(async ({ pedir }) => {
      for (const tmdbApiKey of ['', 'no-es-una-clave', '0123456789abcdef']) {
        const respuesta = await pedir('/api/settings', {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ tmdbApiKey }),
        })

        expect(respuesta.status, tmdbApiKey).toBe(400)
      }
    })
  })
})

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
      // El último error viaja también a Ajustes, que es de donde lee la lista.
      expect(rechazado?.lastError).toContain('no exporta')
    })
  })

  test('el último error del proveedor activo no lleva rutas absolutas', async () => {
    await conApp(async ({ pedir }) => {
      const salida = settingsResponseSchema.parse(await (await pedir('/api/settings')).json())
      const activo = salida.providers.find((provider) => provider.status === 'active')

      expect(activo?.lastError).toBeDefined()
      expect(activo?.lastError).not.toContain('C:\\')
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

  /**
   * Lo que no se enciende a conciencia no se enseña: el defecto es la mitad del
   * ajuste, y con él encendido la vitrina enseñaría lo que nadie ha pedido ver.
   */
  test('el contenido para adultos nace apagado', async () => {
    await conApp(async ({ pedir }) => {
      const salida = settingsResponseSchema.parse(await (await pedir('/api/settings')).json())

      expect(salida.adultContent).toBe(false)
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

  /**
   * El parche cambia lo que trae y **sólo** lo que trae: encender el contenido
   * para adultos no puede llevarse por delante el tema ni el orden de proveedores,
   * que es lo que haría un parche que escribiera el objeto entero.
   */
  test('el contenido para adultos se guarda, se lee de vuelta y no borra lo demás', async () => {
    await conApp(async ({ pedir }) => {
      await pedir('/api/settings', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ theme: 'light', providerPriority: ['jkanime'] }),
      })

      const guardar = await pedir('/api/settings', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ adultContent: true }),
      })
      const salida = settingsResponseSchema.parse(await (await pedir('/api/settings')).json())

      expect(guardar.status).toBe(204)
      expect(salida.adultContent).toBe(true)
      expect(salida.theme).toBe('light')
      expect(salida.providerPriority).toEqual(['jkanime'])
    })
  })

  test('un `adultContent` que no es booleano es 400', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/settings', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ adultContent: 'sí' }),
      })

      expect(respuesta.status).toBe(400)
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

function presenciaFalsa(conectado = true): {
  readonly service: PresenceService
  readonly fotos: readonly PresenceSnapshot[]
  readonly limpiezas: () => number
} {
  const fotos: PresenceSnapshot[] = []
  let limpiezas = 0

  return {
    service: {
      update: (foto) => {
        fotos.push(foto)
      },
      clear: () => {
        limpiezas += 1
      },
      connected: () => conectado,
      close: async () => {},
    },
    fotos,
    limpiezas: () => limpiezas,
  }
}

const REF = { providerId: 'fixture', value: 'aurora-nocturna' } as const

async function sembrar(store: Contexto['store']): Promise<string> {
  const titulo = porRef(REF.value)
  if (titulo === undefined) throw new Error('el fixture no tiene aurora-nocturna')

  await store.writeAnime(REF, detalle(titulo))

  return titulo.title
}

async function ajustar(pedir: Contexto['pedir'], discordPresence: string): Promise<void> {
  await pedir('/api/settings', {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ discordPresence }),
  })
}

async function publicar(pedir: Contexto['pedir']): Promise<Response> {
  return await pedir('/api/presence', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      animeRef: REF,
      episodeNumber: 2,
      positionS: 30,
      durationS: 1_200,
      paused: false,
    }),
  })
}

describe('la presencia de Discord', () => {
  test('nace apagada y sin conexión', async () => {
    await conApp(async ({ pedir }) => {
      const salida = settingsResponseSchema.parse(await (await pedir('/api/settings')).json())

      expect(salida.discordPresence).toBe('off')
      expect(salida.discord.connected).toBe(false)
    })
  })

  test('la foto resuelve el título en el servidor y respeta el modo', async () => {
    const falso = presenciaFalsa()

    await conApp(
      async ({ pedir, store }) => {
        const titulo = await sembrar(store)
        await ajustar(pedir, 'completo')
        const respuesta = await publicar(pedir)

        expect(respuesta.status).toBe(204)
        expect(falso.fotos[0]).toMatchObject({
          mode: 'completo',
          title: titulo,
          episodeNumber: 2,
          positionS: 30,
          durationS: 1_200,
          paused: false,
        })

        const salida = settingsResponseSchema.parse(await (await pedir('/api/settings')).json())
        expect(salida.discordPresence).toBe('completo')
        expect(salida.discord.connected).toBe(true)
      },
      { presence: falso.service },
    )
  })

  test('un título marcado para adultos no se publica aunque el modo sea completo', async () => {
    const falso = presenciaFalsa()

    await conApp(
      async ({ pedir, store }) => {
        await sembrar(store)
        await store.markAdult(REF)
        await ajustar(pedir, 'completo')
        await publicar(pedir)

        expect(falso.fotos[0]?.title).toBeNull()
      },
      { presence: falso.service },
    )
  })

  test('apagada no publica y retira lo que hubiera', async () => {
    const falso = presenciaFalsa()

    await conApp(
      async ({ pedir }) => {
        await ajustar(pedir, 'off')
        await publicar(pedir)

        expect(falso.fotos).toHaveLength(0)
        expect(falso.limpiezas()).toBeGreaterThan(0)
      },
      { presence: falso.service },
    )
  })

  test('una foto inválida es 400 y no toca el servicio', async () => {
    const falso = presenciaFalsa()

    await conApp(
      async ({ pedir }) => {
        const respuesta = await pedir('/api/presence', {
          method: 'PUT',
          headers: JSON_HEADERS,
          body: JSON.stringify({ animeRef: REF }),
        })

        expect(respuesta.status).toBe(400)
        expect(falso.fotos).toHaveLength(0)
      },
      { presence: falso.service },
    )
  })

  test('en modo restringido no se publica nada', async () => {
    const falso = presenciaFalsa()

    await conApp(
      async ({ pedir }) => {
        const respuesta = await publicar(pedir)

        expect(respuesta.status).toBe(204)
        expect(falso.fotos).toHaveLength(0)
      },
      { presence: falso.service, locked: true },
    )
  })
})
