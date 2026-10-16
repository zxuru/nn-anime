/**
 * Subtítulos: decodificación y conversión.
 *
 * El navegador no entiende `srt` y mpv sí, así que la conversión se hace aquí,
 * en memoria, y el cliente recibe siempre algo que puede pintar. Tres reglas:
 *
 * 1. **La codificación se detecta, no se supone.** Un `srt` de un sitio de
 *    terceros puede venir en UTF-16 con BOM o en una codificación de un byte: si
 *    se decodifica como UTF-8 a ciegas, los acentos salen como rombos y el
 *    usuario culpa al reproductor.
 * 2. **El tope de 5 MB se comprueba antes de leer.** Un subtítulo se lee entero
 *    —hay que convertirlo—, así que el tope es lo único que impide que una pista
 *    de un gigabyte se convierta en un gigabyte de memoria.
 * 3. **`ass` no se toca.** Es un formato con estilos que mpv entiende y el
 *    navegador no; convertirlo mal es peor que no ofrecerlo, y quien decide no
 *    ofrecerlo es el reproductor web, no este módulo.
 */

import { inflateRawSync } from 'node:zlib'
import { AppError, UpstreamError } from '@nn-anime/core'

/** Tope de una pista de subtítulos, del spec. */
export const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024

export type SubtitleKind = 'vtt' | 'srt' | 'ass' | 'other'

/** Qué formato es, por extensión y por tipo declarado. */
export function subtitleKind(url: string, contentType?: string | undefined): SubtitleKind {
  const tipo = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (tipo === 'text/vtt') return 'vtt'
  if (tipo === 'application/x-subrip' || tipo === 'text/srt') return 'srt'
  if (tipo === 'text/x-ssa' || tipo === 'text/ass') return 'ass'

  const ruta = ((): string => {
    try {
      return new URL(url).pathname.toLowerCase()
    } catch {
      return url.toLowerCase()
    }
  })()

  if (ruta.endsWith('.vtt')) return 'vtt'
  if (ruta.endsWith('.srt')) return 'srt'
  if (ruta.endsWith('.ass') || ruta.endsWith('.ssa')) return 'ass'

  return 'other'
}

export interface DecodedSubtitle {
  readonly text: string
  /** La codificación que se detectó. Se informa para poder depurarlo. */
  readonly encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'
}

const BOM_UTF16LE = [0xff, 0xfe]
const BOM_UTF16BE = [0xfe, 0xff]

function empiezaCon(bytes: Uint8Array, marca: readonly number[]): boolean {
  if (bytes.length < marca.length) return false

  return marca.every((valor, indice) => bytes[indice] === valor)
}

/**
 * Decodifica bytes a texto, detectando la codificación.
 *
 * El orden importa: primero los BOM, que son una declaración explícita; después
 * UTF-8 estricto, que falla si no lo es; y sólo entonces una codificación de un
 * byte, que nunca falla y por eso no puede ser la primera opción.
 */
export function decodeSubtitle(bytes: Uint8Array): DecodedSubtitle {
  if (empiezaCon(bytes, BOM_UTF16LE)) {
    return {
      text: new TextDecoder('utf-16le').decode(bytes.subarray(2)),
      encoding: 'utf-16le',
    }
  }

  if (empiezaCon(bytes, BOM_UTF16BE)) {
    return {
      text: new TextDecoder('utf-16be').decode(bytes.subarray(2)),
      encoding: 'utf-16be',
    }
  }

  try {
    // El decodificador de UTF-8 se come el BOM él solo (`ignoreBOM` es falso por
    // defecto), así que aquí no se quita a mano: hacerlo era una línea de más que
    // ninguna prueba podía distinguir, y se midió antes de quitarla.
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    // Ni BOM ni UTF-8 válido: se prueba con la codificación de un byte más común
    // en subtítulos de la región, que nunca falla y siempre da algo legible.
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' }
  }
}

/** Un bloque de subtítulo: número, tiempos y texto. */
const NUMERO = /^\d+$/
const TIEMPOS = /^\d{1,2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2},\d{3}/

/**
 * Convierte `srt` a `vtt`.
 *
 * Se quitan las líneas de numeración y se cambian las comas de los tiempos por
 * puntos. El resto —el texto, los saltos, los estilos entre llaves— se copia tal
 * cual: una conversión que "mejora" el texto es una conversión que lo rompe.
 */
export function srtToVtt(text: string): string {
  const normalizado = text.replace(/\r\n?/g, '\n')
  if (normalizado.trimStart().startsWith('WEBVTT')) return normalizado

  const lineas = normalizado.split('\n')
  const salida: string[] = ['WEBVTT', '']

  /** La siguiente línea con contenido, para poder mirar antes de descartar. */
  const siguienteConTexto = (desde: number): string => {
    for (let indice = desde + 1; indice < lineas.length; indice++) {
      const candidata = (lineas[indice] ?? '').trim()
      if (candidata !== '') return candidata
    }

    return ''
  }

  for (const [indice, linea] of lineas.entries()) {
    const limpia = linea.trim()

    // Una línea que es sólo un número se descarta **si lo que viene detrás son
    // tiempos**: entonces es la numeración del `srt`. Si no, es el texto de un
    // subtítulo que dice «1», y borrarlo sería comerse el diálogo. Lo encontró
    // la prueba.
    if (NUMERO.test(limpia) && TIEMPOS.test(siguienteConTexto(indice))) continue

    if (TIEMPOS.test(limpia)) {
      salida.push(limpia.replace(/,/g, '.'))

      continue
    }

    salida.push(linea)
  }

  // Se normaliza el final: un `vtt` acaba en un salto de línea y no en tres.
  return `${salida
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`
}

/** Error de una pista que pasa del tope, antes de leerla entera. */
export function subtitleTooLarge(bytes: number): AppError {
  return new AppError({
    code: 'upstream',
    message: `la pista de subtítulos supera el tope de ${MAX_SUBTITLE_BYTES} bytes`,
    context: { bytes, max: MAX_SUBTITLE_BYTES },
    scope: 'media-proxy',
    op: 'readSubtitle',
  })
}

/**
 * Un zip con subtítulos dentro.
 *
 * Sitios como SubDivX no sirven el `.srt` suelto: el enlace de descarga devuelve
 * un zip con el subtítulo dentro, y sin extensión en la dirección. El plugin no
 * tiene dónde dejar un archivo descomprimido —su estado no sobrevive al reinicio
 * y el contrato no le da disco—, así que la extracción se hace aquí, en memoria,
 * con el mismo tope que una pista suelta.
 *
 * Sin dependencias nuevas: las entradas `stored` son una copia y las `deflated`
 * se inflan con `node:zlib`, que es biblioteca estándar y no una dependencia. Un
 * `rar` no se puede abrir sin una (se dice con su nombre, no con un 502
 * genérico) y un zip cifrado o con descriptor de datos se salta: sin la talla no
 * se sabe dónde empieza la entrada siguiente y adivinarla es leer basura.
 */

const ZIP_MAGIC: readonly number[] = [0x50, 0x4b, 0x03, 0x04]
const RAR_MAGIC: readonly number[] = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]

/** Cuántas entradas se miran antes de rendirse: acota el trabajo por zip. */
const MAX_ZIP_ENTRIES = 64

const ZIP_METHOD_STORED = 0
const ZIP_METHOD_DEFLATED = 8

const ZIP_FLAG_ENCRYPTED = 0x1
const ZIP_FLAG_DESCRIPTOR = 0x8
const ZIP_FLAG_UTF8 = 0x800

/** Extensiones que se saben servir, las del contrato más el alias `.ssa`. */
const SUBTITLE_EXTENSIONS: readonly string[] = ['.srt', '.vtt', '.ass', '.ssa']

export interface ExtractedSubtitle {
  /** El nombre dentro del zip, que es lo que dice el formato. */
  readonly name: string
  readonly bytes: Uint8Array
}

/** Si los bytes empiezan como un zip, por su firma y no por la extensión. */
export function isZipBytes(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((valor, indice) => bytes[indice] === valor)
}

/** Si los bytes empiezan como un rar, que no se sabe abrir. */
export function isRarBytes(bytes: Uint8Array): boolean {
  return RAR_MAGIC.every((valor, indice) => bytes[indice] === valor)
}

/** Un rar, que no se abre sin una dependencia que el proyecto no tiene. */
export function subtitleRarUnsupported(): AppError {
  return new UpstreamError({
    message: 'el archivo es un rar y no se puede abrir: sólo se admiten zip',
    context: { motivo: 'rar' },
    scope: 'media-proxy',
    op: 'readSubtitle',
  })
}

/** Un zip sin ninguna entrada que se sepa servir. */
export function subtitleNotInArchive(entries: number): AppError {
  return new UpstreamError({
    message: 'el zip no trae ningún subtítulo (.srt, .vtt o .ass)',
    context: { motivo: 'sin-subtitulo', entradas: entries },
    scope: 'media-proxy',
    op: 'readSubtitle',
  })
}

/** Un zip que no se deja leer: truncado, con zip64 o con un método raro. */
function subtitleZipBroken(detalle: string, cause?: unknown): AppError {
  return new UpstreamError({
    message: `el zip está roto: ${detalle}`,
    context: { motivo: 'zip-roto' },
    scope: 'media-proxy',
    op: 'readSubtitle',
    ...(cause === undefined ? {} : { cause }),
  })
}

function vistaDe(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/** Exige `largo` bytes legibles desde `offset`, o el zip está truncado. */
function exige(bytes: Uint8Array, offset: number, largo: number): void {
  if (offset < 0 || largo < 0 || offset + largo > bytes.length) {
    throw subtitleZipBroken('se acabó el archivo en mitad de una entrada')
  }
}

/**
 * La primera entrada legible con extensión de subtítulo.
 *
 * Se recorren las cabeceras locales en orden y se devuelve la primera que se
 * puede leer y acaba en `.srt`, `.vtt`, `.ass` o `.ssa`: un zip de SubDivX trae
 * normalmente una sola, y si trae varias manda la primera. Las cifradas y las
 * que declaran descriptor de datos se saltan —sin la talla no se sabe dónde
 * sigue el archivo— y lo que no es una cabecera local frena el recorrido, que es
 * donde empieza el directorio central.
 */
export function extractFirstSubtitle(bytes: Uint8Array): ExtractedSubtitle {
  const vista = vistaDe(bytes)
  let offset = 0
  let vistas = 0

  while (vistas < MAX_ZIP_ENTRIES) {
    // Llegar justo al final es un fin limpio —un zip de una sola entrada— y no
    // un truncado: lo roto es quedarse a medias de una cabecera o de unos datos.
    if (offset >= bytes.length) break

    exige(bytes, offset, 4)
    if (vista.getUint32(offset, true) !== 0x04034b50) break

    exige(bytes, offset, 30)
    const flags = vista.getUint16(offset + 6, true)
    const method = vista.getUint16(offset + 8, true)
    const compSize = vista.getUint32(offset + 18, true)
    const uncompSize = vista.getUint32(offset + 22, true)
    const nameLen = vista.getUint16(offset + 26, true)
    const extraLen = vista.getUint16(offset + 28, true)

    if (compSize === 0xffffffff || uncompSize === 0xffffffff) {
      throw subtitleZipBroken('usa zip64, que no se admite')
    }

    const inicioNombre = offset + 30
    exige(bytes, inicioNombre, nameLen + extraLen)
    const nombre = decodificaNombre(
      bytes.subarray(inicioNombre, inicioNombre + nameLen),
      (flags & ZIP_FLAG_UTF8) !== 0,
    )
    const inicioDatos = inicioNombre + nameLen + extraLen
    exige(bytes, inicioDatos, compSize)

    const esDirectorio = nombre.endsWith('/')
    const cifrada = (flags & ZIP_FLAG_ENCRYPTED) !== 0
    const conDescriptor = (flags & ZIP_FLAG_DESCRIPTOR) !== 0
    const legible = !esDirectorio && !cifrada && !conDescriptor

    if (legible && esSubtitulo(nombre)) {
      return {
        name: nombre,
        bytes: inflaEntrada(bytes.subarray(inicioDatos, inicioDatos + compSize), method),
      }
    }

    // Con descriptor la talla declarada no vale y no se sabe dónde sigue el
    // archivo: parar aquí leería basura como si fuera una entrada.
    if (conDescriptor) throw subtitleZipBroken('una entrada usa descriptor de datos')
    if (method !== ZIP_METHOD_STORED && method !== ZIP_METHOD_DEFLATED && legible) {
      throw subtitleZipBroken(`método de compresión ${method}, que no se admite`)
    }

    offset = inicioDatos + compSize
    vistas += 1
  }

  throw subtitleNotInArchive(vistas)
}

/** Si el nombre acaba en una extensión que se sabe servir. */
function esSubtitulo(nombre: string): boolean {
  const minusculas = nombre.toLowerCase()

  return SUBTITLE_EXTENSIONS.some((extension) => minusculas.endsWith(extension))
}

/**
 * El nombre de la entrada, en UTF-8 cuando el zip lo declara.
 *
 * Sin la marca se usa windows-1252, la misma suposición regional que al
 * decodificar una pista: el nombre sólo se usa para mirar la extensión, así que
 * lo que importa es no lanzar con un byte suelto.
 */
function decodificaNombre(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder('utf-8').decode(bytes)

  return new TextDecoder('windows-1252').decode(bytes)
}

/**
 * Los datos de una entrada, con el tope de una pista suelta.
 *
 * El tope se mira antes de inflar cuando la cabecera lo dice y después cuando
 * miente: una talla declarada de cero con diez megas dentro es el zip-bomb de
 * manual, y el tope es lo que impide que acabe en memoria.
 */
function inflaEntrada(datos: Uint8Array, method: number): Uint8Array {
  if (method === ZIP_METHOD_STORED) {
    if (datos.byteLength > MAX_SUBTITLE_BYTES) throw subtitleTooLarge(datos.byteLength)

    return datos.slice()
  }

  if (method !== ZIP_METHOD_DEFLATED) throw subtitleZipBroken(`método ${method}, que no se admite`)

  let inflados: Uint8Array
  try {
    inflados = new Uint8Array(inflateRawSync(datos))
  } catch (cause) {
    throw subtitleZipBroken('no se pudo descomprimir una entrada', cause)
  }

  if (inflados.byteLength > MAX_SUBTITLE_BYTES) throw subtitleTooLarge(inflados.byteLength)

  return inflados
}
