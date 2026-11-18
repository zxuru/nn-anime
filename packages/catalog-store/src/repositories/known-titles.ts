/**
 * Los títulos y las portadas que ya se conocen, apuntados al escribir una caché
 * de listados.
 *
 * Es la mitad de escritura de `known_cover` y `known_title`: la lectura de la
 * portada vive en `cover-ref.ts` y la de los relacionados en `related.ts`. Las
 * dos tablas existen por lo mismo: buscar un campo dentro de un array JSON no
 * tiene índice posible. Con una clave (proveedor, referencia), la portada es una
 * fila y los candidatos de una saga son un recorrido de una tabla de columnas,
 * no de las tres cachés con su JSON.
 *
 * Se llama **dentro de la misma transacción** que la escritura de la caché. Si
 * el título se apuntara después y el proceso muriera en medio, la caché diría
 * que conoce un título que las tablas denormalizadas no tienen; al revés —las
 * tablas sí, la caché no— es inofensivo, pero no hay razón para elegir.
 */

import type { Database } from 'bun:sqlite'
import type { TitleKind } from '@rona/core'

/**
 * Lo mínimo que necesita una entrada para dejar su título —y su portada—
 * apuntados.
 *
 * Es el contrato común de `SearchResult` y `FeedEntry`: una entrada del feed es
 * un resultado de búsqueda con fecha. La fecha no se guarda aquí; sólo sirve
 * para ordenar el listado del que salió.
 */
export interface EntradaConocida {
  readonly ref: { readonly value: string }
  readonly title: string
  readonly titleAlt?: string | undefined
  readonly coverUrl?: string | undefined
  readonly year?: number | undefined
  readonly kind?: TitleKind | undefined
}

/**
 * Apunta el título de cada entrada y, si la trae, su portada.
 *
 * `updated_at` es el instante de la caché, y los dos `ON CONFLICT` sólo pisan si
 * lo nuevo es igual o más reciente: un listado que llega tarde no borra una URL
 * que ya funcionaba. La portada de `known_title` se conserva además con
 * `COALESCE` cuando el listado nuevo no la trae, para que las dos tablas no
 * cuenten cosas distintas de la misma referencia.
 *
 * La URL no se valida aquí; se valida al servirla, que es donde importa
 * (`httpUrlSchema` en `findCoverUrl`).
 */
export function recordKnownTitles(
  db: Database,
  providerId: string,
  entries: readonly EntradaConocida[],
  now: number,
): void {
  const titulo = db.query(
    `INSERT INTO known_title
       (provider_id, provider_ref, title, title_alt, cover_url, year, kind, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider_id, provider_ref) DO UPDATE SET
       title        = excluded.title,
       title_alt    = excluded.title_alt,
       cover_url    = COALESCE(excluded.cover_url, known_title.cover_url),
       year         = excluded.year,
       kind         = excluded.kind,
       updated_at   = excluded.updated_at
     WHERE excluded.updated_at >= known_title.updated_at`,
  )
  const portada = db.query(
    `INSERT INTO known_cover (provider_id, provider_ref, url, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (provider_id, provider_ref) DO UPDATE SET
       url        = excluded.url,
       updated_at = excluded.updated_at
     WHERE excluded.updated_at >= known_cover.updated_at`,
  )

  for (const entry of entries) {
    // La caché guarda lo que le den y la lectura se defiende de una fila que no
    // cumple el contrato; la escritura hace lo mismo. Un resultado sin
    // referencia o sin título no puede dejar una fila a medias ni tumbar el
    // listado entero —una búsqueda de veinticuatro tarjetas no se pierde por
    // una entrada rara—.
    const ref: unknown = entry.ref?.value
    const title: unknown = entry.title
    if (typeof ref !== 'string' || ref === '' || typeof title !== 'string' || title === '') {
      continue
    }

    titulo.run(
      providerId,
      ref,
      title,
      entry.titleAlt ?? null,
      entry.coverUrl ?? null,
      entry.year ?? null,
      entry.kind ?? null,
      now,
    )

    // Una entrada sin portada sigue dejando su título —es lo que leen los
    // relacionados— pero no inventa una fila en `known_cover`.
    if (entry.coverUrl === undefined || entry.coverUrl === '') continue
    portada.run(providerId, entry.ref.value, entry.coverUrl, now)
  }
}
