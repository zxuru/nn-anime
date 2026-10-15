/**
 * Las rutas de episodios por página.
 *
 * Prueban las dos fuentes de una página con un contador dentro del proveedor
 * falso: «no llamó al proveedor» sólo se puede afirmar contando, y el contador
 * vive aquí porque `providers-fixture` no se toca para esta tarea.
 *
 * El proveedor paginado decide su propio tamaño de página (2, para que quepan
 * varias en una prueba corta): el contrato no lo fija y la ruta no lo supone.
 */

import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import {
  type Episode,
  episodeResponseSchema,
  episodesResponseSchema,
  ProviderError,
} from '@nn-anime/core'
import type { Provider } from '@nn-anime/provider-sdk'
import { createApp, createContainer } from '../index'

const PORT = 7718
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BOOT_TOKEN = 'token'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }

const REF = 'aurora-nocturna'

interface Respuesta {
  readonly status: number
  readonly cache: string | null
  readonly body: unknown
}

type Pedir = (ruta: string) => Promise<Respuesta>

interface Falso {
  readonly provider: Provider
  readonly cuentas: Map<string, number>
}

/** Un episodio válido del proveedor falso. */
function episodio(providerId: string, number: number): Episode {
  return {
    ref: { providerId, value: `${REF}-${number}` },
    animeRef: { providerId, value: REF },
    number,
    mode: 'sub',
  }
}

function lista(providerId: string, cuantos: number): readonly Episode[] {
  return Array.from({ length: cuantos }, (_, indice) => episodio(providerId, indice + 1))
}

/**
 * Una lista marcada con temporadas, con la numeración global seguida.
 *
 * `temporadas` son los episodios de cada una —`[110, 40]` es una temporada 1 de
 * 110 y una 2 de 40, con los números globales 1..150—, que es como las numera una
 * fuente que las junta en un solo título: el marcador del título dice la
 * temporada y el número del contrato es el del título entero.
 */
function marcada(providerId: string, temporadas: readonly number[]): readonly Episode[] {
  const lista: Episode[] = []
  let global = 1

  for (const [indice, cuantos] of temporadas.entries()) {
    for (let inSeason = 1; inSeason <= cuantos; inSeason++) {
      lista.push({ ...episodio(providerId, global), title: `T${indice + 1} E${inSeason} · Algo` })
      global += 1
    }
  }

  return lista
}

function contador(): { cuentas: Map<string, number>; suma: (metodo: string) => void } {
  const cuentas = new Map<string, number>()

  return {
    cuentas,
    suma: (metodo) => cuentas.set(metodo, (cuentas.get(metodo) ?? 0) + 1),
  }
}

function capacidadPaginada(): Provider['capabilities'] {
  return { search: false, sub: true, dub: false, trending: false, feed: false, episodePages: true }
}

function detalle(providerId: string): Awaited<ReturnType<Provider['getAnime']>> {
  return { ref: { providerId, value: REF }, title: 'Aurora Nocturna', genres: [], studios: [] }
}

function errorDeEstado(providerId: string, op: string, estado: number): ProviderError {
  return new ProviderError({
    message: `el sitio respondió ${estado}`,
    scope: providerId,
    op,
    context: { estado },
  })
}

/**
 * Un proveedor que pagina: dos episodios por página y dice su total.
 *
 * `fallo` devuelve el estado que el upstream daría en el método nombrado, para
 * medir que la ruta conserva el criterio de siempre (404 es 404, lo demás 502).
 */
function crearPaginado(
  episodios: readonly Episode[],
  fallo?: {
    readonly metodo: 'getEpisodesPage' | 'getEpisode' | 'getLatestEpisode'
    readonly estado: number
  },
): Falso {
  const providerId = 'paginado'
  const { cuentas, suma } = contador()

  const provider: Provider = {
    id: providerId,
    name: 'Paginado',
    apiVersion: '1',
    capabilities: capacidadPaginada(),
    search: async () => [],
    getAnime: async () => detalle(providerId),
    getEpisodes: async () => [],
    resolveStream: async () => [],

    getEpisodesPage: async (_ref, page) => {
      suma('getEpisodesPage')
      if (fallo?.metodo === 'getEpisodesPage')
        throw errorDeEstado(providerId, 'getEpisodesPage', fallo.estado)

      return {
        episodes: episodios.slice((page - 1) * 2, page * 2),
        page,
        hasMore: page * 2 < episodios.length,
        total: episodios.length,
      }
    },

    getEpisode: async (_ref, number) => {
      suma('getEpisode')
      if (fallo?.metodo === 'getEpisode')
        throw errorDeEstado(providerId, 'getEpisode', fallo.estado)

      const encontrado = episodios.find((candidato) => candidato.number === number)
      if (encontrado === undefined) throw errorDeEstado(providerId, 'getEpisode', 404)

      return encontrado
    },

    getLatestEpisode: async (_ref) => {
      suma('getLatestEpisode')
      if (fallo?.metodo === 'getLatestEpisode') {
        throw errorDeEstado(providerId, 'getLatestEpisode', fallo.estado)
      }

      const ultimo = episodios.at(-1)
      if (ultimo === undefined) throw errorDeEstado(providerId, 'getLatestEpisode', 404)

      return ultimo
    },
  }

  return { provider, cuentas }
}

/** Un proveedor que no declara `episodePages`: lista completa y sin paginar. */
function crearSimple(episodios: readonly Episode[]): Falso {
  const providerId = 'simple'
  const { cuentas, suma } = contador()

  const provider: Provider = {
    id: providerId,
    name: 'Simple',
    apiVersion: '1',
    capabilities: { search: false, sub: true, dub: false, trending: false, feed: false },
    search: async () => [],
    getAnime: async () => detalle(providerId),
    getEpisodes: async () => {
      suma('getEpisodes')
      return episodios
    },
    resolveStream: async () => [],
  }

  return { provider, cuentas }
}

async function conApp<T>(provider: Provider, body: (pedir: Pedir) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-episodios-'))
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
      bootToken: BOOT_TOKEN,
      version: '0.1.0',
      plugins: { active: [{ provider, file: '/plugins/falso.ts' }], rejected: [] },
      container,
    })

    const pedir: Pedir = async (ruta) => {
      const respuesta = await servidor.request(`${BASE}${ruta}`, { headers: GOOD })

      let cuerpo: unknown = null
      try {
        cuerpo = await respuesta.json()
      } catch {
        cuerpo = null
      }

      return { status: respuesta.status, cache: respuesta.headers.get('x-cache'), body: cuerpo }
    }

    return await body(pedir)
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

describe('GET /api/anime/:providerId/:ref/episodes con un proveedor paginado', () => {
  test('una página se pide una vez y la segunda petición no toca al proveedor', async () => {
    const { provider, cuentas } = crearPaginado(lista('paginado', 6))

    await conApp(provider, async (pedir) => {
      const primera = await pedir(`/api/anime/paginado/${REF}/episodes?page=2`)
      const segunda = await pedir(`/api/anime/paginado/${REF}/episodes?page=2`)
      const cuerpo = episodesResponseSchema.parse(segunda.body)

      expect(primera.status).toBe(200)
      expect(cuerpo.page).toBe(2)
      expect(cuerpo.episodes.map((episodio) => episodio.number)).toEqual([3, 4])
      expect(primera.cache).toBe('miss')
      expect(segunda.cache).toBe('hit')
      expect(cuentas.get('getEpisodesPage')).toBe(1)
      // La lista completa no se pide nunca cuando el proveedor sabe paginar.
      expect(cuentas.get('getEpisodes')).toBeUndefined()
    })
  })

  test('sin `?page=` la página es la 1', async () => {
    const { provider } = crearPaginado(lista('paginado', 6))

    await conApp(provider, async (pedir) => {
      const respuesta = await pedir(`/api/anime/paginado/${REF}/episodes`)
      const cuerpo = episodesResponseSchema.parse(respuesta.body)

      expect(respuesta.status).toBe(200)
      expect(cuerpo.page).toBe(1)
      expect(cuerpo.episodes.map((episodio) => episodio.number)).toEqual([1, 2])
      expect(cuerpo.hasMore).toBe(true)
    })
  })

  test('`?page=0` y `?page=abc` son 400 y no llaman al proveedor', async () => {
    const { provider, cuentas } = crearPaginado(lista('paginado', 6))

    await conApp(provider, async (pedir) => {
      for (const consulta of ['page=0', 'page=abc', 'page=1.5', 'page=']) {
        const respuesta = await pedir(`/api/anime/paginado/${REF}/episodes?${consulta}`)

        expect(respuesta.status).toBe(400)
        expect(JSON.stringify(respuesta.body)).toContain('página')
      }

      expect(cuentas.get('getEpisodesPage')).toBeUndefined()
    })
  })

  test('un 404 del sitio es 404 y un 500 es 502', async () => {
    const noExiste = crearPaginado(lista('paginado', 6), {
      metodo: 'getEpisodesPage',
      estado: 404,
    })
    const roto = crearPaginado(lista('paginado', 6), { metodo: 'getEpisodesPage', estado: 500 })

    await conApp(noExiste.provider, async (pedir) => {
      const respuesta = await pedir(`/api/anime/paginado/${REF}/episodes?page=3`)

      expect(respuesta.status).toBe(404)
    })

    await conApp(roto.provider, async (pedir) => {
      const respuesta = await pedir(`/api/anime/paginado/${REF}/episodes?page=3`)

      expect(respuesta.status).toBe(502)
    })
  })
})

describe('GET /api/anime/:providerId/:ref/episodes sin paginación del proveedor', () => {
  test('la lista completa se trocea y `total` es su longitud', async () => {
    const { provider, cuentas } = crearSimple(lista('simple', 150))

    await conApp(provider, async (pedir) => {
      const primera = episodesResponseSchema.parse(
        (await pedir(`/api/anime/simple/${REF}/episodes`)).body,
      )
      const segunda = episodesResponseSchema.parse(
        (await pedir(`/api/anime/simple/${REF}/episodes?page=2`)).body,
      )

      expect(primera.episodes.length).toBe(100)
      expect(primera.page).toBe(1)
      expect(primera.hasMore).toBe(true)
      expect(primera.total).toBe(150)

      expect(segunda.episodes.length).toBe(50)
      expect(segunda.page).toBe(2)
      expect(segunda.hasMore).toBe(false)
      expect(segunda.total).toBe(150)

      // Una sola vez: la segunda página sale de la lista cacheada.
      expect(cuentas.get('getEpisodes')).toBe(1)
    })
  })
})

describe('las temporadas de un título', () => {
  test('el índice viaja con la página que se mire, no sólo con la primera', async () => {
    const { provider } = crearSimple(marcada('simple', [110, 40]))

    await conApp(provider, async (pedir) => {
      const primera = episodesResponseSchema.parse(
        (await pedir(`/api/anime/simple/${REF}/episodes`)).body,
      )
      const segunda = episodesResponseSchema.parse(
        (await pedir(`/api/anime/simple/${REF}/episodes?page=2`)).body,
      )

      // El índice describe el título entero —el selector tiene que poder ofrecer
      // todas las temporadas desde cualquier página— y el orden es el de la
      // fuente.
      expect(primera.seasons).toEqual([
        { season: 1, count: 110 },
        { season: 2, count: 40 },
      ])
      expect(segunda.seasons).toEqual(primera.seasons)
      // Y la página de la lista entera sigue siendo de cien.
      expect(primera.episodes.length).toBe(100)
      expect(segunda.episodes.length).toBe(50)
    })
  })

  test('pedir una temporada devuelve sus episodios y numera contra el título', async () => {
    const { provider, cuentas } = crearSimple(marcada('simple', [110, 40]))

    await conApp(provider, async (pedir) => {
      const respuesta = await pedir(`/api/anime/simple/${REF}/episodes?season=2`)
      const cuerpo = episodesResponseSchema.parse(respuesta.body)

      expect(respuesta.status).toBe(200)
      expect(cuerpo.episodes.length).toBe(40)
      expect(cuerpo.episodes[0]?.number).toBe(111)
      expect(cuerpo.episodes[0]?.title).toBe('T2 E1 · Algo')
      // El total es el del título: la fila numera «Episodio 111 de 150», que es
      // la etiqueta de la fuente y lo que enseña el reproductor.
      expect(cuerpo.total).toBe(150)
      expect(cuerpo.page).toBe(1)
      expect(cuerpo.hasMore).toBe(false)
      expect(cuerpo.seasons).toEqual([
        { season: 1, count: 110 },
        { season: 2, count: 40 },
      ])
      // Y la lista entera sigue pidiéndose una sola vez.
      expect(cuentas.get('getEpisodes')).toBe(1)
    })
  })

  test('la temporada se pagina por su cuenta: la página 2 es la suya', async () => {
    const { provider } = crearSimple(marcada('simple', [110, 40]))

    await conApp(provider, async (pedir) => {
      const cuerpo = episodesResponseSchema.parse(
        (await pedir(`/api/anime/simple/${REF}/episodes?season=1&page=2`)).body,
      )

      expect(cuerpo.episodes.length).toBe(10)
      expect(cuerpo.episodes.map((episodio) => episodio.number)).toEqual([
        101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
      ])
      expect(cuerpo.page).toBe(2)
      expect(cuerpo.hasMore).toBe(false)
    })
  })

  test('una temporada que no está es 404 con el motivo', async () => {
    const { provider } = crearSimple(marcada('simple', [110, 40]))

    await conApp(provider, async (pedir) => {
      const respuesta = await pedir(`/api/anime/simple/${REF}/episodes?season=9`)

      expect(respuesta.status).toBe(404)
      expect(JSON.stringify(respuesta.body)).toContain('temporada 9')
    })
  })

  test('una lista sin marcar no tiene índice, y pedir temporada no inventa una', async () => {
    const { provider } = crearSimple(lista('simple', 30))

    await conApp(provider, async (pedir) => {
      const sinIndice = episodesResponseSchema.parse(
        (await pedir(`/api/anime/simple/${REF}/episodes`)).body,
      )

      // Agrupar escondería lo que no declara temporada: no hay índice que dar.
      expect(sinIndice.seasons).toBeUndefined()
      expect((await pedir(`/api/anime/simple/${REF}/episodes?season=1`)).status).toBe(404)
    })
  })

  test('una temporada no numérica es 400 y no lee la lista', async () => {
    const { provider, cuentas } = crearSimple(marcada('simple', [12, 12]))

    await conApp(provider, async (pedir) => {
      for (const consulta of ['season=0', 'season=abc', 'season=1.5', 'season=']) {
        const respuesta = await pedir(`/api/anime/simple/${REF}/episodes?${consulta}`)

        expect(respuesta.status).toBe(400)
        expect(JSON.stringify(respuesta.body)).toContain('temporada')
      }

      expect(cuentas.get('getEpisodes')).toBeUndefined()
    })
  })

  test('una fuente que pagina por su cuenta no puede dar una temporada', async () => {
    const { provider, cuentas } = crearPaginado(marcada('paginado', [12, 12]))

    await conApp(provider, async (pedir) => {
      const respuesta = await pedir(`/api/anime/paginado/${REF}/episodes?season=2`)

      // No es un 404: la fuente tiene la temporada. Lo que no puede es contestar
      // por ella sin leer su catálogo entero.
      expect(respuesta.status).toBe(400)
      expect(JSON.stringify(respuesta.body)).toContain('temporada')
      expect(cuentas.get('getEpisodesPage')).toBeUndefined()
    })
  })
})

describe('GET /api/anime/:providerId/:ref/episodes/latest', () => {
  test('con la lista cacheada no llama al proveedor y da el mayor número', async () => {
    const episodios = [
      episodio('simple', 1),
      episodio('simple', 2),
      episodio('simple', 12.5),
      episodio('simple', 3),
    ]
    const { provider, cuentas } = crearSimple(episodios)

    await conApp(provider, async (pedir) => {
      await pedir(`/api/anime/simple/${REF}/episodes`)

      const respuesta = await pedir(`/api/anime/simple/${REF}/episodes/latest`)
      const cuerpo = episodeResponseSchema.parse(respuesta.body)

      expect(respuesta.status).toBe(200)
      expect(cuerpo.episode.number).toBe(12.5)
      expect(cuentas.get('getEpisodes')).toBe(1)
    })
  })

  test('un título sin episodios es 404 con el motivo', async () => {
    const { provider } = crearSimple([])

    await conApp(provider, async (pedir) => {
      const respuesta = await pedir(`/api/anime/simple/${REF}/episodes/latest`)

      expect(respuesta.status).toBe(404)
      expect(JSON.stringify(respuesta.body)).toContain('no tiene episodios')
    })
  })

  test('con un proveedor paginado lo pide a él, sin traer la lista', async () => {
    const { provider, cuentas } = crearPaginado(lista('paginado', 6))

    await conApp(provider, async (pedir) => {
      const respuesta = await pedir(`/api/anime/paginado/${REF}/episodes/latest`)
      const cuerpo = episodeResponseSchema.parse(respuesta.body)

      expect(cuerpo.episode.number).toBe(6)
      expect(cuentas.get('getLatestEpisode')).toBe(1)
      expect(cuentas.get('getEpisodes')).toBeUndefined()
    })
  })
})

describe('GET /api/anime/:providerId/:ref/episodes/number/:n', () => {
  test('devuelve el episodio decimal de la lista cacheada', async () => {
    const episodios = [episodio('simple', 1), episodio('simple', 7.5), episodio('simple', 8)]
    const { provider, cuentas } = crearSimple(episodios)

    await conApp(provider, async (pedir) => {
      const respuesta = await pedir(`/api/anime/simple/${REF}/episodes/number/7.5`)
      const cuerpo = episodeResponseSchema.parse(respuesta.body)

      expect(respuesta.status).toBe(200)
      expect(cuerpo.episode.number).toBe(7.5)
      expect(cuentas.get('getEpisodes')).toBe(1)
    })
  })

  test('un número que no está es 404, nunca una página vacía', async () => {
    const { provider } = crearSimple([episodio('simple', 1), episodio('simple', 2)])

    await conApp(provider, async (pedir) => {
      const respuesta = await pedir(`/api/anime/simple/${REF}/episodes/number/999`)

      expect(respuesta.status).toBe(404)
      expect(JSON.stringify(respuesta.body)).toContain('999')
    })
  })

  test('un número negativo o no numérico es 400', async () => {
    const { provider, cuentas } = crearSimple([episodio('simple', 1)])

    await conApp(provider, async (pedir) => {
      for (const numero of ['-1', 'abc', 'Infinity']) {
        const respuesta = await pedir(`/api/anime/simple/${REF}/episodes/number/${numero}`)

        expect(respuesta.status).toBe(400)
        expect(JSON.stringify(respuesta.body)).toContain('número')
      }

      expect(cuentas.get('getEpisodes')).toBeUndefined()
    })
  })

  test('con un proveedor paginado se lo pide a él', async () => {
    const { provider, cuentas } = crearPaginado(lista('paginado', 6))

    await conApp(provider, async (pedir) => {
      const respuesta = await pedir(`/api/anime/paginado/${REF}/episodes/number/4`)
      const cuerpo = episodeResponseSchema.parse(respuesta.body)

      expect(cuerpo.episode.number).toBe(4)
      expect(cuentas.get('getEpisode')).toBe(1)
      expect(cuentas.get('getEpisodesPage')).toBeUndefined()
    })
  })

  test('el 404 del proveedor al buscar un número es 404', async () => {
    const { provider } = crearPaginado(lista('paginado', 6), { metodo: 'getEpisode', estado: 404 })

    await conApp(provider, async (pedir) => {
      const respuesta = await pedir(`/api/anime/paginado/${REF}/episodes/number/999`)

      expect(respuesta.status).toBe(404)
    })
  })
})
