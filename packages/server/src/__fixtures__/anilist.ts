/**
 * Un AniList de mentira para las pruebas del servidor.
 *
 * Vive en `__fixtures__` porque lo usan tres: el cliente, el catálogo con su
 * caché y las rutas. Un doble escrito tres veces se separa, y el tercero
 * devolvería una forma distinta de la que el cliente valida.
 *
 * No sale a la red: contesta al POST de GraphQL mirando qué consulta es —el top,
 * la parrilla, lo recién emitido, el lote de búsqueda— y devuelve la obra de
 * cada caso con **nombres reales**, que es lo que hace que las pruebas de
 * emparejamiento midan la identidad de verdad y no una cadena inventada.
 *
 * Los `calls` guardan la consulta y las variables de cada petición: es lo que
 * permite comprobar que la caché evita la segunda y que el lote va en una sola.
 */

import type { FetchLike } from '@nn-anime/media-proxy'
import { ANILIST_IMAGE_HOSTS } from '../anilist/client'

/** Una obra cruda de AniList, con lo que la aplicación lee. */
export interface RawMediaFixture {
  readonly id: number
  readonly romaji: string
  readonly english?: string
  readonly native?: string
  readonly synonyms?: readonly string[]
  readonly format?: string
  readonly status?: string
  readonly year?: number
  /** Si la obra es para adultos. Por defecto no: es el caso corriente. */
  readonly isAdult?: boolean
  readonly episodes?: number
  readonly duration?: number
  readonly score?: number
  readonly description?: string
  readonly genres?: readonly string[]
  readonly studios?: readonly string[]
  readonly cover?: string
  readonly banner?: string
  readonly siteUrl?: string
  /** La portada apunta a un host que no es el de AniList: el caso hostil. */
  readonly coverFuera?: boolean
}

export interface AniListCall {
  readonly query: string
  readonly variables: Readonly<Record<string, unknown>>
}

export interface FakeAniList {
  readonly impl: FetchLike
  readonly calls: readonly AniListCall[]
  /** Las peticiones a su CDN de imágenes, en orden. */
  readonly images: readonly string[]
}

/** El estado por defecto de una obra de prueba, en la forma de la API. */
export function mediaJson(media: RawMediaFixture): Record<string, unknown> {
  return {
    id: media.id,
    title: {
      romaji: media.romaji,
      english: media.english ?? null,
      native: media.native ?? null,
    },
    synonyms: media.synonyms ?? [],
    format: media.format ?? 'TV',
    status: media.status ?? 'FINISHED',
    isAdult: media.isAdult ?? false,
    startDate: { year: media.year ?? 2019, month: 4, day: 6 },
    episodes: media.episodes ?? 12,
    duration: media.duration ?? 24,
    averageScore: media.score ?? 80,
    description: media.description ?? 'Una sinopsis<br>con <i>etiquetas</i> y &amp; entidades.',
    genres: media.genres ?? ['Acción'],
    studios: { nodes: (media.studios ?? ['Estudio Cobre']).map((name) => ({ name })) },
    coverImage: {
      extraLarge:
        media.cover ??
        (media.coverFuera === true
          ? 'https://ejemplo.invalid/portada.jpg'
          : `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx${media.id}-abc.jpg`),
      large: null,
    },
    bannerImage:
      media.banner ?? `https://s4.anilist.co/file/anilistcdn/media/anime/banner/${media.id}.jpg`,
    siteUrl: media.siteUrl ?? `https://anilist.co/anime/${media.id}`,
    nextAiringEpisode: null,
  }
}

export interface AniListFixture {
  /** El top, en orden. */
  readonly top?: readonly RawMediaFixture[]
  /** La parrilla: el capítulo que sale. */
  readonly airing?: readonly {
    readonly media: RawMediaFixture
    readonly episode: number
    readonly airingAt: number
  }[]
  /** Lo recién emitido. */
  readonly recent?: readonly {
    readonly media: RawMediaFixture
    readonly episode: number
    readonly airingAt: number
  }[]
  /** Lo que devuelve cada búsqueda, por el título con el que se preguntó. */
  readonly search?: Readonly<Record<string, readonly RawMediaFixture[]>>
  /**
   * Las relaciones de cada obra, por su id de AniList.
   *
   * El tipo llega con el nombre que publica la API —`SEQUEL`, `SOURCE`— y no con
   * el del dominio: es lo que hace que la prueba mida el filtro de verdad y no
   * una traducción que el doble ya hizo.
   */
  readonly relations?: Readonly<
    Record<number, readonly { readonly relation: string; readonly media: RawMediaFixture }[]>
  >
  /**
   * Estado exacto por consulta que contenga este texto.
   *
   * Va **sin `readonly`** a propósito: una prueba necesita que la primera
   * lectura funcione y la segunda falle —con la caché vencida de por medio—, y
   * eso se hace cambiando el fixture en mitad de la prueba.
   */
  status?: Readonly<Record<string, number>>
  /** Cabeceras extra por consulta que contenga este texto. Igual de mutable. */
  headers?: Readonly<Record<string, Readonly<Record<string, string>>>>
}

export function fakeAniList(fixture: AniListFixture = {}): FakeAniList {
  const calls: AniListCall[] = []
  const images: string[] = []

  const impl: FetchLike = async (input, init) => {
    // Su CDN de imágenes: un JPEG mínimo, para que la ruta de la imagen tenga
    // algo que servir sin salir a la red.
    if (ANILIST_IMAGE_HOSTS.some((host) => input.includes(`//${host}/`))) {
      images.push(input)

      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': '4' },
      })
    }

    const cuerpo = typeof init.body === 'string' ? init.body : '{}'
    const peticion = JSON.parse(cuerpo) as {
      query?: unknown
      variables?: unknown
    }
    const query = typeof peticion.query === 'string' ? peticion.query : ''
    const variables =
      typeof peticion.variables === 'object' && peticion.variables !== null
        ? (peticion.variables as Readonly<Record<string, unknown>>)
        : {}

    calls.push({ query, variables })

    for (const [marca, status] of Object.entries(fixture.status ?? {})) {
      if (query.includes(marca)) {
        const headers = fixture.headers?.[marca] ?? {}

        return new Response('{}', { status, headers })
      }
    }

    // Las relaciones de una obra, por su id.
    if (query.includes('relations {')) {
      const id = typeof variables.id === 'number' ? variables.id : Number(variables.id)
      const edges = (fixture.relations?.[id] ?? []).map((arista) => ({
        relationType: arista.relation,
        node: mediaJson(arista.media),
      }))

      return Response.json({ data: { Media: { relations: { edges } } } })
    }

    // El lote de búsqueda: una página por alias, con lo que el fixture tenga para
    // el título que se preguntó en esa variable.
    if (/t0: Page\(/.test(query)) {
      const paginas: Record<string, unknown> = {}

      for (const [clave, valor] of Object.entries(variables)) {
        if (!clave.startsWith('q') || typeof valor !== 'string') continue

        const indice = clave.slice(1)
        const media = fixture.search?.[valor] ?? []

        // AniList **aplana** la página de un alias: `t0: { media: […] }` y no
        // `t0: { Page: { media: […] } }`. El doble devuelve lo que devuelve la
        // API de verdad —medido—, porque un doble más cómodo esconde el fallo
        // que luego aparece en vivo.
        paginas[`t${indice}`] = { media: media.map((una) => mediaJson(una)) }
      }

      return Response.json({ data: paginas })
    }

    if (query.includes('airingSchedules')) {
      const emitidos = query.includes('TIME_DESC') ? (fixture.recent ?? []) : (fixture.airing ?? [])

      return Response.json({
        data: {
          Page: {
            airingSchedules: emitidos.map((cita) => ({
              episode: cita.episode,
              airingAt: cita.airingAt,
              media: mediaJson(cita.media),
            })),
          },
        },
      })
    }

    if (query.includes('format_in: [MOVIE]')) {
      const peliculas = fixture.airing?.map((cita) => cita.media) ?? []

      return Response.json({ data: { Page: { media: peliculas.map((una) => mediaJson(una)) } } })
    }

    return Response.json({
      data: { Page: { media: (fixture.top ?? []).map((una) => mediaJson(una)) } },
    })
  }

  return { impl, calls, images }
}
