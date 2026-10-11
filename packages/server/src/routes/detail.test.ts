import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import type { AnimeDetail, ProviderRef } from '@nn-anime/core'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { createApp, createContainer } from '../index'

const PORT = 7718
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }
const JSON_HEADERS = { ...GOOD, 'content-type': 'application/json' }

const REF = 'aurora-nocturna'
const SAGA: ProviderRef = { providerId: 'fixture', value: 'aurora-nocturna-2' }

function detalle(ref: ProviderRef, title: string, year: number): AnimeDetail {
  return {
    ref,
    title,
    year,
    kind: 'tv',
    genres: ['Acción'],
    studios: ['Estudio Cobre'],
  }
}

interface Contexto {
  readonly pedir: (ruta: string, init?: RequestInit) => Promise<Response>
  /** El almacén, para las fichas que una prueba necesite escribir de más. */
  readonly store: ReturnType<typeof createContainer>['store']
}

async function conApp<T>(body: (contexto: Contexto) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-detail-'))
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

    // La saga, escrita a mano: el catálogo de la fuente de prueba no trae
    // segundas temporadas, y lo que se mide aquí es la lectura local.
    await container.store.writeAnime(
      { providerId: 'fixture', value: REF },
      detalle({ providerId: 'fixture', value: REF }, 'Aurora Nocturna', 2019),
    )
    await container.store.writeAnime(SAGA, detalle(SAGA, 'Aurora Nocturna 2nd Season', 2021))

    return await body({
      store: container.store,
      pedir: async (ruta, init) =>
        await Promise.resolve(servidor.request(`${BASE}${ruta}`, init ?? { headers: GOOD })),
    })
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

describe('GET /api/anime/:providerId/:ref/related', () => {
  test('devuelve el hermano de saga y no el título pedido', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir(`/api/anime/fixture/${SAGA.value}/related`)
      const cuerpo = (await respuesta.json()) as { items: readonly { ref: ProviderRef }[] }

      expect(respuesta.status).toBe(200)
      expect(cuerpo.items.map((item) => item.ref.value)).toEqual([REF])
    })
  })

  test('un proveedor desconocido es 404', async () => {
    await conApp(async ({ pedir }) => {
      expect((await pedir(`/api/anime/no-existe/${REF}/related`)).status).toBe(404)
    })
  })

  /**
   * El alcance de la lectura, por la ruta.
   *
   * «Aurora Nocturna Shippuden» es otra saga —la fuente la nombra como una obra
   * distinta— y la misma franquicia. Sin `?scope=` la sección de siempre no la
   * lista; con `?scope=franchise`, sí. Y un valor que nadie pidió no es un error:
   * cae al alcance de siempre, que es lo que la interfaz vieja espera.
   */
  test('el alcance de franquicia junta la secuela con otro nombre', async () => {
    await conApp(async ({ pedir, store }) => {
      const secuela: ProviderRef = { providerId: 'fixture', value: 'aurora-nocturna-shippuden' }
      await store.writeAnime(secuela, detalle(secuela, 'Aurora Nocturna Shippuden', 2023))

      const leer = async (ruta: string) =>
        (
          (await (await pedir(ruta)).json()) as { items: readonly { ref: ProviderRef }[] }
        ).items.map((item) => item.ref.value)

      // Sin alcance, la saga de «Aurora Nocturna» es ella y su segunda temporada.
      expect(await leer(`/api/anime/fixture/${REF}/related`)).toEqual(['aurora-nocturna-2'])
      // Con alcance de franquicia, la segunda temporada sigue estando —la
      // franquicia contiene a la saga— y se suma la secuela con otro nombre, en
      // el orden de cercanía de año que ya tenía la lectura.
      expect(await leer(`/api/anime/fixture/${REF}/related?scope=franchise`)).toEqual([
        'aurora-nocturna-2',
        'aurora-nocturna-shippuden',
      ])
      // Un alcance que no existe no rompe la petición: manda el de siempre.
      expect(await leer(`/api/anime/fixture/${REF}/related?scope=basura`)).toEqual([
        'aurora-nocturna-2',
      ])
    })
  })

  test('una referencia que no está en la base es lista vacía, no 404', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/anime/fixture/no-abierto/related')
      const cuerpo = (await respuesta.json()) as { items: readonly unknown[] }

      expect(respuesta.status).toBe(200)
      expect(cuerpo.items).toEqual([])
    })
  })

  test('el límite se sanea: un valor absurdo no lee la tabla entera', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir(`/api/anime/fixture/${SAGA.value}/related?limit=99999`)
      const cuerpo = (await respuesta.json()) as { items: readonly unknown[] }

      expect(respuesta.status).toBe(200)
      expect(cuerpo.items.length).toBeLessThanOrEqual(24)
    })
  })

  test('no llama al proveedor: con la lista de plugins vacía sigue contestando', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nn-anime-detail-sin-'))
    const db = openDb(join(dir, 'nn-anime.db'))
    runMigrations(db)
    const container = createContainer({ db })

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
        plugins: { active: [], rejected: [] },
        container,
      })
      await container.store.writeAnime(SAGA, detalle(SAGA, 'Aurora Nocturna 2nd Season', 2021))

      // Sin el proveedor cargado la ruta responde 404 y no toca la red: es una
      // lectura local, y lo que se comprueba es que no hay ninguna llamada.
      const respuesta = await servidor.request(`${BASE}/api/anime/fixture/${SAGA.value}/related`, {
        headers: GOOD,
      })

      expect(respuesta.status).toBe(404)
    } finally {
      await container.close().catch(() => {})
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('GET /api/anime/:providerId/:ref/watched', () => {
  test('el episodio terminado sale marcado y deja de estar en «continuar viendo»', async () => {
    await conApp(async ({ pedir }) => {
      // El episodio tiene que existir: la clave foránea lo exige, y el flujo real
      // es abrir la ficha antes de reproducir.
      await pedir(`/api/anime/fixture/${REF}/episodes`)

      const alta = await pedir('/api/watch', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          animeRef: { providerId: 'fixture', value: REF },
          episodeRef: { providerId: 'fixture', value: `${REF}#1` },
          mode: 'sub',
        }),
      })
      const { id } = (await alta.json()) as { id: number }

      await pedir(`/api/watch/${id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 1380, durationS: 1440 }),
      })

      const vistos = (await (await pedir(`/api/anime/fixture/${REF}/watched`)).json()) as {
        episodes: readonly { number: number; finished: boolean; ratio: number }[]
      }

      expect(vistos.episodes).toHaveLength(1)
      expect(vistos.episodes[0]?.number).toBe(1)
      expect(vistos.episodes[0]?.finished).toBe(true)

      const continuar = (await (await pedir('/api/watch/recent')).json()) as {
        items: readonly unknown[]
      }

      // Sin el corte por `finished`, este episodio seguiría en la fila.
      expect(continuar.items).toEqual([])
    })
  })

  test('un episodio a medias sigue en «continuar viendo» y no está terminado', async () => {
    await conApp(async ({ pedir }) => {
      await pedir(`/api/anime/fixture/${REF}/episodes`)

      const alta = await pedir('/api/watch', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          animeRef: { providerId: 'fixture', value: REF },
          episodeRef: { providerId: 'fixture', value: `${REF}#2` },
          mode: 'sub',
        }),
      })
      const { id } = (await alta.json()) as { id: number }

      await pedir(`/api/watch/${id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 720, durationS: 1440 }),
      })

      const vistos = (await (await pedir(`/api/anime/fixture/${REF}/watched`)).json()) as {
        episodes: readonly { finished: boolean; ratio: number }[]
      }
      const continuar = (await (await pedir('/api/watch/recent')).json()) as {
        items: readonly unknown[]
      }

      expect(vistos.episodes[0]?.finished).toBe(false)
      expect(vistos.episodes[0]?.ratio).toBe(0.5)
      expect(continuar.items).toHaveLength(1)
    })
  })

  test('un proveedor desconocido es 404 y una referencia sin abrir, lista vacía', async () => {
    await conApp(async ({ pedir }) => {
      const desconocido = await pedir(`/api/anime/no-existe/${REF}/watched`)
      const vacio = await pedir('/api/anime/fixture/no-abierto/watched')

      expect([desconocido.status, vacio.status]).toEqual([404, 200])
      expect(((await vacio.json()) as { episodes: readonly unknown[] }).episodes).toEqual([])
    })
  })

  test('exige sesión', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir(`/api/anime/fixture/${REF}/watched`, {
        headers: { origin: BASE },
      })

      expect(respuesta.status).toBe(401)
    })
  })
})
