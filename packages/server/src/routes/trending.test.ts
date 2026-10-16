/**
 * La ruta de tendencias, con su TTL.
 *
 * No tenía pruebas propias: `/api/trending` existía desde T41 y nadie medía que
 * sirviera la caché, que **no** la sirviera caducada para siempre ni que un
 * proveedor que falla dejara la fila en blanco. T54 las añade junto con el
 * arreglo, porque sin ellas la mutación del `stale` no se puede ver.
 */

import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations, TTL_SECONDS } from '@nn-anime/catalog-store'
import { type SearchResult, trendingResponseSchema } from '@nn-anime/core'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { createApp, createContainer } from '../index'

const PORT = 7717
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }

/** Un título de tendencias mínimo, para las pruebas que controlan el contenido. */
function titulo(value: string, title: string): SearchResult {
  return { ref: { providerId: 'fixture', value }, title }
}

interface Contexto {
  readonly pedir: (ruta: string, init?: RequestInit) => Promise<Response>
  readonly db: ReturnType<typeof openDb>
  readonly proveedor: ReturnType<typeof createFixtureProvider>
  readonly container: ReturnType<typeof createContainer>
}

/** Espera a que la cola de revalidación se vacíe, sin dormir de más. */
async function hastaTerminar(revalidator: {
  running(): number
  queued(): readonly string[]
}): Promise<void> {
  while (revalidator.running() > 0 || revalidator.queued().length > 0) await Bun.sleep(1)
}

async function conApp<T>(
  body: (contexto: Contexto) => Promise<T>,
  opciones: {
    readonly proveedor?: ReturnType<typeof createFixtureProvider>
    /** Reloj inyectable: sin él, la caducidad son quince minutos de espera. */
    readonly now?: () => number
  } = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-trending-'))
  const db = openDb(join(dir, 'nn-anime.db'))
  runMigrations(db)
  const container = createContainer({
    db,
    ...(opciones.now === undefined ? {} : { now: opciones.now }),
  })
  const proveedor = opciones.proveedor ?? createFixtureProvider()

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

    return await body({
      pedir: async (ruta, init) =>
        await Promise.resolve(servidor.request(`${BASE}${ruta}`, init ?? { headers: GOOD })),
      db,
      proveedor,
      container,
    })
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

describe('GET /api/trending', () => {
  test('devuelve las tendencias del proveedor', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/trending')
      const salida = trendingResponseSchema.parse(await respuesta.json())

      expect(respuesta.status).toBe(200)
      expect(salida.items.length).toBeGreaterThan(0)
    })
  })

  test('la segunda petición no vuelve a llamar al proveedor', async () => {
    await conApp(async ({ pedir, proveedor }) => {
      await pedir('/api/trending')
      const primera = proveedor.calls.count('getTrending')

      await pedir('/api/trending')

      expect(primera).toBe(1)
      expect(proveedor.calls.count('getTrending')).toBe(1)
    })
  })

  test('una caché caducada se sirve ya y se revalida por detrás', async () => {
    let reloj = Date.now()
    let lista = [titulo('vieja', 'Vieja')]
    let liberar: (() => void) | undefined
    let llamadas = 0

    const base = createFixtureProvider()
    const cambiante = {
      ...base,
      getTrending: async () => {
        llamadas += 1
        // El refresco de fondo espera a que la prueba lo suelte: así se mide que
        // la respuesta no espera por él.
        if (llamadas === 2) {
          await new Promise<void>((resolver) => {
            liberar = resolver
          })
        }

        return lista
      },
    }

    await conApp(
      async ({ pedir, container }) => {
        const primera = trendingResponseSchema.parse(await (await pedir('/api/trending')).json())
        expect(primera.items.map((item) => item.title)).toEqual(['Vieja'])

        lista = [titulo('nueva', 'Nueva')]
        reloj += (TTL_SECONDS.trending + 1) * 1000

        const segunda = trendingResponseSchema.parse(await (await pedir('/api/trending')).json())
        expect(segunda.items.map((item) => item.title)).toEqual(['Vieja'])
        expect(container.revalidator.running()).toBe(1)

        liberar?.()
        await hastaTerminar(container.revalidator)

        const tercera = trendingResponseSchema.parse(await (await pedir('/api/trending')).json())
        expect(tercera.items.map((item) => item.title)).toEqual(['Nueva'])
      },
      { proveedor: cambiante, now: () => reloj },
    )
  })

  test('un refresco que falla conserva lo viejo y lo anota', async () => {
    let reloj = Date.now()
    let falla = false

    const base = createFixtureProvider()
    const quebradizo = {
      ...base,
      getTrending: async () => {
        if (falla) throw new Error('las tendencias se cayeron')

        return [titulo('vieja', 'Vieja')]
      },
    }

    await conApp(
      async ({ pedir, db, container }) => {
        await pedir('/api/trending')

        falla = true
        reloj += (TTL_SECONDS.trending + 1) * 1000

        const caducada = trendingResponseSchema.parse(await (await pedir('/api/trending')).json())
        expect(caducada.items.map((item) => item.title)).toEqual(['Vieja'])

        await hastaTerminar(container.revalidator)

        const despues = trendingResponseSchema.parse(await (await pedir('/api/trending')).json())
        expect(despues.items.map((item) => item.title)).toEqual(['Vieja'])

        const fila = db
          .query<{ resource: string; key: string; message: string }, []>(
            'SELECT resource, key, message FROM revalidate_error',
          )
          .get()

        expect(fila?.resource).toBe('trending')
        expect(fila?.key).toBe('trending#fixture')
        expect(fila?.message).toContain('las tendencias se cayeron')
      },
      { proveedor: quebradizo, now: () => reloj },
    )
  })

  test('un proveedor que falla devuelve lista vacía y no un 500', async () => {
    const roto = createFixtureProvider({ failures: { getTrending: 'http500' } })

    await conApp(
      async ({ pedir }) => {
        const respuesta = await pedir('/api/trending')

        expect(respuesta.status).toBe(200)
        expect(trendingResponseSchema.parse(await respuesta.json()).items).toEqual([])
      },
      { proveedor: roto },
    )
  })

  test('un proveedor sin la capacidad no se consulta y la lista está vacía', async () => {
    const base = createFixtureProvider()
    const sinTendencias = {
      ...base,
      capabilities: { ...base.capabilities, trending: false },
    }

    await conApp(
      async ({ pedir, proveedor }) => {
        const respuesta = await pedir('/api/trending')

        expect(respuesta.status).toBe(200)
        expect(trendingResponseSchema.parse(await respuesta.json()).items).toEqual([])
        expect(proveedor.calls.count('getTrending')).toBe(0)
      },
      { proveedor: sinTendencias },
    )
  })
})

/**
 * El reparto por tipo del top.
 *
 * El fixture declara `media: 'both'` y su catálogo tiene series y una película
 * —`el-jardin-de-hierro`—, que además entra en su top 5: es el único sitio del
 * repositorio donde se puede medir el reparto por `kind` de una fuente mixta sin
 * red y sin inventar datos.
 */
describe('GET /api/trending?media=', () => {
  test('sin pedirlo, la fila trae las dos mitades', async () => {
    await conApp(async ({ pedir }) => {
      const salida = trendingResponseSchema.parse(await (await pedir('/api/trending')).json())

      expect(salida.items.some((item) => item.kind === 'movie')).toBe(true)
      expect(salida.items.some((item) => item.kind === 'tv')).toBe(true)
    })
  })

  test('con `movies`, de una fuente mixta sólo sale la película', async () => {
    await conApp(async ({ pedir }) => {
      const salida = trendingResponseSchema.parse(
        await (await pedir('/api/trending?media=movies')).json(),
      )

      expect(salida.items).toHaveLength(1)
      expect(salida.items[0]?.kind).toBe('movie')
    })
  })

  test('con `anime`, la película de esa misma fuente no sale', async () => {
    await conApp(async ({ pedir }) => {
      const salida = trendingResponseSchema.parse(
        await (await pedir('/api/trending?media=anime')).json(),
      )

      expect(salida.items.length).toBeGreaterThan(1)
      expect(salida.items.every((item) => item.kind !== 'movie')).toBe(true)
    })
  })

  test('a una fuente de anime no se le pregunta por las películas', async () => {
    // La otra mitad de la regla: filtrar los títulos no basta si antes se le ha
    // pedido el top a una fuente que no puede tenerlos. El contador es quien lo
    // dice, y sin esta prueba el filtro de proveedores podría sobrar sin que nada
    // lo notara.
    await conApp(
      async ({ pedir, proveedor }) => {
        const salida = trendingResponseSchema.parse(
          await (await pedir('/api/trending?media=movies')).json(),
        )

        expect(salida.items).toEqual([])
        expect(proveedor.calls.count('getTrending')).toBe(0)
      },
      { proveedor: createFixtureProvider({ media: 'anime' }) },
    )
  })

  test('un tipo que no está en el vocabulario es una petición mal escrita', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/trending?media=anime-y-peliculas')

      expect(respuesta.status).toBe(400)
      expect((await respuesta.json()).error).toContain('anime-y-peliculas')
    })
  })
})
