/**
 * La descarga directa de un archivo, con reanudación.
 *
 * Es la pieza que no sabe de HLS ni de ffmpeg: recibe una URL y una ruta final y
 * deja ahí los bytes. Las dos decisiones que importan:
 *
 * 1. **Se escribe en `.part` y se renombra al terminar.** Un corte deja el
 *    temporal, que es justo lo que permite reanudar; el archivo final nunca
 *    existe a medias con el nombre que el usuario va a abrir.
 * 2. **Se reanuda por `Range`.** Si el servidor lo ignora y contesta 200, el
 *    temporal se tira y se empieza de cero: sumar dos veces el mismo trozo daría
 *    un archivo corrupto que además parecería completo.
 *
 * No decide rutas ni comprueba hosts: eso es del motor (T183d). Aquí la ruta ya
 * viene saneada y la URL ya viene resuelta.
 */

import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { FetchLike } from '../byte-proxy'

/** Tope de un archivo descargado. Ocho gibabytes es un episodio largo en 4K. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024 * 1024

export interface FileDownloadInput {
  readonly url: string
  /** Ruta final; el temporal es esta misma con `.part`. */
  readonly filePath: string
  readonly headers?: Readonly<Record<string, string>>
  readonly signal: AbortSignal
  readonly fetchImpl?: FetchLike | undefined
  readonly onProgress?: ((bytes: number, totalBytes: number | undefined) => void) | undefined
  readonly maxBytes?: number | undefined
}

export interface FileDownloadResult {
  readonly bytes: number
  readonly totalBytes?: number
  readonly path: string
}

async function tamanoDe(ruta: string): Promise<number> {
  try {
    const info = await stat(ruta)
    return info.isFile() ? info.size : 0
  } catch {
    return 0
  }
}

function totalDe(respuesta: Response, yaHabia: number): number | undefined {
  const rango = respuesta.headers.get('content-range')
  if (rango !== null) {
    const total = /\/\s*(\d+)\s*$/.exec(rango)?.[1]
    if (total !== undefined) return Number(total)
  }

  const largo = respuesta.headers.get('content-length')
  if (largo === null) return undefined

  const numero = Number(largo)
  return Number.isInteger(numero) && numero >= 0 ? yaHabia + numero : undefined
}

/**
 * Baja el archivo y devuelve lo que quedó.
 *
 * Un fallo **no borra el `.part`**: lo descargado es lo que hace que reintentar no
 * empiece de cero. El motor decide cuándo borrarlo (cancelar, cambiar de fuente).
 */
export async function downloadFile(input: FileDownloadInput): Promise<FileDownloadResult> {
  const temporal = `${input.filePath}.part`
  const maximo = input.maxBytes ?? MAX_FILE_BYTES

  await mkdir(dirname(input.filePath), { recursive: true })

  const yaHabia = await tamanoDe(temporal)
  const headers: Record<string, string> = { ...input.headers }
  if (yaHabia > 0) headers.Range = `bytes=${yaHabia}-`

  const fetchImpl: FetchLike = input.fetchImpl ?? ((url, init) => fetch(url, init))
  const respuesta = await fetchImpl(input.url, { headers, signal: input.signal })

  if (respuesta.status === 416 && yaHabia > 0) {
    // El servidor dice que no hay nada después de lo que ya tenemos: el temporal
    // está completo aunque nadie haya comprobado su tamaño.
    await rename(temporal, input.filePath)
    return { bytes: yaHabia, path: input.filePath }
  }

  if (!respuesta.ok) {
    throw new Error(`la descarga respondió ${respuesta.status}`)
  }

  let desde = yaHabia
  if (desde > 0 && respuesta.status === 200) {
    // El servidor ignoró el rango y va a mandar el archivo entero: el temporal
    // viejo se tira para no concatenar dos veces el mismo principio.
    desde = 0
    await rm(temporal, { force: true })
  }

  if (respuesta.body === null) throw new Error('la descarga no trajo cuerpo')

  const total = totalDe(respuesta, desde)
  if (total !== undefined && total > maximo) {
    throw new Error(`el archivo pasa del tope de ${maximo} bytes`)
  }

  const archivo = await open(temporal, desde > 0 ? 'a' : 'w')
  let escritos = desde

  try {
    for await (const trozo of respuesta.body) {
      const bytes: Uint8Array = trozo
      escritos += bytes.byteLength

      if (escritos > maximo) throw new Error(`el archivo pasa del tope de ${maximo} bytes`)

      await archivo.write(bytes)
      input.onProgress?.(escritos, total)
    }
  } finally {
    await archivo.close()
  }

  if (total !== undefined && escritos < total) {
    throw new Error(`la descarga quedó incompleta: ${escritos} de ${total} bytes`)
  }

  await rename(temporal, input.filePath)

  return {
    bytes: escritos,
    ...(total === undefined ? {} : { totalBytes: total }),
    path: input.filePath,
  }
}
