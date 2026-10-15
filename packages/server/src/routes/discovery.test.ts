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
import { fakeAniList, type RawMediaFixture } from '../__fixtures__/anilist'
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
  /** El doble de AniList, sólo si la prueba pidió uno: es quien cuenta las peticiones. */
  readonly anilist: ReturnType<typeof fakeAniList> | undefined
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
    /** Varias fuentes a la vez, cuando lo que se mide es la misma obra en dos. */
    readonly proveedores?: readonly ReturnType<typeof createFixtureProvider>[]
    readonly buscar?: string
    /** Reloj inyectable: sin él, la caducidad son treinta minutos de espera. */
    readonly now?: () => number
    /** Un AniList de mentira, para las pruebas que miden la verificación del feed. */
    readonly anilist?: Parameters<typeof fakeAniList>[0]
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
  const anilist = opciones.anilist === undefined ? undefined : fakeAniList(opciones.anilist)
  const activos = (opciones.proveedores ?? [proveedor]).map((provider, indice) => ({
    provider,
    file: `/plugins/${provider.id}-${indice}.ts`,
  }))

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
      plugins: { active: activos, rejected: [] },
      container,
      // Sin doble de AniList, estas pruebas **no salen a la red**: el feed verifica sus
      // entradas contra AniList, y sin este interruptor cada fila intentaría hablar con
      // un tercero de verdad. La verificación se mide con el doble, que es donde se
      // puede fingir que una obra está marcada.
      anilistOffline: anilist === undefined,
      ...(anilist === undefined
        ? {}
        : { anilistFetchImpl: anilist.impl, anilistResolver: async () => ['140.82.121.3'] }),
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
      anilist,
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

  test('la misma obra en dos fuentes deja una entrada, la más nueva', async () => {
    const base = createFixtureProvider()
    const primera = {
      ...base,
      capabilities: { ...base.capabilities, feed: true },
      getFeed: async () => [
        {
          ref: { providerId: 'fixture', value: 'yani-neko' },
          title: 'Yani Neko',
          year: 2026,
          publishedAt: '2026-10-01T12:00:00.000Z',
        },
      ],
    }
    const segunda = {
      ...base,
      id: 'otra',
      capabilities: { ...base.capabilities, feed: true },
      getFeed: async () => [
        {
          ref: { providerId: 'otra', value: 'yani-neko' },
          // El mismo título escrito de otra manera: sin el plegado de acentos y
          // signos, esta prueba vería dos entradas.
          title: 'yani  neko!',
          year: 2026,
          publishedAt: '2026-09-01T12:00:00.000Z',
        },
      ],
    }

    await conApp(
      async ({ pedir }) => {
        const salida = feedResponseSchema.parse(await (await pedir('/api/feed')).json())

        expect(salida.items).toHaveLength(1)
        // Se queda la más nueva: agrupar no cambia el orden de la fila.
        expect(salida.items[0]?.ref.providerId).toBe('fixture')
      },
      { proveedores: [primera, segunda] },
    )
  })

  test('la misma obra con otro nombre en cada fuente deja una entrada', async () => {
    // Las dos fichas reales de la base: la misma obra, un nombre en cada fuente,
    // y la referencia de cada una apuntando al nombre de la otra. Con la clave de
    // título normalizado esta fila pintaba dos tarjetas.
    const base = createFixtureProvider()
    const primera = {
      ...base,
      capabilities: { ...base.capabilities, feed: true },
      getFeed: async () => [
        {
          ref: { providerId: 'fixture', value: 'danmachi' },
          title: 'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka',
          year: 2015,
          publishedAt: '2026-10-01T12:00:00.000Z',
        },
      ],
    }
    const segunda = {
      ...base,
      id: 'otra',
      capabilities: { ...base.capabilities, feed: true },
      getFeed: async () => [
        {
          ref: {
            providerId: 'otra',
            value: 'dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka',
          },
          title: 'Danmachi',
          year: 2015,
          publishedAt: '2026-09-01T12:00:00.000Z',
        },
      ],
    }

    await conApp(
      async ({ pedir }) => {
        const salida = feedResponseSchema.parse(await (await pedir('/api/feed')).json())

        expect(salida.items).toHaveLength(1)
        expect(salida.items[0]?.title).toBe(
          'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka',
        )
      },
      { proveedores: [primera, segunda] },
    )
  })

  test('el mismo título en años distintos son dos entradas', async () => {
    const base = createFixtureProvider()
    const anio = (value: string, providerId: string, year: number, titulo: string) => ({
      ref: { providerId, value },
      title: titulo,
      year,
      publishedAt: '2026-10-01T12:00:00.000Z',
    })
    const primera = {
      ...base,
      capabilities: { ...base.capabilities, feed: true },
      getFeed: async () => [anio('one-piece', 'fixture', 1999, 'One Piece')],
    }
    const segunda = {
      ...base,
      id: 'otra',
      capabilities: { ...base.capabilities, feed: true },
      getFeed: async () => [anio('one-piece', 'otra', 2026, 'One Piece')],
    }

    await conApp(
      async ({ pedir }) => {
        const salida = feedResponseSchema.parse(await (await pedir('/api/feed')).json())

        // Dos obras homónimas de años distintos no son la misma, y juntarlas
        // escondería una de las dos de la fila.
        expect(salida.items).toHaveLength(2)
      },
      { proveedores: [primera, segunda] },
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

  /**
   * Las filas de la base, escritas a mano.
   *
   * Es lo que mide esta familia de pruebas: qué se pinta cuando la misma obra está
   * en dos fuentes. Pasar por el detalle de un proveedor ataría la prueba al
   * fixture —que tiene una sola fuente— y a la red.
   *
   * Los identificadores son los de los proveedores **cargados**: una lectura
   * local sólo ofrece referencias de un proveedor que está en el registro, así
   * que una fila de un proveedor ausente —lo que queda después de desmarcarlo en
   * Ajustes— no saldría y la prueba mediría el filtro en vez de la agrupación.
   */
  function insertar(
    db: ReturnType<typeof openDb>,
    providerId: string,
    ref: string,
    title: string,
    year: number,
    fetchedAt: number,
  ): void {
    db.query(
      `INSERT INTO anime (provider_id, provider_ref, title, year, fetched_at, ttl_s)
       VALUES (?, ?, ?, ?, ?, 60)`,
    ).run(providerId, ref, title, year, fetchedAt)
  }

  test('la misma obra en dos fuentes deja una tarjeta, la de la marca más nueva', async () => {
    await conApp(
      async ({ pedir, db }) => {
        insertar(db, 'fixture', 'yani-neko', 'Yani Neko', 2026, 2000)
        insertar(db, 'otra', 'yani-neko', 'yani  neko!', 2026, 1000)

        const salida = recentResponseSchema.parse(await (await pedir('/api/catalog/recent')).json())

        expect(salida.items).toHaveLength(1)
        expect(salida.items[0]?.ref.providerId).toBe('fixture')
      },
      { proveedores: [createFixtureProvider(), { ...createFixtureProvider(), id: 'otra' }] },
    )
  })

  test('un título y su temporada son dos tarjetas, no una', async () => {
    await conApp(async ({ pedir, db }) => {
      insertar(db, 'fixture', 'dandadan', 'Dandadan', 2024, 2000)
      insertar(db, 'fixture', 'dandadan-2', 'Dandadan 2nd Season', 2025, 1000)

      const salida = recentResponseSchema.parse(await (await pedir('/api/catalog/recent')).json())

      // La clave de la agrupación no es `baseTitle`: juntarlas escondería una
      // entrega de la fila.
      expect(salida.items).toHaveLength(2)
    })
  })

  test('el tope del límite se aplica después de agrupar, no antes', async () => {
    await conApp(
      async ({ pedir, db }) => {
        // Dos obras, cada una en las dos fuentes, y las cuatro filas entrelazadas:
        // sin el margen de la lectura, pedir dos traería las dos filas de la misma
        // obra y la fila devolvería una sola tarjeta.
        insertar(db, 'fixture', 'uno', 'Uno', 2026, 4000)
        insertar(db, 'otra', 'uno', 'Uno', 2026, 3999)
        insertar(db, 'fixture', 'dos', 'Dos', 2026, 3998)
        insertar(db, 'otra', 'dos', 'Dos', 2026, 3997)

        const salida = recentResponseSchema.parse(
          await (await pedir('/api/catalog/recent?limit=2')).json(),
        )

        expect(salida.items).toHaveLength(2)
        expect(salida.items.map((item) => item.title)).toEqual(['Uno', 'Dos'])
      },
      { proveedores: [createFixtureProvider(), { ...createFixtureProvider(), id: 'otra' }] },
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

/**
 * El tipo pedido, en las dos filas que no vienen de una búsqueda.
 *
 * Son caminos distintos y por eso se miden por separado: el feed se reparte por el
 * `kind` que publica la fuente —que puede servir las dos cosas— y «último añadido»
 * por la media que declara **la fuente de cada título**, que es lo único que se sabe
 * de una fila que ya está en la base.
 */
describe('el tipo pedido en las filas del arranque en frío', () => {
  test('el feed de una fuente mixta se reparte por el `kind` de cada entrada', async () => {
    await conApp(async ({ pedir }) => {
      const todas = feedResponseSchema.parse(await (await pedir('/api/feed?limit=20')).json())
      const peliculas = feedResponseSchema.parse(
        await (await pedir('/api/feed?limit=20&media=movies')).json(),
      )

      expect(todas.items.some((entrada) => entrada.kind === 'movie')).toBe(true)
      expect(peliculas.items.length).toBeGreaterThan(0)
      expect(peliculas.items.every((entrada) => entrada.kind === 'movie')).toBe(true)
      expect(peliculas.items.length).toBeLessThan(todas.items.length)
    })
  })

  test('«último añadido» se reparte por la fuente de cada título', async () => {
    await conApp(
      async ({ pedir, db }) => {
        // El `kind` no es columna: vive en el `raw_json` que escribió el detalle,
        // que es de donde lo lee la fila.
        const insertar = (providerId: string, ref: string, kind: string, fetchedAt: number) => {
          db.query(
            `INSERT INTO anime (provider_id, provider_ref, title, year, fetched_at, ttl_s, raw_json)
             VALUES (?, ?, ?, 2026, ?, 60, ?)`,
          ).run(providerId, ref, ref, fetchedAt, JSON.stringify({ kind }))
        }
        insertar('anime', 'serie-de-anime', 'tv', 2000)
        insertar('pelis', 'pelicula-de-pelis', 'movie', 1000)

        const peliculas = recentResponseSchema.parse(
          await (await pedir('/api/catalog/recent?media=movies')).json(),
        )
        const anime = recentResponseSchema.parse(
          await (await pedir('/api/catalog/recent?media=anime')).json(),
        )

        expect(peliculas.items.map((item) => item.ref.value)).toEqual(['pelicula-de-pelis'])
        expect(anime.items.map((item) => item.ref.value)).toEqual(['serie-de-anime'])
      },
      {
        proveedores: [
          createFixtureProvider({ id: 'anime', media: 'anime' }),
          createFixtureProvider({ id: 'pelis', media: 'movies' }),
        ],
      },
    )
  })

  test('sin el parámetro, las dos filas traen lo de siempre', async () => {
    await conApp(
      async ({ pedir, db }) => {
        db.query(
          `INSERT INTO anime (provider_id, provider_ref, title, year, fetched_at, ttl_s, raw_json)
           VALUES ('pelis', 'pelicula-de-pelis', 'Una película', 2026, 1000, 60, ?)`,
        ).run(JSON.stringify({ kind: 'movie' }))

        const sinFiltro = recentResponseSchema.parse(
          await (await pedir('/api/catalog/recent')).json(),
        )

        // Es lo que mantiene funcionando a quien ya leía la ruta sin conocer el
        // parámetro: la ausencia de filtro no puede significar «sólo anime».
        expect(sinFiltro.items.map((item) => item.ref.value)).toEqual(['pelicula-de-pelis'])
      },
      { proveedores: [createFixtureProvider({ id: 'pelis', media: 'movies' })] },
    )
  })
})

/**
 * El filtro donde no hay señal.
 *
 * El feed de una fuente no publica la edad de sus entradas, así que la única forma de
 * saber que una es para adultos es preguntarle a AniList. Es la procedencia de
 * **Novedades** cuando AniList no responde, y la que la aprobación de este trabajo puso
 * como condición.
 */
describe('el filtro de adultos en el feed', () => {
  const ADULTA: RawMediaFixture = { id: 700, romaji: 'Obra Marcada', year: 2024, isAdult: true }
  const NORMAL: RawMediaFixture = { id: 701, romaji: 'Obra Normal', year: 2023 }

  /** Un feed de dos entradas, la marcada **la más nueva**: así el orden y el tope se miden. */
  function conDosEntradas(): ReturnType<typeof createFixtureProvider> {
    const base = createFixtureProvider()

    return {
      ...base,
      capabilities: { ...base.capabilities, feed: true },
      getFeed: async (): Promise<readonly FeedEntry[]> => [
        {
          ref: { providerId: 'fixture', value: 'marcada' },
          title: 'Obra Marcada',
          publishedAt: '2026-10-01T12:00:00.000Z',
        },
        {
          ref: { providerId: 'fixture', value: 'normal' },
          title: 'Obra Normal',
          publishedAt: '2026-09-01T12:00:00.000Z',
        },
      ],
    }
  }

  const BUSQUEDA = { search: { 'Obra Marcada': [ADULTA], 'Obra Normal': [NORMAL] } }

  test('apagado, la entrada marcada no sale, y queda marcada', async () => {
    await conApp(
      async ({ pedir, db }) => {
        const salida = feedResponseSchema.parse(await (await pedir('/api/feed')).json())

        expect(salida.items.map((item) => item.title)).toEqual(['Obra Normal'])

        // La marca es lo que evita volver a preguntar por ella en la carga siguiente.
        const filas = db.query('SELECT COUNT(*) AS total FROM adult_ref').get() as { total: number }

        expect(filas.total).toBe(1)
      },
      { proveedor: conDosEntradas(), anilist: BUSQUEDA },
    )
  })

  test('con la marca puesta, la carga siguiente no pregunta por lo marcado', async () => {
    await conApp(
      async ({ pedir, anilist }) => {
        await pedir('/api/feed')
        const antes = anilist?.calls.length ?? 0
        expect(antes).toBeGreaterThan(0)

        await pedir('/api/feed')

        expect(anilist?.calls.length ?? 0).toBe(antes)
      },
      { proveedor: conDosEntradas(), anilist: BUSQUEDA },
    )
  })

  test('el descarte va antes del tope: la fila no sale corta', async () => {
    await conApp(
      async ({ pedir }) => {
        const salida = feedResponseSchema.parse(await (await pedir('/api/feed?limit=1')).json())

        // La marcada es la más nueva: sin el margen, el recorte la habría elegido y la
        // fila se habría quedado vacía en vez de enseñar la siguiente.
        expect(salida.items.map((item) => item.title)).toEqual(['Obra Normal'])
      },
      { proveedor: conDosEntradas(), anilist: BUSQUEDA },
    )
  })

  test('encendido, la entrada ya marcada sale con su marca', async () => {
    await conApp(
      async ({ pedir }) => {
        // La primera carga —con el interruptor apagado— es la que aprende la marca.
        await pedir('/api/feed')
        await pedir('/api/settings', {
          method: 'PATCH',
          headers: { ...GOOD, 'content-type': 'application/json' },
          body: JSON.stringify({ adultContent: true }),
        })

        const salida = feedResponseSchema.parse(await (await pedir('/api/feed')).json())

        expect(salida.items.map((item) => item.title)).toEqual(['Obra Marcada', 'Obra Normal'])
        expect(salida.items[0]?.adult).toBe(true)
        expect(salida.items[1]?.adult).toBeUndefined()
      },
      { proveedor: conDosEntradas(), anilist: BUSQUEDA },
    )
  })
})
