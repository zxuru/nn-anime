#!/usr/bin/env bun
/**
 * El icono de la aplicación, generado desde código.
 *
 * Un icono es un archivo binario de tres formatos distintos —PNG, ICO e ICNS— y
 * guardarlo sin más deja el repositorio con tres binarios que nadie puede
 * revisar ni rehacer. Esto lo genera: se describe el dibujo una vez, en
 * coordenadas normalizadas, y de ahí salen el PNG maestro, los tamaños pequeños,
 * el `.ico` de Windows y el `.icns` de macOS.
 *
 * La forma sigue la lengua visual de la interfaz (`packages/web/src/styles/tokens.css`):
 * fondo casi negro, borde grueso color crema, **radios cero** y el naranja
 * encendido del acento. Un triángulo de reproducción y nada más: a 16 px, un
 * logotipo con letras es una mancha.
 *
 * No hay dependencias de imagen: el PNG se codifica aquí. Bun trae `deflate`, y
 * el resto —CRC-32, el envoltorio zlib, el contenedor ICO y el ICNS— son formatos
 * cortos y documentados. La alternativa era una dependencia nueva en un
 * repositorio que no tiene ninguna de imagen, para dibujar un cuadrado y un
 * triángulo.
 *
 * Uso: `bun run icon`
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ROOT } from './workspaces'

const ICONS = join(ROOT, 'packaging', 'icons')

type Rgb = readonly [number, number, number]

/** Los colores, copiados de los tokens de la interfaz. */
const BACKGROUND: Rgb = [0x0c, 0x0c, 0x10]
const BORDER: Rgb = [0xf2, 0xe9, 0xd8]
const ACCENT: Rgb = [0xff, 0x4a, 0x2e]

/**
 * El dibujo, en fracciones del lado.
 *
 * Normalizado y no en píxeles porque el mismo dibujo tiene que salir a 16 y a
 * 1024: con medidas absolutas, el borde desaparece en los tamaños pequeños.
 * Medido sobre la captura de la interfaz, que es de donde salen las
 * proporciones.
 */
const BORDER_INSET = 0.094
const BORDER_WIDTH = 0.06
const TRIANGLE = {
  left: 0.334,
  right: 0.726,
  top: 0.303,
  bottom: 0.697,
} as const

/** Cuántas muestras por lado y por píxel. Suaviza los bordes sin librerías. */
const SUPERSAMPLE = 3

function insideSquare(x: number, y: number, from: number, to: number): boolean {
  return x >= from && x < to && y >= from && y < to
}

/** Signo del producto vectorial: positivo a un lado de la recta, negativo al otro. */
function side(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  return (bx - ax) * (y - ay) - (by - ay) * (x - ax)
}

function insideTriangle(x: number, y: number, size: number): boolean {
  const ax = TRIANGLE.left * size
  const ay = TRIANGLE.top * size
  const bx = TRIANGLE.left * size
  const by = TRIANGLE.bottom * size
  const cx = TRIANGLE.right * size
  const cy = size / 2

  const d1 = side(x, y, ax, ay, bx, by)
  const d2 = side(x, y, bx, by, cx, cy)
  const d3 = side(x, y, cx, cy, ax, ay)
  const negativos = d1 < 0 || d2 < 0 || d3 < 0
  const positivos = d1 > 0 || d2 > 0 || d3 > 0

  return !(negativos && positivos)
}

function colorAt(x: number, y: number, size: number): Rgb {
  if (insideTriangle(x, y, size)) return ACCENT

  const fuera = BORDER_INSET * size
  const dentro = fuera + BORDER_WIDTH * size
  const enElMarco =
    insideSquare(x, y, fuera, size - fuera) && !insideSquare(x, y, dentro, size - dentro)

  return enElMarco ? BORDER : BACKGROUND
}

/**
 * Los píxeles RGBA de un lado, con supermuestreo.
 *
 * Se promedian las muestras de cada píxel en vez de decidir con su centro: sin
 * esto, el borde del triángulo sale escalonado y el icono parece roto en los
 * tamaños grandes.
 */
export function render(size: number): Uint8Array {
  const rgba = new Uint8Array(size * size * 4)
  const muestras = SUPERSAMPLE * SUPERSAMPLE
  const paso = 1 / SUPERSAMPLE

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0

      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const [cr, cg, cb] = colorAt(px + (sx + 0.5) * paso, py + (sy + 0.5) * paso, size)
          r += cr
          g += cg
          b += cb
        }
      }

      const base = (py * size + px) * 4
      rgba[base] = Math.round(r / muestras)
      rgba[base + 1] = Math.round(g / muestras)
      rgba[base + 2] = Math.round(b / muestras)
      rgba[base + 3] = 255
    }
  }

  return rgba
}

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)

  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }

  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff

  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)

  return (c ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0

  for (const byte of bytes) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }

  return ((b << 16) | a) >>> 0
}

function be32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ])
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((suma, parte) => suma + parte.byteLength, 0)
  const salida = new Uint8Array(total)
  let offset = 0

  for (const parte of parts) {
    salida.set(parte, offset)
    offset += parte.byteLength
  }

  return salida
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const nombre = new TextEncoder().encode(type)

  return concat([be32(data.byteLength), nombre, data, be32(crc32(concat([nombre, data])))])
}

/** Un PNG de 8 bits RGBA, sin entrelazar. */
export function encodePng(rgba: Uint8Array, size: number): Uint8Array {
  const raw = new Uint8Array(size * (size * 4 + 1))

  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // sin filtro: la imagen es plana y no gana nada
    raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1)
  }

  // `Bun.deflateSync` devuelve deflate **en crudo** —empieza por el bloque, no
  // por `78`—, así que el flujo zlib que pide PNG se arma aquí: cabecera y
  // adler32 son cuatro bytes y son obligatorios.
  const comprimido = Bun.deflateSync(raw)
  const zlib = concat([new Uint8Array([0x78, 0x01]), comprimido, be32(adler32(raw))])

  const ihdr = concat([
    be32(size),
    be32(size),
    new Uint8Array([8, 6, 0, 0, 0]), // 8 bits, RGBA, deflate, sin filtro, sin entrelazar
  ])

  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib),
    pngChunk('IEND', new Uint8Array(0)),
  ])
}

export interface IconImage {
  readonly size: number
  readonly rgba: Uint8Array
  readonly png: Uint8Array
}

/**
 * Una entrada de `.ico` en el formato clásico: cabecera DIB y píxeles.
 *
 * **No vale con meter el PNG**, aunque el formato lo admita desde Vista y aunque
 * ocupe la décima parte. Medido: un `.ico` con entradas PNG hace que Bun escriba
 * un ejecutable de **2,66 GB** que Windows rechaza con «no es una aplicación
 * válida» —el inyector de recursos lee los primeros bytes del PNG, que son la
 * firma `\x89PNG`, como si fueran el ancho y el alto de un mapa de bits—. Con
 * DIB el ejecutable sale de 98 MB y arranca.
 *
 * El mapa de bits va de abajo arriba, en BGRA, y con su máscara AND de un bit por
 * píxel: en blanco (todo ceros) porque la transparencia la lleva el canal alfa.
 */
function icoEntry(rgba: Uint8Array, size: number): Uint8Array {
  const cabecera = new Uint8Array(40)
  const vista = new DataView(cabecera.buffer)

  vista.setUint32(0, 40, true) // tamaño de la cabecera
  vista.setInt32(4, size, true) // ancho
  vista.setInt32(8, size * 2, true) // alto: el color y la máscara, uno tras otro
  vista.setUint16(12, 1, true) // planos
  vista.setUint16(14, 32, true) // bits por píxel
  vista.setUint32(16, 0, true) // sin comprimir
  vista.setUint32(20, size * size * 4, true) // tamaño de los píxeles

  const pixeles = new Uint8Array(size * size * 4)

  for (let y = 0; y < size; y++) {
    const fila = (size - 1 - y) * size * 4

    for (let x = 0; x < size; x++) {
      const origen = fila + x * 4
      const destino = (y * size + x) * 4

      pixeles[destino] = rgba[origen + 2] ?? 0
      pixeles[destino + 1] = rgba[origen + 1] ?? 0
      pixeles[destino + 2] = rgba[origen] ?? 0
      pixeles[destino + 3] = rgba[origen + 3] ?? 255
    }
  }

  // La máscara AND: una fila por píxel de alto, cada una con los bits que hagan
  // falta hasta un múltiplo de cuatro. En cero, que es «usa el alfa».
  const mascara = new Uint8Array(Math.ceil(size / 32) * 4 * size)

  return concat([cabecera, pixeles, mascara])
}

/** Un `.ico` con una entrada DIB por tamaño. */
export function encodeIco(images: readonly IconImage[]): Uint8Array {
  const entradas: Uint8Array[] = images.map((image) => icoEntry(image.rgba, image.size))

  const cabecera = concat([
    new Uint8Array([0, 0]), // reservado
    new Uint8Array([1, 0]), // tipo: icono
    new Uint8Array([images.length & 0xff, (images.length >> 8) & 0xff]),
  ])

  let offset = 6 + images.length * 16
  const directorio: Uint8Array[] = []

  for (const [index, image] of images.entries()) {
    const datos = entradas[index] ?? new Uint8Array(0)

    directorio.push(
      concat([
        // 256 no cabe en un byte y se escribe como 0.
        new Uint8Array([
          image.size >= 256 ? 0 : image.size,
          image.size >= 256 ? 0 : image.size,
          0,
          0,
        ]),
        new Uint8Array([1, 0]), // planos
        new Uint8Array([32, 0]), // bits por píxel
        be32(datos.byteLength),
        be32(offset),
      ]),
    )

    offset += datos.byteLength
  }

  return concat([cabecera, ...directorio, ...entradas])
}

/**
 * Un `.icns` con PNG dentro.
 *
 * Cada entrada lleva un tipo de cuatro letras; `ic07`…`ic14` son los que admiten
 * PNG. Se incluyen los seis que usa macOS hoy: si falta el de un tamaño, el
 * sistema escala el que haya y el icono sale borroso justo donde más se ve.
 */
export function encodeIcns(images: readonly IconImage[]): Uint8Array {
  const TIPOS: Readonly<Record<number, string>> = {
    32: 'ic11',
    64: 'ic12',
    128: 'ic07',
    256: 'ic13',
    512: 'ic09',
    1024: 'ic10',
  }

  const entradas: Uint8Array[] = []

  for (const image of images) {
    const tipo = TIPOS[image.size]
    if (tipo === undefined) continue

    entradas.push(
      concat([new TextEncoder().encode(tipo), be32(image.png.byteLength + 8), image.png]),
    )
  }

  const cuerpo = concat(entradas)

  return concat([new TextEncoder().encode('icns'), be32(cuerpo.byteLength + 8), cuerpo])
}

/** Los tamaños que se generan, de menor a mayor. */
export const SIZES: readonly number[] = [16, 32, 48, 64, 128, 256, 512, 1024]

async function main(): Promise<void> {
  await mkdir(ICONS, { recursive: true })

  const images: IconImage[] = SIZES.map((size) => {
    const rgba = render(size)

    return { size, rgba, png: encodePng(rgba, size) }
  })

  for (const image of images) {
    await Bun.write(join(ICONS, `icon-${image.size}.png`), image.png)
  }

  // El maestro y el de 512 tienen nombre propio: son los que se enseñan en el
  // README, el que usa Linux y el que espera cualquiera que quiera rehacerlos.
  const maestro = images.find((image) => image.size === 1024)
  if (maestro !== undefined) await Bun.write(join(ICONS, 'icon.png'), maestro.png)

  await Bun.write(join(ICONS, 'icon.ico'), encodeIco(images.filter((image) => image.size <= 256)))
  await Bun.write(join(ICONS, 'icon.icns'), encodeIcns(images))

  process.stdout.write(`iconos escritos en ${ICONS}\n`)
  process.stdout.write(`  tamaños: ${SIZES.join(', ')}\n`)
}

if (import.meta.main) {
  await main()
}
