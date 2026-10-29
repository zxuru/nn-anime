/**
 * Convertir en MP4 una descarga que quedó en segmentos.
 *
 * Es el caso de un equipo sin ffmpeg: la descarga se completó —los segmentos
 * están todos— y el usuario tiene un directorio en vez de un archivo. Cuando
 * ffmpeg aparece, esta pieza hace el último paso **sin volver a bajar nada**.
 *
 * Dos reglas:
 *
 * 1. **El MP4 va al lado de la carpeta, con su nombre.** Es la misma ruta que
 *    habría dejado una descarga con ffmpeg (`<carpeta>/<nombre>.mp4`), así que la
 *    fila no cambia de forma y el archivo se reconoce fuera de la aplicación.
 * 2. **Los segmentos se borran sólo si el MP4 salió.** Si el remux falla, lo
 *    descargado se queda: convertirlo otra vez es barato, bajarlo no.
 */

import { rm, stat } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import { createFfmpegRemux, type RemuxFn } from '@nn-anime/media-proxy'

export interface RemuxInput {
  /** La raíz de descargas: el MP4 tiene que quedar dentro. */
  readonly root: string
  /** Ruta absoluta del `index.m3u8` de la descarga. */
  readonly playlist: string
  /** El remezclador. En las pruebas es un doble; si falta, se usa ffmpeg. */
  readonly remux?: RemuxFn | undefined
  readonly ffmpegPath?: string | undefined
  readonly signal: AbortSignal
}

export interface RemuxResult {
  readonly path: string
  readonly relPath: string
  readonly bytes: number
}

/** Dónde queda el MP4 de una carpeta de segmentos: a su lado, mismo nombre. */
export function mp4DeCarpeta(playlist: string): string {
  return `${dirname(playlist)}.mp4`
}

export async function remuxSegments(input: RemuxInput): Promise<RemuxResult> {
  const mp4 = mp4DeCarpeta(input.playlist)
  const remux =
    input.remux ??
    (input.ffmpegPath === undefined ? undefined : createFfmpegRemux(input.ffmpegPath))

  if (remux === undefined) throw new Error('no hay ffmpeg para convertir la descarga')

  await remux(input.playlist, mp4, input.signal)

  const info = await stat(mp4)
  // El andamio se tira cuando el resultado existe: el usuario pidió un archivo,
  // no un directorio con cuatrocientos trozos.
  await rm(dirname(input.playlist), { recursive: true, force: true })

  return { path: mp4, relPath: relative(input.root, mp4), bytes: info.size }
}
