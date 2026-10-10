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

import { AppError } from '@nn-anime/core'

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
