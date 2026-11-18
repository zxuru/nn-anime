/**
 * Las portadas que ya se conocen, apuntadas al escribir una caché de listados.
 *
 * Es la mitad de escritura de `known_cover`: la lectura vive en `cover-ref.ts`.
 * La tabla existe porque buscar una portada dentro de un array JSON no tiene
 * índice posible; con una clave (proveedor, referencia) la consulta es una fila.
 *
 * Se llama **dentro de la misma transacción** que la escritura de la caché. Si
 * la portada se apuntara después y el proceso muriera en medio, la caché diría
 * que conoce un título cuya portada no está; al revés —portada sí, caché no— es
 * inofensivo, pero no hay razón para elegir.
 */

import type { Database } from 'bun:sqlite'

/** Lo mínimo que necesita una entrada para dejar su portada apuntada. */
export interface ConPortada {
  readonly ref: { readonly value: string }
  readonly coverUrl?: string | undefined
}

/**
 * Apunta la portada de cada entrada que la traiga.
 *
 * `updated_at` es el instante de la caché, y el `ON CONFLICT` sólo pisa si la
 * portada nueva es igual o más reciente: un listado que llega tarde no borra una
 * URL que ya funcionaba. La URL no se valida aquí; se valida al servirla, que es
 * donde importa (`httpUrlSchema` en `findCoverUrl`).
 */
export function recordCovers(
  db: Database,
  providerId: string,
  entries: readonly ConPortada[],
  now: number,
): void {
  const upsert = db.query(
    `INSERT INTO known_cover (provider_id, provider_ref, url, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (provider_id, provider_ref) DO UPDATE SET
       url        = excluded.url,
       updated_at = excluded.updated_at
     WHERE excluded.updated_at >= known_cover.updated_at`,
  )

  for (const entry of entries) {
    if (entry.coverUrl === undefined || entry.coverUrl === '') continue
    upsert.run(providerId, entry.ref.value, entry.coverUrl, now)
  }
}
