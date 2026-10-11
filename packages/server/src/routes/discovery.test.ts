/**
 * Las rutas del arranque en frío.
 *
 * Lo que se mide aquí es lo que la home necesita para no quedarse en blanco:
 * que el feed salga sin que nadie haya buscado, que la segunda carga **no**
 * vuelva a pedirlo —el contador del fixture es quien lo dice—, que un proveedor
 * que falla no tumbe la fila, y que «último añadido» enseñe lo que ya está en la
 * base sin tocar la red.
 */

import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations, TTL_SECONDS } from '@nn-anime/catalog-store'
import { type FeedEntry, feedResponseSchema, recentResponseSchema } from '@nn-anime/core'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { MAX_FEED_ENTRIES } from '../container'
import { createApp, createContainer } from '../index'

const PORT = 7717
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }

/** Una entrada de feed mínima, para las pruebas que controlan el contenido. */
function entrada(value: string, title: string): FeedEntry {
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
    readonly buscar?: string
    /** Reloj inyectable: sin él, la caducidad son treinta minutos de espera. */
    readonly now?: () => number
  } = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-discovery-'))
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

    if (opciones.buscar !== undefined) {
      const busqueda = await servidor.request(
        `${BASE}/api/search?q=${encodeURIComponent(opciones.buscar)}`,
        { headers: GOOD },
      )
      // Hay que **consumir** el cuerpo del SSE: la búsqueda se resuelve mientras
      // se lee, y sin leerlo no se cachea nada y la prueba mediría otra cosa.
      await busqueda.text()
    }

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

describe('GET /api/feed', () => {
  test('devuelve las novedades del proveedor sin ninguna búsqueda previa', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/feed')
      const salida = feedResponseSchema.parse(await respuesta.json())

      expect(respuesta.status).toBe(200)
      expect(salida.items.length).toBeGreaterThan(0)
      expect(salida.items[0]?.publishedAt).toBeDefined()
    })
  })

  test('ordena por fecha, lo más nuevo primero', async () => {
    // La fuente los da **al revés** a propósito: si el orden saliera del feed en
    // vez de la fecha, esta prueba lo vería. Con el fixture, que ya viene
    // ordenado, quitar el `sort` no cambiaría nada y la mutación sobreviviría.
    const base = createFixtureProvider()
    const desordenado = {
      ...base,
      capabilities: { ...base.capabilities, feed: true },
      getFeed: async () => [
        {
          ref: { providerId: 'fixture', value: 'vieja' },
          title: 'Vieja',
          publishedAt: '2026-09-01T12:00:00.000Z',
        },
        {
          ref: { providerId: 'fixture', value: 'nueva' },
          title: 'Nueva',
          publishedAt: '2026-10-01T12:00:00.000Z',
        },
      ],
    }

    await conApp(
      async ({ pedir }) => {
        const salida = feedResponseSchema.parse(await (await pedir('/api/feed')).json())

        expect(salida.items.map((item) => item.title)).toEqual(['Nueva', 'Vieja'])
      },
      { proveedor: desordenado },
    )
  })

  test('la segunda petición no vuelve a llamar al proveedor', async () => {
    await conApp(async ({ pedir, proveedor }) => {
      await pedir('/api/feed')
      const primera = proveedor.calls.count('getFeed')

      await pedir('/api/feed')

      expect(primera).toBe(1)
      expect(proveedor.calls.count('getFeed')).toBe(1)
    })
  })

  test('una caché caducada se sirve ya y se revalida por detrás', async () => {
    // El reloj se mueve a mano: lo contrario es esperar media hora de TTL.
    let reloj = Date.now()
    let entradas = [entrada('vieja', 'Vieja')]
    let liberar: (() => void) | undefined
    let llamadas = 0

    const base = createFixtureProvider()
    const cambiante = {
      ...base,
      capabilities: { ...base.capabilities, feed: true },
      getFeed: async () => {
        llamadas += 1
        // El refresco de fondo se queda esperando a que la prueba lo suelte: así
        // se mide que la respuesta **no** espera por él.
        if (llamadas === 2) {
          await new Promise<void>((resolver) => {
            liberar = resolver
          })
        }

        return entradas
      },
    }

    await conApp(
      async ({ pedir, container }) => {
        const primera = feedResponseSchema.parse(await (await pedir('/api/feed')).json())
        expect(primera.items.map((item) => item.title)).toEqual(['Vieja'])

        entradas = [entrada('nueva', 'Nueva')]
        reloj += (TTL_SECONDS.feed + 1) * 1000

        // Caducada: sale lo viejo, ya, y el refresco empieza por detrás.
        const segunda = feedResponseSchema.parse(await (await pedir('/api/feed')).json())
        expect(segunda.items.map((item) => item.title)).toEqual(['Vieja'])
        expect(container.revalidator.running()).toBe(1)

        liberar?.()
        await hastaTerminar(container.revalidator)

        const tercera = feedResponseSchema.parse(await (await pedir('/api/feed')).json())
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
      capabilities: { ...base.capabilities, feed: true },
      getFeed: async () => {
        if (falla) throw new Error('el feed se cayó')

        return [entrada('vieja', 'Vieja')]
      },
    }

    await conApp(
      async ({ pedir, db, container }) => {
        await pedir('/api/feed')

        falla = true
        reloj += (TTL_SECONDS.feed + 1) * 1000

        const caducada = feedResponseSchema.parse(await (await pedir('/api/feed')).json())
        expect(caducada.items.map((item) => item.title)).toEqual(['Vieja'])

        await hastaTerminar(container.revalidator)

        // El refresco falló y la fila vieja sigue ahí: cambiar un dato viejo por
        // ninguno es empeorar.
        const despues = feedResponseSchema.parse(await (await pedir('/api/feed')).json())
        expect(despues.items.map((item) => item.title)).toEqual(['Vieja'])

        const fila = db
          .query<{ resource: string; key: string; message: string }, []>(
            'SELECT resource, key, message FROM revalidate_error',
          )
          .get()

        expect(fila?.resource).toBe('feed')
        expect(fila?.key).toBe('feed#fixture')
        expect(fila?.message).toContain('el feed se cayó')
      },
      { proveedor: quebradizo, now: () => reloj },
    )
  })

  test('un proveedor que falla devuelve lista vacía y no un 500', async () => {
    const roto = createFixtureProvider({ failures: { getFeed: 'http500' } })

    await conApp(
      async ({ pedir }) => {
        const respuesta = await pedir('/api/feed')
        const salida = feedResponseSchema.parse(await respuesta.json())

        expect(respuesta.status).toBe(200)
        expect(salida.items).toEqual([])
      },
      { proveedor: roto },
    )
  })

  test('sin proveedores que declaren feed, la lista está vacía y no es un error', async () => {
    const sinFeed = createFixtureProvider()
    const sinCapacidad = {
      ...sinFeed,
      capabilities: { ...sinFeed.capabilities, feed: false },
    }

    await conApp(
      async ({ pedir }) => {
        const respuesta = await pedir('/api/feed')

        expect(respuesta.status).toBe(200)
        expect(feedResponseSchema.parse(await respuesta.json()).items).toEqual([])
      },
      { proveedor: sinCapacidad },
    )
  })

  test('el límite se recorta al tope y por defecto son diez', async () => {
    await conApp(async ({ pedir }) => {
      const porDefecto = feedResponseSchema.parse(await (await pedir('/api/feed')).json())
      const pedido = feedResponseSchema.parse(await (await pedir('/api/feed?limit=2')).json())
      const absurdo = feedResponseSchema.parse(await (await pedir('/api/feed?limit=9999')).json())

      expect(porDefecto.items.length).toBeLessThanOrEqual(10)
      expect(pedido.items).toHaveLength(2)
      expect(absurdo.items.length).toBeLessThanOrEqual(20)
    })
  })

  test('un feed enorme se recorta antes de guardarse', async () => {
    const base = createFixtureProvider()
    const enorme = {
      ...base,
      capabilities: { ...base.capabilities, feed: true },
      getFeed: async () =>
        Array.from({ length: MAX_FEED_ENTRIES + 50 }, (_valor, indice) => ({
          ref: { providerId: 'fixture', value: `titulo-${indice}` },
          title: `Título ${indice}`,
        })),
    }

    await conApp(
      async ({ pedir, db }) => {
        await pedir('/api/feed?limit=20')

        const fila = db
          .query<{ results_json: string }, []>('SELECT results_json FROM feed_cache')
          .get()

        expect(JSON.parse(fila?.results_json ?? '[]')).toHaveLength(MAX_FEED_ENTRIES)
      },
      { proveedor: enorme },
    )
  })

  test('las entradas sin fecha van al final y no se les inventa una', async () => {
    const base = createFixtureProvider()
    const mezclado = {
      ...base,
      capabilities: { ...base.capabilities, feed: true },
      getFeed: async () => [
        { ref: { providerId: 'fixture', value: 'sin-fecha' }, title: 'Sin fecha' },
        {
          ref: { providerId: 'fixture', value: 'con-fecha' },
          title: 'Con fecha',
          publishedAt: '2026-10-01T12:00:00.000Z',
        },
      ],
    }

    await conApp(
      async ({ pedir }) => {
        const salida = feedResponseSchema.parse(await (await pedir('/api/feed')).json())

        expect(salida.items.map((item) => item.title)).toEqual(['Con fecha', 'Sin fecha'])
      },
      { proveedor: mezclado },
    )
  })

  test('la misma referencia en dos proveedores entra una sola vez', async () => {
    const base = createFixtureProvider()
    const repetido = {
      ...base,
      capabilities: { ...base.capabilities, feed: true },
      getFeed: async () => [
        { ref: { providerId: 'fixture', value: 'repetido' }, title: 'Uno' },
        { ref: { providerId: 'fixture', value: 'repetido' }, title: 'Dos' },
      ],
    }

    await conApp(
      async ({ pedir }) => {
        const salida = feedResponseSchema.parse(await (await pedir('/api/feed')).json())

        expect(salida.items).toHaveLength(1)
        expect(salida.items[0]?.title).toBe('Uno')
      },
      { proveedor: repetido },
    )
  })
})

describe('GET /api/catalog/recent', () => {
  test('sin nada en la base la lista está vacía', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/catalog/recent')

      expect(respuesta.status).toBe(200)
      expect(recentResponseSchema.parse(await respuesta.json()).items).toEqual([])
    })
  })

  test('una búsqueda sin abrir ningún detalle ya deja títulos', async () => {
    await conApp(
      async ({ pedir }) => {
        const salida = recentResponseSchema.parse(await (await pedir('/api/catalog/recent')).json())

        expect(salida.items.length).toBeGreaterThan(0)
      },
      { buscar: 'aurora' },
    )
  })

  test('respeta el límite', async () => {
    await conApp(
      async ({ pedir }) => {
        const salida = recentResponseSchema.parse(
          await (await pedir('/api/catalog/recent?limit=1')).json(),
        )

        expect(salida.items).toHaveLength(1)
      },
      { buscar: 'a' },
    )
  })
})

describe('el motor con una búsqueda y sin detalle abierto', () => {
  test('el destacado y el top 5 dejan de estar vacíos', async () => {
    // El proveedor **no** ofrece tendencias: así lo único que puede llenar el
    // ranking son los títulos que dejó la búsqueda. Con tendencias activas, la
    // prueba pasaría sin candidatos de la caché y no mediría nada.
    const base = createFixtureProvider()
    const sinTendencias = {
      ...base,
      capabilities: { ...base.capabilities, trending: false },
    }

    await conApp(
      async ({ pedir }) => {
        const respuesta = await pedir('/api/recommendations')

        expect(respuesta.status).toBe(200)
        const salida = (await respuesta.json()) as { items: readonly unknown[] }
        expect(salida.items.length).toBeGreaterThan(0)
      },
      { proveedor: sinTendencias, buscar: 'aurora' },
    )
  })

  test('sin búsqueda y sin tendencias el ranking está vacío: no se inventa nada', async () => {
    const base = createFixtureProvider()
    const sinTendencias = {
      ...base,
      capabilities: { ...base.capabilities, trending: false },
    }

    await conApp(
      async ({ pedir }) => {
        const salida = (await (await pedir('/api/recommendations')).json()) as {
          items: readonly unknown[]
        }

        expect(salida.items).toEqual([])
      },
      { proveedor: sinTendencias },
    )
  })
})
