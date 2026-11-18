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
import {
  StoreError,
  type StreamMode,
  type SubtitleFormat,
  streamModeSchema,
  subtitleFormatSchema,
} from '@rona/core'
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
  /** El audio con el que se pidió: `sub` o `dub`. */
  readonly mode: StreamMode
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
  /** Si no se dice, `sub`: es lo que hacía el motor antes de T307. */
  readonly mode?: StreamMode | undefined
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

/**
 * Una pista de subtítulos que quedó guardada junto al vídeo.
 *
 * `path` es la ruta del archivo, relativa a la raíz de descargas. No se guarda
 * nunca la dirección del upstream: con el vídeo ya en disco, esa URL puede
 * caducar y no hace falta para servir la pista.
 */
export interface DownloadSubtitleRecord {
  readonly downloadId: number
  /** Posición en la lista del proveedor: es la que viaja en la URL servida. */
  readonly indice: number
  readonly lang: string
  readonly label: string
  readonly format: SubtitleFormat
  /** Ruta relativa a la raíz de descargas. */
  readonly path: string
  readonly isDefault: boolean
}

/** La pista que la cola acaba de bajar, antes de asignarle su descarga. */
export interface NewDownloadSubtitle {
  readonly indice: number
  readonly lang: string
  readonly label: string
  readonly format: SubtitleFormat
  readonly path: string
  readonly isDefault?: boolean | undefined
}

interface DownloadRow {
  readonly id: number
  readonly provider_id: string
  readonly provider_ref: string
  readonly episode_ref: string
  readonly title: string
  readonly episode_label: string
  readonly mode: string
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
  const mode = streamModeSchema.safeParse(row.mode)

  if (!kind.success || !status.success || !mode.success) {
    throw new StoreError({
      message: `la descarga ${row.id} tiene un estado que no existe: ${row.kind}/${row.status}/${row.mode}`,
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
    mode: mode.data,
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

interface DownloadSubtitleRow {
  readonly download_id: number
  readonly indice: number
  readonly lang: string
  readonly label: string
  readonly format: string
  readonly path: string
  readonly is_default: number
}

function toSubtitle(row: DownloadSubtitleRow): DownloadSubtitleRecord {
  const format = subtitleFormatSchema.safeParse(row.format)

  if (!format.success) {
    throw new StoreError({
      message: `el subtítulo ${row.indice} de la descarga ${row.download_id} tiene un formato que no existe: ${row.format}`,
      scope: 'catalog-store',
      op: 'readDownloadSubtitle',
    })
  }

  return {
    downloadId: row.download_id,
    indice: row.indice,
    lang: row.lang,
    label: row.label,
    format: format.data,
    path: row.path,
    isDefault: row.is_default !== 0,
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
  const subtitulosPorDescarga = db.query<DownloadSubtitleRow, [number]>(
    'SELECT * FROM download_subtitle WHERE download_id = ? ORDER BY indice',
  )
  const subtituloPorIndice = db.query<DownloadSubtitleRow, [number, number]>(
    'SELECT * FROM download_subtitle WHERE download_id = ? AND indice = ?',
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
           (provider_id, provider_ref, episode_ref, title, episode_label, mode, kind, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
         ON CONFLICT (provider_id, episode_ref) DO NOTHING`,
      ).run(
        input.providerId,
        input.providerRef,
        input.episodeRef,
        input.title,
        input.episodeLabel,
        input.mode ?? 'sub',
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

    /** Las pistas de una descarga, en el orden en que las declaró la fuente. */
    listSubtitles(downloadId: number): readonly DownloadSubtitleRecord[] {
      return subtitulosPorDescarga.all(downloadId).map(toSubtitle)
    },

    getSubtitle(downloadId: number, indice: number): DownloadSubtitleRecord | undefined {
      const row = subtituloPorIndice.get(downloadId, indice)

      return row === null ? undefined : toSubtitle(row)
    },

    /**
     * Deja las pistas de una descarga exactamente como vienen.
     *
     * Es un reemplazo y no un alta: un reintento puede traer menos pistas que el
     * anterior —una que ya no está, o que falló—, y sumarlas dejaría filas
     * apuntando a archivos que se acaban de borrar. Sin pistas, borra todas.
     */
    replaceSubtitles(
      downloadId: number,
      subtitles: readonly NewDownloadSubtitle[],
    ): readonly DownloadSubtitleRecord[] {
      const insertar = db.query(
        `INSERT INTO download_subtitle (download_id, indice, lang, label, format, path, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      const aplicar = db.transaction(() => {
        db.query('DELETE FROM download_subtitle WHERE download_id = ?').run(downloadId)

        for (const pista of subtitles) {
          insertar.run(
            downloadId,
            pista.indice,
            pista.lang,
            pista.label,
            pista.format,
            pista.path,
            pista.isDefault === true ? 1 : 0,
          )
        }
      })

      aplicar()

      return subtitulosPorDescarga.all(downloadId).map(toSubtitle)
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
