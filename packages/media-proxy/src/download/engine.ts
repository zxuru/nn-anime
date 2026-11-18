/**
 * El orquestador de una descarga.
 *
 * Recibe una tarea de la cola, resuelve su stream igual que la reproducción y
 * deja el archivo en una carpeta **dentro de la raíz**. Lo que decide aquí:
 *
 * - **La ruta.** Cada trozo del nombre se sanea y la ruta final se comprueba con
 *   `resolve` contra la raíz: un título con `..` no puede escribir fuera.
 * - **El destino.** Cada URL del manifiesto pasa por `checkDestination` antes de
 *   pedirse; un HLS que apunte a loopback o a una red privada se corta.
 * - **El espacio.** Antes de empezar se exige un mínimo libre. No se puede saber
 *   el tamaño exacto de un HLS sin bajarlo, así que el margen es un suelo, no una
 *   promesa.
 * - **ffmpeg.** Si está, el HLS se remezcla a MP4; si no, quedan los segmentos y
 *   el resultado lo dice. El motor no finge un MP4 que no existe.
 */

import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { SubtitleFormat } from '@rona/core'
import type { FetchLike } from '../byte-proxy'
import { checkDestination } from '../destination-guard'
import { createPinnedFetch } from '../pinned-fetch'
import { MAX_SUBTITLE_BYTES } from '../subtitles'
import { createFfmpegRemux, locateFfmpeg } from './ffmpeg'
import { downloadFile } from './file'
import { downloadHls, type RemuxFn } from './hls-download'

/** Suelo de espacio libre antes de empezar. Medio gibibyte. */
export const MIN_FREE_BYTES = 512 * 1024 * 1024

export interface DownloadTaskInput {
  readonly providerId: string
  readonly providerRef: string
  readonly episodeRef: string
  readonly title: string
  readonly episodeLabel: string
}

export interface DownloadStream {
  readonly url: string
  readonly kind: 'file' | 'hls'
  readonly headers?: Readonly<Record<string, string>> | undefined
  /**
   * Las pistas que declaró la fuente.
   *
   * Su `url` sigue siendo la del upstream: el motor las baja con el mismo
   * `fetch` guardado que el vídeo y sólo entonces se guarda en disco. Una pista
   * que no se pueda bajar no tumba la descarga del episodio.
   */
  readonly subtitles?: readonly DownloadSubtitleTrack[] | undefined
}

/** Una pista tal y como la declara el proveedor, antes de bajarla. */
export interface DownloadSubtitleTrack {
  readonly lang: string
  readonly label: string
  readonly url: string
  readonly format: SubtitleFormat
  readonly default?: boolean | undefined
}

/** Una pista ya bajada, con su ruta relativa a la raíz de descargas. */
export interface DownloadedSubtitle {
  readonly indice: number
  readonly lang: string
  readonly label: string
  readonly format: SubtitleFormat
  readonly relPath: string
  readonly isDefault: boolean
}

/** Por qué se omitió una pista. La descarga del vídeo no se da por fallida. */
export interface DownloadSubtitleFailure {
  readonly indice: number
  readonly label: string
  readonly message: string
}

export type ResolveDownloadStream = (task: DownloadTaskInput) => Promise<DownloadStream | undefined>

export interface DownloadEngineInput {
  readonly root: string
  readonly task: DownloadTaskInput
  readonly resolve: ResolveDownloadStream
  readonly signal: AbortSignal
  readonly fetchImpl?: FetchLike | undefined
  readonly remux?: RemuxFn | undefined
  readonly ffmpegPath?: string | undefined
  readonly freeBytes?: (() => Promise<number>) | undefined
  readonly minFreeBytes?: number | undefined
  readonly onProgress?: ((bytes: number, totalBytes: number | undefined) => void) | undefined
}

export interface DownloadOutcome {
  readonly kind: 'file' | 'hls' | 'segments'
  /** Ruta absoluta del archivo o de la playlist local. */
  readonly path: string
  /** La misma ruta, relativa a la raíz: es lo que se guarda en la base. */
  readonly relPath: string
  readonly bytes: number
  readonly totalBytes?: number
  readonly segments?: number
  /** Las pistas que sí se bajaron. */
  readonly subtitles: readonly DownloadedSubtitle[]
  /** Las que se omitieron, con su motivo. */
  readonly subtitleErrors: readonly DownloadSubtitleFailure[]
}

/**
 * Un trozo de ruta seguro.
 *
 * Sólo letras, números, punto, guion y guion bajo. Los espacios y los acentos se
 * convierten en guion: el nombre no tiene que ser bonito, tiene que ser el mismo
 * en cualquier sistema de archivos y no poder salirse de su carpeta.
 */
export function safeSegment(value: string, fallback = 'sin-nombre'): string {
  const limpio = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    // Dos puntos seguidos no son un nombre: son un intento de «..».
    .replace(/\.{2,}/g, '.')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80)

  return limpio === '' || limpio === '.' || limpio === '..' ? fallback : limpio
}

/** Un identificador corto y estable para no pisar dos episodios del mismo nombre. */
function huella(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 8)
}

export interface DownloadPaths {
  readonly dir: string
  readonly file: string
}

/** Dónde vive una descarga, con todos los segmentos saneados. */
export function downloadPaths(root: string, task: DownloadTaskInput): DownloadPaths {
  const base = resolve(root)
  const carpeta = resolve(base, safeSegment(task.providerId), safeSegment(task.title))
  const nombre = `${safeSegment(task.episodeLabel, 'episodio')}-${huella(task.episodeRef)}`

  return { dir: resolve(carpeta, nombre), file: resolve(carpeta, `${nombre}.mp4`) }
}

/** Si una ruta está dentro de la raíz, sin `..` ni unidades de otro disco. */
export function insideRoot(root: string, path: string): boolean {
  const relativa = relative(resolve(root), resolve(path))

  return (
    relativa === '' ||
    (relativa !== '..' && !relativa.startsWith(`..${sep}`) && !isAbsolute(relativa))
  )
}

/**
 * Envuelve `fetch` con la lista blanca de destinos.
 *
 * Se comprueba **cada** URL, también las de los segmentos: un manifiesto puede
 * apuntar a loopback aunque la playlist venga de un host permitido.
 */
export function guardedFetch(fetchImpl?: FetchLike): FetchLike {
  // Sin un `fetch` inyectado —el camino de producción—, la conexión va a la
  // dirección que se validó: `createPinnedFetch` resuelve el nombre una vez,
  // juzga todas sus respuestas y fija el `lookup`. El `fetch` global volvía a
  // resolver después de la comprobación y dejaba abierta la ventana del DNS
  // rebinding. Con un `fetch` inyectado —las pruebas— se conserva la
  // comprobación literal y no se toca la red.
  const base = fetchImpl ?? createPinnedFetch()

  return async (url, init) => {
    const destino = checkDestination(url)
    if (!destino.ok) throw new Error(`destino no permitido: ${destino.rule}`)

    return await base(url, init)
  }
}

/**
 * ffmpeg al alcance, si hay.
 *
 * La búsqueda —entorno, junto al ejecutable, instaladores y `PATH`— vive en
 * `ffmpeg.ts`, porque la conversión de una descarga ya hecha hace la misma
 * pregunta y tiene que recibir la misma respuesta.
 */
export function findFfmpeg(): string | undefined {
  return locateFfmpeg()
}

export { createFfmpegRemux }

/**
 * Baja las pistas de subtítulos que declaró la fuente.
 *
 * Va **después** del vídeo y no antes: un HLS remezclado borra su carpeta de
 * segmentos al terminar, y las pistas tienen que sobrevivir a eso. Cada pista se
 * escribe con un nombre corto y seguro dentro de la carpeta del episodio.
 *
 * Una pista que falla se omite y se devuelve con su motivo; el episodio ya está
 * entero en disco y no puede quedarse en «failed» por un subtítulo. La excepción
 * es la pausa: si la señal se abortó, el fallo se propaga para que la fila quede
 * en pausa y no en completa.
 */
async function descargarSubtitulos(input: {
  readonly stream: DownloadStream
  readonly dir: string
  readonly root: string
  readonly fetchImpl: FetchLike
  readonly signal: AbortSignal
}): Promise<{
  readonly subtitles: readonly DownloadedSubtitle[]
  readonly errors: readonly DownloadSubtitleFailure[]
}> {
  const subtitles: DownloadedSubtitle[] = []
  const errors: DownloadSubtitleFailure[] = []

  for (const [indice, pista] of (input.stream.subtitles ?? []).entries()) {
    if (input.signal.aborted) throw new Error('la descarga se detuvo antes de bajar los subtítulos')

    const nombre = `${String(indice).padStart(2, '0')}-${safeSegment(pista.lang, 'xx')}.${pista.format}`
    const destino = resolve(input.dir, nombre)

    if (!insideRoot(input.root, destino)) {
      errors.push({
        indice,
        label: pista.label,
        message: 'la ruta de la pista se sale de la carpeta de descargas',
      })
      continue
    }

    try {
      await downloadFile({
        url: pista.url,
        filePath: destino,
        ...(input.stream.headers === undefined ? {} : { headers: input.stream.headers }),
        signal: input.signal,
        fetchImpl: input.fetchImpl,
        // Un subtítulo no es un vídeo: 5 MB ya es un archivo enorme para una
        // pista, y el mismo tope que aplica el proxy.
        maxBytes: MAX_SUBTITLE_BYTES,
      })

      subtitles.push({
        indice,
        lang: pista.lang,
        label: pista.label,
        format: pista.format,
        relPath: relative(input.root, destino),
        isDefault: pista.default === true,
      })
    } catch (cause) {
      if (input.signal.aborted) throw cause

      // Un `.part` que se queda no sirve de nada: la pista se reintenta entera y
      // no hay reanudación que valga la pena para cinco megas.
      await rm(`${destino}.part`, { force: true })
      await rm(`${destino}.part.json`, { force: true })

      errors.push({
        indice,
        label: pista.label,
        message: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  return { subtitles, errors }
}

/**
 * Baja una tarea y devuelve qué quedó.
 *
 * No escribe en la cola: eso lo hace quien llama, que es el único que sabe si el
 * proceso sigue vivo y si otra descarga ocupa el turno.
 */
export async function downloadTask(input: DownloadEngineInput): Promise<DownloadOutcome> {
  const root = resolve(input.root)
  const rutas = downloadPaths(root, input.task)

  if (!insideRoot(root, rutas.file) || !insideRoot(root, rutas.dir)) {
    throw new Error('la ruta de la descarga se sale de la carpeta de descargas')
  }

  const minino = input.minFreeBytes ?? MIN_FREE_BYTES
  if (input.freeBytes !== undefined && (await input.freeBytes()) < minino) {
    throw new Error(`no hay espacio suficiente: se necesitan al menos ${minino} bytes libres`)
  }

  const stream = await input.resolve(input.task)
  if (stream === undefined) throw new Error('el proveedor no dio ningún stream para descargar')

  const fetchSeguro = guardedFetch(input.fetchImpl)
  const remux =
    input.remux ??
    (input.ffmpegPath === undefined ? undefined : createFfmpegRemux(input.ffmpegPath))

  if (stream.kind === 'file') {
    const bajado = await downloadFile({
      url: stream.url,
      filePath: rutas.file,
      ...(stream.headers === undefined ? {} : { headers: stream.headers }),
      signal: input.signal,
      fetchImpl: fetchSeguro,
      ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
    })

    const pistas = await descargarSubtitulos({
      stream,
      dir: rutas.dir,
      root,
      fetchImpl: fetchSeguro,
      signal: input.signal,
    })

    return {
      kind: 'file',
      path: bajado.path,
      relPath: relative(root, bajado.path),
      bytes: bajado.bytes,
      ...(bajado.totalBytes === undefined ? {} : { totalBytes: bajado.totalBytes }),
      subtitles: pistas.subtitles,
      subtitleErrors: pistas.errors,
    }
  }

  const hls = await downloadHls({
    playlistUrl: stream.url,
    dir: rutas.dir,
    mp4Path: rutas.file,
    ...(stream.headers === undefined ? {} : { headers: stream.headers }),
    signal: input.signal,
    fetchImpl: fetchSeguro,
    ...(remux === undefined ? {} : { remux }),
    // Convertir no puede tumbar una descarga que ya está entera en disco.
    remuxOpcional: true,
    ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
  })

  const pistas = await descargarSubtitulos({
    stream,
    dir: rutas.dir,
    root,
    fetchImpl: fetchSeguro,
    signal: input.signal,
  })

  return {
    kind: hls.kind === 'hls' ? 'hls' : 'segments',
    path: hls.path,
    relPath: relative(root, hls.path),
    bytes: hls.bytes,
    // Al terminar, el total deja de ser la proyección de la playlist: es lo que
    // quedó en disco. Así la fila cerrada dice cien por cien y no noventa y
    // siete.
    totalBytes: hls.bytes,
    segments: hls.segments,
    subtitles: pistas.subtitles,
    subtitleErrors: pistas.errors,
  }
}
