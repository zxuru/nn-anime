/**
 * El cliente de TMDB: lo que AniList no cubre.
 *
 * **Una sola salida y un solo host.** La dirección se compone aquí con una base
 * constante; no hay ninguna ruta que reciba una URL del usuario ni del plugin. El
 * proxy de imágenes y la lista blanca del proxy de streams no se tocan.
 *
 * **La clave viaja en la consulta a `api.themoviedb.org` y en ningún otro sitio.**
 * No se registra, no se devuelve por HTTP y no se guarda en la caché: la caché
 * guarda el resultado, no la petición.
 *
 * **La degradación es silenciosa para la ficha.** Un fallo de TMDB —sin red, 500,
 * JSON con otra forma o una clave que ya no vale— devuelve `null`: la ficha se
 * queda con lo que publicó el plugin, que es lo que hacía antes de existir esto.
 */

import { normalizeQuery, type TmdbMetadata } from '@nn-anime/core'
import { z } from 'zod'

const TMDB_BASE = 'https://api.themoviedb.org/3'
const IDIOMA = 'es-ES'
const TTL_MS = 6 * 60 * 60 * 1000
const TIMEOUT_MS = 4000

/** Un resultado de búsqueda, con lo que este cliente usa. */
const resultadoSchema = z.object({
  title: z.string().optional(),
  name: z.string().optional(),
  original_title: z.string().optional(),
  original_name: z.string().optional(),
  overview: z.string().optional(),
  genre_ids: z.array(z.number().int()).optional(),
  release_date: z.string().optional(),
  first_air_date: z.string().optional(),
})

const busquedaSchema = z.object({
  results: z.array(resultadoSchema).max(20),
})

/**
 * Los géneros de TMDB, por id.
 *
 * Son estables y públicos; pedir `/genre/movie/list` en cada ficha sería una
 * petición más para un dato que no cambia. Si TMDB añade uno, el id desconocido se
 * omite en vez de inventar un nombre.
 */
const GENEROS: Readonly<Record<number, string>> = {
  12: 'Aventura',
  14: 'Fantasía',
  16: 'Animación',
  18: 'Drama',
  27: 'Terror',
  28: 'Acción',
  35: 'Comedia',
  36: 'Historia',
  37: 'Western',
  53: 'Suspense',
  80: 'Crimen',
  99: 'Documental',
  878: 'Ciencia ficción',
  9648: 'Misterio',
  10402: 'Música',
  10749: 'Romance',
  10751: 'Familia',
  10752: 'Guerra',
  10759: 'Acción y aventura',
  10762: 'Infantil',
  10763: 'Noticias',
  10764: 'Reality',
  10765: 'Ciencia ficción y fantasía',
  10766: 'Telenovela',
  10767: 'Talk show',
  10768: 'Guerra y política',
  10770: 'Película de TV',
}

export type TmdbFetch = (url: string, init?: RequestInit) => Promise<Response>

export interface TmdbClientOptions {
  readonly fetchImpl?: TmdbFetch | undefined
  readonly now?: (() => number) | undefined
  readonly ttlMs?: number | undefined
}

export interface TmdbLookup {
  readonly apiKey: string
  readonly title: string
  readonly titleAlt?: string | undefined
  readonly year?: number | undefined
  readonly kind?: 'movie' | 'series' | undefined
  readonly signal: AbortSignal
}

export interface TmdbClient {
  lookup(input: TmdbLookup): Promise<TmdbMetadata | null>
}

interface CacheEntry {
  readonly value: TmdbMetadata | null
  readonly fetchedAt: number
}

function yearOf(texto: string | undefined): number | undefined {
  if (texto === undefined) return undefined
  const year = Number(texto.slice(0, 4))

  return Number.isInteger(year) && year > 1800 ? year : undefined
}

function generosDe(ids: readonly number[] | undefined): readonly string[] {
  if (ids === undefined) return []

  return [
    ...new Set(
      ids.map((id) => GENEROS[id]).filter((nombre): nombre is string => nombre !== undefined),
    ),
  ]
}

/**
 * El título que devuelve TMDB, normalizado para compararlo con el local.
 *
 * No se comparan títulos con `sagaTitle` ni con la heurística de obra: TMDB busca
 * por texto y devuelve lo que se le parece; aquí se elige la coincidencia exacta
 * de nombre o, si no la hay, el primer resultado, que es su orden de relevancia.
 */
function nombre(resultado: z.infer<typeof resultadoSchema>): string | undefined {
  return resultado.title ?? resultado.name ?? resultado.original_title ?? resultado.original_name
}

export function createTmdbClient(options: TmdbClientOptions = {}): TmdbClient {
  const fetchImpl: TmdbFetch = options.fetchImpl ?? ((url, init) => fetch(url, init))
  const now = options.now ?? (() => Date.now())
  const ttlMs = options.ttlMs ?? TTL_MS
  const cache = new Map<string, CacheEntry>()

  return {
    async lookup(input: TmdbLookup): Promise<TmdbMetadata | null> {
      if (input.apiKey.trim() === '') return null

      const tipo = input.kind === 'movie' ? 'movie' : 'tv'
      const clave = `${tipo}\u0000${normalizeQuery(input.title)}\u0000${input.year ?? ''}`
      const guardado = cache.get(clave)
      if (guardado !== undefined && now() - guardado.fetchedAt < ttlMs) return guardado.value

      const consulta = new URLSearchParams({
        api_key: input.apiKey,
        query: input.title,
        language: IDIOMA,
        include_adult: 'false',
      })
      if (input.year !== undefined) {
        consulta.set(tipo === 'movie' ? 'year' : 'first_air_date_year', String(input.year))
      }

      let respuesta: Response
      try {
        respuesta = await fetchImpl(`${TMDB_BASE}/search/${tipo}?${consulta.toString()}`, {
          signal: AbortSignal.any([input.signal, AbortSignal.timeout(TIMEOUT_MS)]),
          redirect: 'error',
        })
      } catch {
        cache.set(clave, { value: null, fetchedAt: now() })
        return null
      }

      if (!respuesta.ok) {
        cache.set(clave, { value: null, fetchedAt: now() })
        return null
      }

      let crudo: unknown
      try {
        crudo = await respuesta.json()
      } catch {
        cache.set(clave, { value: null, fetchedAt: now() })
        return null
      }

      const parsed = busquedaSchema.safeParse(crudo)
      if (!parsed.success || parsed.data.results.length === 0) {
        cache.set(clave, { value: null, fetchedAt: now() })
        return null
      }

      const nombresBuscados = new Set(
        [input.title, input.titleAlt ?? ''].filter((texto) => texto !== '').map(normalizeQuery),
      )
      const elegido =
        parsed.data.results.find((resultado) => {
          const nombreResultado = nombre(resultado)
          return (
            nombreResultado !== undefined && nombresBuscados.has(normalizeQuery(nombreResultado))
          )
        }) ?? parsed.data.results[0]

      if (elegido === undefined) {
        cache.set(clave, { value: null, fetchedAt: now() })
        return null
      }

      const anio =
        yearOf(elegido.release_date) ?? yearOf(elegido.first_air_date) ?? input.year ?? undefined
      const sinopsis = elegido.overview?.trim()
      const valor: TmdbMetadata = {
        source: 'tmdb',
        genres: [...generosDe(elegido.genre_ids)],
        ...(sinopsis === undefined || sinopsis === '' ? {} : { synopsis: sinopsis }),
        ...(anio === undefined ? {} : { year: anio }),
      }

      cache.set(clave, { value: valor, fetchedAt: now() })

      return valor
    },
  }
}
