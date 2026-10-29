/**
 * La cola de descargas, tal y como vive en SQLite.
 *
 * Una fila por episodio. El motor no abre la base: recibe esta pieza inyectada y
 * escribe por ella, que es la misma regla que el resto del almacén.
 *
 * `path` es **relativa** a la raíz de descargas. Guardar una ruta absoluta ataría
 * la base a un directorio que puede cambiar de sitio —una memoria USB, un equipo
 * distinto— y la fila dejaría de encontrar su archivo.
 */

import type { Database } from 'bun:sqlite'
import { StoreError } from '@nn-anime/core'
import { z } from 'zod'

export const downloadStatusSchema = z.enum([
  'queued',
  'downloading',
  'paused',
  'complete',
  'failed',
  'cancelled',
])

export type DownloadStatus = z.infer<typeof downloadStatusSchema>

export const downloadKindSchema = z.enum(['file', 'hls', 'segments'])
export type DownloadKind = z.infer<typeof downloadKindSchema>

export interface DownloadRecord {
  readonly id: number
  readonly providerId: string
  readonly providerRef: string
  readonly episodeRef: string
  readonly title: string
  readonly episodeLabel: string
  readonly kind: DownloadKind
  readonly status: DownloadStatus
  /** Ruta relativa a la raíz de descargas, si ya hay archivo. */
  readonly path?: string
  readonly bytes: number
  readonly totalBytes?: number
  readonly error?: string
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface NewDownload {
  readonly providerId: string
  readonly providerRef: string
  readonly episodeRef: string
  readonly title: string
  readonly episodeLabel: string
  readonly kind: DownloadKind
}

export interface DownloadPatch {
  readonly status?: DownloadStatus
  /**
   * Qué quedó en disco, cuando el motor ya lo sabe.
   *
   * El alta no puede saberlo: se crea antes de resolver el stream, así que hasta
   * que la descarga termina no hay forma de distinguir un MP4 de una carpeta de
   * segmentos. Si esto no se pudiera escribir, una descarga de HLS sin ffmpeg se
   * quedaría diciendo «file» con una playlist dentro, y la interfaz pediría un
   * vídeo que en realidad es texto.
   */
  readonly kind?: DownloadKind
  readonly path?: string
  readonly bytes?: number
  readonly totalBytes?: number
  /** `null` borra el error anterior al reanudar. */
  readonly error?: string | null
}

interface DownloadRow {
  readonly id: number
  readonly provider_id: string
  readonly provider_ref: string
  readonly episode_ref: string
  readonly title: string
  readonly episode_label: string
  readonly kind: string
  readonly status: string
  readonly path: string | null
  readonly bytes: number
  readonly total_bytes: number | null
  readonly error: string | null
  readonly created_at: number
  readonly updated_at: number
}

function toRecord(row: DownloadRow): DownloadRecord {
  const kind = downloadKindSchema.safeParse(row.kind)
  const status = downloadStatusSchema.safeParse(row.status)

  if (!kind.success || !status.success) {
    throw new StoreError({
      message: `la descarga ${row.id} tiene un estado que no existe: ${row.kind}/${row.status}`,
      scope: 'catalog-store',
      op: 'readDownload',
    })
  }

  return {
    id: row.id,
    providerId: row.provider_id,
    providerRef: row.provider_ref,
    episodeRef: row.episode_ref,
    title: row.title,
    episodeLabel: row.episode_label,
    kind: kind.data,
    status: status.data,
    ...(row.path === null ? {} : { path: row.path }),
    bytes: row.bytes,
    ...(row.total_bytes === null ? {} : { totalBytes: row.total_bytes }),
    ...(row.error === null ? {} : { error: row.error }),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

export function createDownloadRepository(db: Database, now: () => number = Date.now) {
  const porId = db.query<DownloadRow, [number]>('SELECT * FROM download WHERE id = ?')
  const porEpisodio = db.query<DownloadRow, [string, string]>(
    'SELECT * FROM download WHERE provider_id = ? AND episode_ref = ?',
  )
  const listado = db.query<DownloadRow, [number]>(
    'SELECT * FROM download ORDER BY created_at DESC, id DESC LIMIT ?',
  )

  const get = (id: number): DownloadRecord | undefined => {
    const row = porId.get(id)

    return row === null ? undefined : toRecord(row)
  }

  return {
    get,

    getByEpisode(providerId: string, episodeRef: string): DownloadRecord | undefined {
      const row = porEpisodio.get(providerId, episodeRef)

      return row === null ? undefined : toRecord(row)
    },

    /**
     * El alta, idempotente por episodio.
     *
     * Devuelve la fila que ya hubiera si el episodio estaba pedido: volver a
     * pulsar «descargar» no duplica el trabajo ni el archivo. Quien quiera
     * reintentar una descarga fallida cambia su estado, no crea otra fila.
     */
    create(input: NewDownload): DownloadRecord {
      const instante = now()
      db.query(
        `INSERT INTO download
           (provider_id, provider_ref, episode_ref, title, episode_label, kind, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)
         ON CONFLICT (provider_id, episode_ref) DO NOTHING`,
      ).run(
        input.providerId,
        input.providerRef,
        input.episodeRef,
        input.title,
        input.episodeLabel,
        input.kind,
        instante,
        instante,
      )

      const row = porEpisodio.get(input.providerId, input.episodeRef)
      if (row === null) {
        throw new StoreError({
          message: `no se pudo crear la descarga de ${input.episodeRef}`,
          scope: 'catalog-store',
          op: 'createDownload',
        })
      }

      return toRecord(row)
    },

    list(limit = 100): readonly DownloadRecord[] {
      return listado.all(limit).map(toRecord)
    },

    /** Cambia sólo lo que venga; el resto de la fila se queda como está. */
    update(id: number, patch: DownloadPatch): DownloadRecord | undefined {
      const campos: string[] = []
      const valores: (string | number | null)[] = []

      if (patch.status !== undefined) {
        campos.push('status = ?')
        valores.push(patch.status)
      }
      if (patch.kind !== undefined) {
        campos.push('kind = ?')
        valores.push(patch.kind)
      }
      if (patch.path !== undefined) {
        campos.push('path = ?')
        valores.push(patch.path)
      }
      if (patch.bytes !== undefined) {
        campos.push('bytes = ?')
        valores.push(patch.bytes)
      }
      if (patch.totalBytes !== undefined) {
        campos.push('total_bytes = ?')
        valores.push(patch.totalBytes)
      }
      if (patch.error !== undefined) {
        campos.push('error = ?')
        valores.push(patch.error)
      }

      if (campos.length === 0) return get(id)

      campos.push('updated_at = ?')
      valores.push(now())

      db.query(`UPDATE download SET ${campos.join(', ')} WHERE id = ?`).run(...valores, id)

      return get(id)
    },

    /** Borra la fila y devuelve lo que había, para que el motor borre el archivo. */
    remove(id: number): DownloadRecord | undefined {
      const row = get(id)
      if (row === undefined) return undefined

      db.query('DELETE FROM download WHERE id = ?').run(id)

      return row
    },

    /**
     * Las que quedaron a medias vuelven a la cola.
     *
     * Se llama al arrancar: si el proceso murió descargando, la fila diría
     * «downloading» para siempre y nadie volvería a intentarlo.
     */
    requeueInterrupted(): number {
      const resultado = db
        .query("UPDATE download SET status = 'queued', updated_at = ? WHERE status = 'downloading'")
        .run(now())

      return Number(resultado.changes)
    },
  }
}

export type DownloadStore = ReturnType<typeof createDownloadRepository>
