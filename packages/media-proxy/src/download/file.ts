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

import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
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

/**
 * Lo que hace falta para saber que el `.part` es del mismo recurso.
 *
 * Sin esto, reanudar sólo con `Range` podía concatenar bytes de dos versiones
 * del archivo y marcarlo como completo. El `.part` sin sidecar se tira: es más
 * barato volver a bajar que reproducir un archivo mezclado.
 */
interface Validador {
  readonly etag?: string
  readonly lastModified?: string
  readonly total?: number
}

function sidecarDe(temporal: string): string {
  return `${temporal}.json`
}

function textoDe(registro: Record<string, unknown>, clave: string): string | undefined {
  const valor = registro[clave]
  return typeof valor === 'string' && valor !== '' ? valor : undefined
}

async function leerValidador(ruta: string): Promise<Validador | undefined> {
  try {
    const crudo: unknown = JSON.parse(await readFile(ruta, 'utf8'))
    if (typeof crudo !== 'object' || crudo === null) return undefined

    const registro = crudo as Record<string, unknown>
    const etag = textoDe(registro, 'etag')
    const lastModified = textoDe(registro, 'lastModified')
    const total =
      typeof registro.total === 'number' && Number.isInteger(registro.total)
        ? registro.total
        : undefined

    if (etag === undefined && lastModified === undefined && total === undefined) return undefined

    return {
      ...(etag === undefined ? {} : { etag }),
      ...(lastModified === undefined ? {} : { lastModified }),
      ...(total === undefined ? {} : { total }),
    }
  } catch {
    return undefined
  }
}

async function guardarValidador(ruta: string, validador: Validador): Promise<void> {
  if (
    validador.etag === undefined &&
    validador.lastModified === undefined &&
    validador.total === undefined
  ) {
    await rm(ruta, { force: true })
    return
  }

  await writeFile(ruta, JSON.stringify(validador), 'utf8')
}

/** El inicio de un `Content-Range: bytes N-M/T`. */
function inicioDeRango(header: string | null): number | undefined {
  const inicio = /^bytes\s+(\d+)-\d+\//.exec(header ?? '')?.[1]
  if (inicio === undefined) return undefined

  const numero = Number(inicio)
  return Number.isInteger(numero) && numero >= 0 ? numero : undefined
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

  const sidecar = sidecarDe(temporal)
  let yaHabia = await tamanoDe(temporal)
  let validador = yaHabia > 0 ? await leerValidador(sidecar) : undefined

  if (yaHabia > 0 && validador === undefined) {
    // Un `.part` que no sabe de qué recurso viene no se puede reanudar.
    await rm(temporal, { force: true })
    yaHabia = 0
  }

  const headers: Record<string, string> = { ...input.headers }
  if (yaHabia > 0) {
    headers.Range = `bytes=${yaHabia}-`
    const ifRange = validador?.etag ?? validador?.lastModified
    if (ifRange !== undefined) headers['If-Range'] = ifRange
  }

  const fetchImpl: FetchLike = input.fetchImpl ?? ((url, init) => fetch(url, init))
  const respuesta = await fetchImpl(input.url, {
    headers,
    signal: input.signal,
    // Una redirección es la forma más fácil de saltarse la lista blanca que sólo
    // mira la primera URL. Aquí no se sigue: el motor la trata como un fallo.
    redirect: 'manual',
  })

  if (respuesta.status === 416) {
    const total = totalDe(respuesta, 0)
    if (yaHabia > 0 && total === yaHabia && validador?.total === total) {
      // El servidor confirma que no hay nada después de lo que tenemos y la
      // talla coincide con la que se guardó: el temporal está completo.
      await rm(sidecar, { force: true })
      await rename(temporal, input.filePath)
      return { bytes: yaHabia, path: input.filePath }
    }

    // Un 416 sin talla o con otra talla no es un archivo completo: es un
    // temporal que no se puede confiar. Se tira y el siguiente intento empieza
    // de cero.
    await rm(temporal, { force: true })
    await rm(sidecar, { force: true })
    throw new Error('la descarga reanudada no coincide con el archivo del servidor')
  }

  if (!respuesta.ok) {
    throw new Error(`la descarga respondió ${respuesta.status}`)
  }

  let desde = yaHabia
  if (desde > 0 && respuesta.status === 200) {
    // El servidor ignoró el rango (o el recurso cambió y `If-Range` no valía) y
    // va a mandar el archivo entero: se tira el temporal para no concatenar dos
    // versiones.
    desde = 0
    validador = undefined
    await rm(temporal, { force: true })
    await rm(sidecar, { force: true })
  }

  if (desde > 0 && respuesta.status === 206) {
    const inicio = inicioDeRango(respuesta.headers.get('content-range'))
    const total = totalDe(respuesta, desde)

    if (inicio !== desde) {
      await rm(temporal, { force: true })
      await rm(sidecar, { force: true })
      throw new Error('la respuesta reanudada no empieza donde se pidió')
    }

    if (validador?.total !== undefined && total !== undefined && validador.total !== total) {
      await rm(temporal, { force: true })
      await rm(sidecar, { force: true })
      throw new Error('la descarga reanudada cambió de tamaño en el servidor')
    }
  }

  if (respuesta.body === null) throw new Error('la descarga no trajo cuerpo')

  const total = totalDe(respuesta, desde)
  if (total !== undefined && total > maximo) {
    throw new Error(`el archivo pasa del tope de ${maximo} bytes`)
  }

  const etag = respuesta.headers.get('etag') ?? validador?.etag
  const lastModified = respuesta.headers.get('last-modified') ?? validador?.lastModified
  await guardarValidador(sidecar, {
    ...(etag === undefined ? {} : { etag }),
    ...(lastModified === undefined ? {} : { lastModified }),
    ...(total === undefined ? {} : { total }),
  })

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
  await rm(sidecar, { force: true })

  return {
    bytes: escritos,
    ...(total === undefined ? {} : { totalBytes: total }),
    path: input.filePath,
  }
}
