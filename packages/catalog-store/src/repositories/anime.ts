/**
 * Repositorio de detalles de anime.
 *
 * La fila guarda dos cosas a la vez: columnas para lo que se consulta y ordena
 * —título, año, estado, fecha— y `raw_json` con el detalle completo. Se lee del
 * JSON porque es lo único que conserva **todo** y en orden: `genres` y `studios`
 * son listas ordenadas, y una tabla de géneros las devolvería por nombre. Las
 * columnas siguen haciendo falta para `pruneOrphans` y para las consultas de
 * `recsys`, que no pueden mirar dentro de un JSON sin recorrerlo entero.
 *
 * Todas las lecturas devuelven `null` en un MISS. Devolver un objeto vacío
 * obligaría a cada consumidor a distinguir «sin datos» de «datos vacíos», y esa
 * comprobación se olvida una vez por consumidor.
 */

import type { Database } from 'bun:sqlite'
import {
  type AnimeDetail,
  animeDetailSchema,
  type CacheHit,
  type Episode,
  type ProviderRef,
  type SearchResult,
  StoreError,
  titleKindSchema,
} from '@nn-anime/core'
import { cacheHit, TTL_SECONDS } from '../cache-policy'
import { animeIdOf, markEpisodesFetched, replaceEpisodes } from './episodes'

/**
 * Una lista guardada como JSON, leída sin lanzar.
 *
 * `json_extract` devuelve `null` si la clave no está y el texto tal cual si lo
 * está. Un JSON roto no puede tumbar una lista de recomendaciones: se trata como
 * lista vacía.
 */
function listaDeJson(valor: string | null): readonly string[] {
  if (valor === null) return []

  try {
    const lista: unknown = JSON.parse(valor)

    return Array.isArray(lista)
      ? lista.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

/** Una fila del listado: lo justo para puntuar un candidato. */
export interface CandidateRow {
  readonly ref: ProviderRef
  readonly title: string
  readonly coverUrl?: string
  readonly year?: number
  readonly kind?: string
  readonly tags: readonly string[]
  readonly studios: readonly string[]
}

interface AnimeListRow {
  readonly provider_id: string
  readonly provider_ref: string
  readonly title: string
  readonly cover_url: string | null
  readonly year: number | null
  readonly kind: string | null
  readonly generos: string | null
  readonly estudios: string | null
}

interface AnimeRow {
  readonly id: number
  readonly fetched_at: number
  readonly ttl_s: number
  readonly raw_json: string | null
}

interface TituloRow {
  readonly provider_id: string
  readonly provider_ref: string
  readonly title: string
  readonly title_alt: string | null
  readonly cover_url: string | null
  readonly year: number | null
  readonly kind: string | null
}

/**
 * Clave de comparación de un nombre: el de un género o el de un estudio.
 *
 * SQLite compara texto byte a byte y su `lower()` sólo entiende ASCII, así que
 * allí «accion» no encuentra «Acción» ni «ufotable» encuentra «Ufotable». Se
 * pliega aquí: minúsculas, sin diacríticos y en NFC, para que la consulta no
 * dependa de que quien escribe ponga la tilde ni la mayúscula.
 */
function claveDeNombre(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .normalize('NFC')
}

/**
 * Si el término encaja con el nombre.
 *
 * Encaja por **principio de palabra** y no por cualquier trozo: «acción» y
 * «accion» sí, pero «ccion» no. Con coincidencia libre, media consulta de un
 * título arrastraría el catálogo entero por llevar una «a» dentro.
 */
function encajaElNombre(nombre: string, buscado: string): boolean {
  const clave = claveDeNombre(nombre)
  if (clave.startsWith(buscado)) return true

  return clave.split(/[^\p{L}\p{N}]+/u).some((palabra) => palabra.startsWith(buscado))
}

/**
 * Los títulos de una lista de identificadores, como resultados de búsqueda.
 *
 * Es la mitad que comparten las dos consultas del catálogo —la de género y la de
 * estudio—: una vez se sabe **qué** filas encajan, lo que se devuelve es lo mismo
 * y en el mismo orden, así que se escribe una vez. Se ordena por título y se
 * corta con el límite aquí, que es donde el `LIMIT` puede contar lo que se
 * devuelve y no lo que se miró.
 */
function porIds(db: Database, ids: readonly number[], limit: number): readonly SearchResult[] {
  if (ids.length === 0 || limit <= 0) return []

  const huecos = ids.map(() => '?').join(', ')
  const filas = db
    .query<TituloRow, number[]>(
      `SELECT a.provider_id, a.provider_ref, a.title, a.title_alt, a.cover_url, a.year,
              json_extract(a.raw_json, '$.kind') AS kind
         FROM anime a
        WHERE a.id IN (${huecos})
        ORDER BY a.title COLLATE NOCASE
        LIMIT ?`,
    )
    .all(...ids, limit)

  return filas.map((fila) => {
    // `kind` vive en el JSON como una cadena entrecomillada, y sólo vale si es
    // uno de los tipos del contrato: un valor inventado por un proveedor no
    // puede colarse en un `SearchResult` y romper la validación de la frontera,
    // que es donde se descubriría.
    const kind = titleKindSchema.safeParse(fila.kind?.replace(/^"|"$/g, ''))

    return {
      ref: { providerId: fila.provider_id, value: fila.provider_ref },
      title: fila.title,
      ...(fila.title_alt === null ? {} : { titleAlt: fila.title_alt }),
      ...(fila.cover_url === null ? {} : { coverUrl: fila.cover_url }),
      ...(fila.year === null ? {} : { year: fila.year }),
      ...(kind.success ? { kind: kind.data } : {}),
    }
  })
}

export interface AnimeRepository {
  /** `null` cuando no hay fila. `stale` se calcula, no se guarda. */
  read(ref: ProviderRef, now?: number): CacheHit<AnimeDetail> | null
  write(ref: ProviderRef, detail: AnimeDetail, now?: number): void
  /**
   * El detalle y su lista de episodios, en **una sola transacción**.
   *
   * Es lo que usa una ruta de detalle: si se escribieran por separado y fallara
   * la segunda, quedaría un anime en la base sin sus episodios, y la siguiente
   * lectura diría que tiene cero. Media escritura es peor que ninguna.
   */
  writeWith(ref: ProviderRef, detail: AnimeDetail, episodes: readonly Episode[], now?: number): void
  /**
   * Los títulos cacheados cuyo género encaja con el término buscado.
   *
   * Es lo que hace que la fila de géneros de la home sirva para algo: los
   * proveedores buscan por título y ninguno responde a «acción», así que una
   * consulta por género sólo puede salir de lo que ya está en la base. La tabla
   * `genre` existe justo para estas consultas.
   */
  searchByGenre(term: string, limit: number): readonly SearchResult[]
  /**
   * Los títulos cacheados cuyo estudio encaja con el término buscado.
   *
   * La otra mitad de lo mismo, y la pregunta que contesta el nombre de un estudio
   * en la ficha: «qué más ha hecho éstos». Los estudios no tienen tabla —viven en
   * `raw_json`, que es lo único que los conserva en orden—, así que la lectura es
   * un recorrido de los pares (título, estudio) y no una consulta por índice.
   */
  searchByStudio(term: string, limit: number): readonly SearchResult[]
  /** Identificador interno, para las tablas que apuntan al anime. */
  idOf(ref: ProviderRef): number | undefined
}

function parseDetail(row: AnimeRow, ref: ProviderRef): AnimeDetail {
  if (row.raw_json === null) {
    throw new StoreError({
      message: `la fila del anime ${ref.providerId}/${ref.value} no tiene raw_json`,
      scope: 'catalog-store',
      op: 'readAnime',
    })
  }

  const parsed = animeDetailSchema.safeParse(JSON.parse(row.raw_json))
  if (!parsed.success) {
    throw new StoreError({
      message: `el raw_json del anime ${ref.providerId}/${ref.value} no cumple el schema: ${parsed.error.message}`,
      scope: 'catalog-store',
      op: 'readAnime',
    })
  }

  return parsed.data
}

export function createAnimeRepository(db: Database, ttlS: number = TTL_SECONDS.anime) {
  const select = db.query<AnimeRow, [string, string]>(
    'SELECT id, fetched_at, ttl_s, raw_json FROM anime WHERE provider_id = ? AND provider_ref = ?',
  )

  return {
    /**
     * Los títulos cacheados, con sus tags, para el motor de recomendación.
     *
     * Devuelve resúmenes y no detalles: el motor necesita el vector de
     * características de cada candidato, no su sinopsis ni sus episodios. Leer los
     * detalles para puntuar traería de la base diez veces más de lo que se usa.
     */
    list(limit: number): readonly CandidateRow[] {
      const filas = db
        .query<AnimeListRow, [number]>(
          // Los géneros y los estudios salen de `raw_json`, que es la única
          // fuente que los conserva **en orden** y que es lo que lee el detalle.
          //
          // La tabla `genre` se escribe en la misma transacción que el título y
          // se lee en `searchByGenre`: sirve para consultar por género, no para
          // reconstruir la lista, que perdería el orden.
          `SELECT a.provider_id, a.provider_ref, a.title, a.cover_url, a.year,
                  json_extract(a.raw_json, '$.kind') AS kind,
                  json_extract(a.raw_json, '$.genres') AS generos,
                  json_extract(a.raw_json, '$.studios') AS estudios
             FROM anime a
            ORDER BY a.fetched_at DESC
            LIMIT ?`,
        )
        .all(limit)

      return filas.map((fila) => ({
        ref: { providerId: fila.provider_id, value: fila.provider_ref },
        title: fila.title,
        ...(fila.cover_url === null ? {} : { coverUrl: fila.cover_url }),
        ...(fila.year === null ? {} : { year: fila.year }),
        // `kind` tampoco es columna: vive en el JSON como los géneros.
        ...(fila.kind === null ? {} : { kind: fila.kind.replace(/^"|"$/g, '') }),
        tags: listaDeJson(fila.generos),
        studios: listaDeJson(fila.estudios),
      }))
    },

    /**
     * La comparación se hace en JS y no en SQL, y no es un capricho: los
     * nombres distintos son un puñado, y SQLite no sabe ignorar los acentos.
     * Comparar allí obligaría a escribir «Acción» con tilde exacta.
     */
    searchByGenre(term: string, limit: number): readonly SearchResult[] {
      const buscado = claveDeNombre(term)
      if (buscado === '' || limit <= 0) return []

      const nombres = db
        .query<{ name: string }, []>('SELECT DISTINCT name FROM genre')
        .all()
        .map((fila) => fila.name)
        .filter((nombre) => encajaElNombre(nombre, buscado))

      if (nombres.length === 0) return []

      const huecos = nombres.map(() => '?').join(', ')
      // `DISTINCT` y no una unión a secas: un título con dos géneros que encajen
      // —«Ciencia ficción» y «Ficción»— saldría dos veces.
      const ids = db
        .query<{ anime_id: number }, string[]>(
          `SELECT DISTINCT anime_id FROM genre WHERE name IN (${huecos})`,
        )
        .all(...nombres)
        .map((fila) => fila.anime_id)

      return porIds(db, ids, limit)
    },

    /**
     * Los estudios viven en `raw_json` y no en una tabla, así que la lectura es
     * un recorrido de los pares (título, estudio) con la comparación en memoria:
     * es la misma decisión que la del género —SQLite no sabe ignorar los
     * acentos— y el mismo precio, una consulta por búsqueda y no por fila.
     *
     * La tabla son los títulos que alguien abrió: unos miles como mucho, y el
     * recorrido del JSON se paga una vez por consulta. Si algún día el catálogo
     * crece hasta notarse, el paso siguiente es una tabla `studio` como la de
     * `genre`, escrita en la misma transacción que el título.
     */
    searchByStudio(term: string, limit: number): readonly SearchResult[] {
      const buscado = claveDeNombre(term)
      if (buscado === '' || limit <= 0) return []

      const pares = db
        .query<{ anime_id: number; estudio: string | null }, []>(
          // `json_each` de un `raw_json` nulo no devuelve filas, así que una fila
          // sin JSON —las que siembran las pruebas de alcance— no rompe nada.
          `SELECT a.id AS anime_id, e.value AS estudio
             FROM anime a, json_each(a.raw_json, '$.studios') AS e`,
        )
        .all()

      const ids = [
        ...new Set(
          pares
            .filter((par) => par.estudio !== null && encajaElNombre(par.estudio, buscado))
            .map((par) => par.anime_id),
        ),
      ]

      return porIds(db, ids, limit)
    },

    read(ref: ProviderRef, now: number = Date.now()): CacheHit<AnimeDetail> | null {
      const row = select.get(ref.providerId, ref.value)
      if (row === null) return null

      return cacheHit(parseDetail(row, ref), row.fetched_at, row.ttl_s, now)
    },

    write(ref: ProviderRef, detail: AnimeDetail, now: number = Date.now()): void {
      db.transaction(() => {
        writeAnimeRow(db, ref, detail, now, ttlS)
      })()
    },

    writeWith(
      ref: ProviderRef,
      detail: AnimeDetail,
      episodes: readonly Episode[],
      now: number = Date.now(),
    ): void {
      db.transaction(() => {
        writeAnimeRow(db, ref, detail, now, ttlS)

        const id = animeIdOf(db, ref)
        if (id === undefined) {
          throw new StoreError({
            message: `el anime ${ref.providerId}/${ref.value} no se pudo leer dentro de su propia transacción`,
            scope: 'catalog-store',
            op: 'writeAnimeWithEpisodes',
          })
        }

        replaceEpisodes(db, id, episodes, now, TTL_SECONDS.episodes)
        markEpisodesFetched(db, id, now, TTL_SECONDS.episodes)
      })()
    },

    idOf(ref: ProviderRef): number | undefined {
      return animeIdOf(db, ref)
    },
  }
}

/** La fila del anime y sus géneros. Se usa dentro de una transacción. */
function writeAnimeRow(
  db: Database,
  ref: ProviderRef,
  detail: AnimeDetail,
  now: number,
  ttlS: number,
): void {
  db.query(
    `INSERT INTO anime (
           provider_id, provider_ref, title, title_alt, synopsis, cover_url,
           year, status, episode_count, fetched_at, ttl_s, raw_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (provider_id, provider_ref) DO UPDATE SET
           title = excluded.title,
           title_alt = excluded.title_alt,
           synopsis = excluded.synopsis,
           cover_url = excluded.cover_url,
           year = excluded.year,
           status = excluded.status,
           episode_count = excluded.episode_count,
           fetched_at = excluded.fetched_at,
           ttl_s = excluded.ttl_s,
           raw_json = excluded.raw_json`,
  ).run(
    ref.providerId,
    ref.value,
    detail.title,
    detail.titleAlt ?? null,
    detail.synopsis ?? null,
    detail.coverUrl ?? null,
    detail.year ?? null,
    detail.status ?? null,
    detail.episodeCount ?? null,
    now,
    ttlS,
    JSON.stringify(detail),
  )

  const row = db
    .query<{ id: number }, [string, string]>(
      'SELECT id FROM anime WHERE provider_id = ? AND provider_ref = ?',
    )
    .get(ref.providerId, ref.value)
  if (row === null) {
    throw new StoreError({
      message: `el anime ${ref.providerId}/${ref.value} no se pudo leer después de escribirlo`,
      scope: 'catalog-store',
      op: 'writeAnime',
    })
  }

  // Los géneros se reemplazan enteros: un título que pierde un género no
  // puede conservarlo en la tabla por no borrar lo viejo.
  db.query('DELETE FROM genre WHERE anime_id = ?').run(row.id)
  const insertGenre = db.query('INSERT INTO genre (anime_id, name) VALUES (?, ?)')
  for (const genre of detail.genres) insertGenre.run(row.id, genre)
}

export type AnimeStore = ReturnType<typeof createAnimeRepository>
