import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'
import {
  decodeSubtitle,
  extractFirstSubtitle,
  isRarBytes,
  isZipBytes,
  MAX_SUBTITLE_BYTES,
  srtToVtt,
  subtitleKind,
  subtitleTooLarge,
} from './subtitles'

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url))

describe('qué formato es', () => {
  test('por extensión', () => {
    expect(subtitleKind('https://ejemplo/es.vtt')).toBe('vtt')
    expect(subtitleKind('https://ejemplo/es.srt')).toBe('srt')
    expect(subtitleKind('https://ejemplo/es.ass')).toBe('ass')
    expect(subtitleKind('https://ejemplo/es.ssa')).toBe('ass')
    expect(subtitleKind('https://ejemplo/es.txt')).toBe('other')
  })

  test('por tipo declarado, aunque la extensión no lo diga', () => {
    expect(subtitleKind('https://ejemplo/track?id=1', 'text/vtt')).toBe('vtt')
    expect(subtitleKind('https://ejemplo/track', 'application/x-subrip; charset=utf-8')).toBe('srt')
    expect(subtitleKind('https://ejemplo/track', 'text/x-ssa')).toBe('ass')
  })

  test('una dirección que no se puede analizar no lanza', () => {
    expect(subtitleKind('no-es-url.srt')).toBe('srt')
    expect(subtitleKind('no-es-url')).toBe('other')
  })
})

describe('detección de codificación', () => {
  test('UTF-8 con BOM: se quita el BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('ñandú')])
    const salida = decodeSubtitle(bytes)

    expect(salida.encoding).toBe('utf-8')
    expect(salida.text).toBe('ñandú')
  })

  test('UTF-16 con BOM, en las dos variantes', () => {
    const texto = 'acentos: ñ á ü'
    const utf16le = new Uint8Array([0xff, 0xfe, ...new TextEncoder().encode(texto)])
    const utf16be = new Uint8Array([0xfe, 0xff, ...new TextEncoder().encode(texto)])

    // El BOM manda: se comprueba que la detección no depende del contenido.
    expect(decodeSubtitle(utf16le).encoding).toBe('utf-16le')
    expect(decodeSubtitle(utf16be).encoding).toBe('utf-16be')
  })

  test('un byte suelto que no es UTF-8 se decodifica como windows-1252', () => {
    // `0xF1` es `ñ` en windows-1252 y no es UTF-8 válido por sí solo.
    const bytes = new Uint8Array([0x41, 0xf1, 0x6f])
    const salida = decodeSubtitle(bytes)

    expect(salida.encoding).toBe('windows-1252')
    expect(salida.text).toBe('Año')
  })

  test('UTF-8 sin BOM se detecta como UTF-8', () => {
    const salida = decodeSubtitle(new TextEncoder().encode('ñ'))

    expect(salida.encoding).toBe('utf-8')
    expect(salida.text).toBe('ñ')
  })
})

describe('conversión de srt a vtt', () => {
  test('el fixture con BOM y CRLF coincide con la salida esperada', async () => {
    const crudo = await readFile(`${FIXTURES}sample.srt`)
    const esperado = await readFile(`${FIXTURES}sample.expected.vtt`, 'utf8')

    const { text } = decodeSubtitle(new Uint8Array(crudo))

    expect(srtToVtt(text)).toBe(esperado)
  })

  test('quita la numeración, cambia las comas y pone la cabecera', () => {
    const salida = srtToVtt('1\n00:00:01,000 --> 00:00:04,000\nHola\n')

    expect(salida).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHola\n')
  })

  test('conserva las líneas de texto, incluidas las que parecen números', () => {
    const salida = srtToVtt('1\n00:00:01,000 --> 00:00:04,000\n1\n2\n3\n')

    // «1», «2» y «3» son texto del subtítulo: sólo se quita la numeración, que va
    // antes de la línea de tiempos.
    expect(salida).toContain('1\n2\n3')
  })

  test('normaliza CRLF y CR sueltos', () => {
    expect(srtToVtt('1\r00:00:01,000 --> 00:00:04,000\rHola\r')).toContain('00:00:01.000')
  })

  test('un vtt ya convertido se devuelve igual', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHola\n'

    expect(srtToVtt(vtt)).toBe(vtt)
  })

  test('no deja tres saltos de línea seguidos', () => {
    expect(srtToVtt('1\n00:00:01,000 --> 00:00:04,000\nHola\n\n\n\n2\n')).not.toContain('\n\n\n')
  })

  test('un subtítulo vacío produce una cabecera válida', () => {
    expect(srtToVtt('')).toBe('WEBVTT\n')
  })

  test('los estilos entre llaves se conservan', () => {
    const salida = srtToVtt('1\n00:00:01,000 --> 00:00:04,000\n{\\an8}Arriba\n')

    expect(salida).toContain('{\\an8}Arriba')
  })
})

describe('tope de tamaño', () => {
  test('el tope es el del spec', () => {
    expect(MAX_SUBTITLE_BYTES).toBe(5 * 1024 * 1024)
  })

  test('el error dice cuántos bytes llegaron y cuál es el tope', () => {
    const error = subtitleTooLarge(MAX_SUBTITLE_BYTES + 1)

    expect(error.message).toContain(String(MAX_SUBTITLE_BYTES))
    expect(error.context.bytes).toBe(MAX_SUBTITLE_BYTES + 1)
  })
})

/**
 * Un zip mínimo construido a mano, sin dependencias: cabecera local, nombre y
 * datos, sin directorio central. El lector sólo mira cabeceras locales, así que
 * lo que venga detrás de la última entrada frena el recorrido sin romper nada.
 */
function entradaZip(nombre: string, datos: Uint8Array, method: 0 | 8): Uint8Array {
  const nombreBytes = new TextEncoder().encode(nombre)
  const cuerpo = method === 0 ? datos : new Uint8Array(deflateRawSync(datos))
  const cabecera = new DataView(new ArrayBuffer(30))

  cabecera.setUint32(0, 0x04034b50, true)
  cabecera.setUint16(8, method, true)
  cabecera.setUint32(18, cuerpo.byteLength, true)
  cabecera.setUint32(22, datos.byteLength, true)
  cabecera.setUint16(26, nombreBytes.byteLength, true)

  const zip = new Uint8Array(30 + nombreBytes.byteLength + cuerpo.byteLength)
  zip.set(new Uint8Array(cabecera.buffer), 0)
  zip.set(nombreBytes, 30)
  zip.set(cuerpo, 30 + nombreBytes.byteLength)

  return zip
}

function zipDe(...entradas: Uint8Array[]): Uint8Array {
  const total = entradas.reduce((largo, entrada) => largo + entrada.byteLength, 0)
  const zip = new Uint8Array(total)
  let offset = 0

  for (const entrada of entradas) {
    zip.set(entrada, offset)
    offset += entrada.byteLength
  }

  return zip
}

const SRT = new TextEncoder().encode('1\n00:00:01,000 --> 00:00:04,000\nHola\n')

describe('subtítulos dentro de un zip', () => {
  test('la firma manda, no la extensión: un bajar.php sin ella es zip', () => {
    const zip = zipDe(entradaZip('peli.srt', SRT, 0))

    expect(isZipBytes(zip)).toBe(true)
    expect(isZipBytes(SRT)).toBe(false)
    expect(isRarBytes(new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00, 0x00]))).toBe(true)
    expect(isRarBytes(zip)).toBe(false)
  })

  test('extrae la primera con extensión de subtítulo aunque haya otras antes', () => {
    const zip = zipDe(
      entradaZip('leeme.txt', new TextEncoder().encode('hola'), 0),
      entradaZip('peli.srt', SRT, 0),
    )
    const salida = extractFirstSubtitle(zip)

    expect(salida.name).toBe('peli.srt')
    expect(salida.bytes).toEqual(SRT)
  })

  test('infla una entrada deflated y el texto convierte a vtt', () => {
    const zip = zipDe(entradaZip('peli.srt', SRT, 8))
    const salida = extractFirstSubtitle(zip)

    expect(salida.bytes).toEqual(SRT)
    expect(srtToVtt(decodeSubtitle(salida.bytes).text)).toContain('00:00:01.000')
  })

  test('un zip sin subtítulos lo dice con su nombre', () => {
    const zip = zipDe(entradaZip('leeme.txt', new TextEncoder().encode('hola'), 0))

    expect(() => extractFirstSubtitle(zip)).toThrow(/ningún subtítulo/)
  })

  test('un zip truncado es un zip roto, no un vacío', () => {
    const zip = zipDe(entradaZip('peli.srt', SRT, 0))

    expect(() => extractFirstSubtitle(zip.subarray(0, 10))).toThrow(/roto/)
  })

  test('una bomba descomprimida choca contra el tope', () => {
    // Seis megas de ceros comprimen en kilobytes: el tope tiene que mirar lo
    // que sale, no lo que entra.
    const grande = new Uint8Array(MAX_SUBTITLE_BYTES + 1)
    const zip = zipDe(entradaZip('peli.srt', grande, 8))

    expect(() => extractFirstSubtitle(zip)).toThrow(String(MAX_SUBTITLE_BYTES))
  })
})
