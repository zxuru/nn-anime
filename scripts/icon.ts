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
 * La marca se llama **la R-raposa**: una «R» cuyo ojo es una cabeza de raposa
 * —orejas de la casa, morro redondo— con un triángulo de reproducción en el
 * contador y una órbita coral que la rodea. Sigue la lengua visual de la
 * interfaz (`packages/web/src/styles/tokens.css`): fondo casi negro, crema
 * cálida, radios de pieza y el coral como único acento. El comentario de
 * `docs/marca.md` cuenta por qué cada pieza está donde está.
 *
 * **El detalle se adapta al tamaño.** A 16 px una órbita, un destello y un
 * contorno interior son una mancha: por debajo de 48 px se apagan y el
 * triángulo de reproducción pasa a tinta sobre crema, que es el par de más
 * contraste de la PALETA. Lo que se ve en la bandeja del sistema es la marca
 * desnuda, no una miniatura ilegible de la versión grande.
 *
 * No hay dependencias de imagen: el PNG se codifica aquí. Bun trae `deflate`, y
 * el resto —CRC-32, el envoltorio zlib, el contenedor ICO y el ICNS— son formatos
 * cortos y documentados. La alternativa era una dependencia nueva en un
 * repositorio que no tiene ninguna de imagen, para dibujar una raposa.
 *
 * Uso: `bun run icon`
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ROOT } from './workspaces'

const ICONS = join(ROOT, 'packaging', 'icons')

type Rgba = readonly [number, number, number, number]
type Point = readonly [number, number]

/** Los colores, copiados de `tokens.css`. */
const INK: Rgba = [0x08, 0x08, 0x0a, 255]
const PLATE: Rgba = [0x0b, 0x0b, 0x11, 255]
const PLATE_LIFT: Rgba = [0x1d, 0x15, 0x21, 255]
const CREAM: Rgba = [0xf5, 0xf0, 0xe6, 255]
const CORAL: Rgba = [0xff, 0x5c, 0x35, 255]
const NADA: Rgba = [0, 0, 0, 0]

// --- La geometría, en fracciones del lado -----------------------------------
//
// Normalizada y no en píxeles porque el mismo dibujo tiene que salir a 16 y a
// 1024: con medidas absolutas, la silueta desaparece en los tamaños pequeños.
// Medido sobre la lámina de la marca, que es de donde salen las proporciones.

/** Lado del rectángulo redondeado que hace de lámina. */
const PLATE_RADIUS = 0.185

/**
 * La cabeza: el ojo de la «R» y el morro de la raposa a la vez.
 *
 * Va desplazada a la derecha del palo: si la elipse cubriera el palo entero, la
 * silueta sería una mancha y la «R» desaparecería. La «R» se lee porque el palo
 * queda fuera, a la izquierda.
 */
const HEAD = { cx: 0.545, cy: 0.45, rx: 0.19, ry: 0.22 } as const

/** Las orejas, con la derecha como espejo de la izquierda. */
const EAR_LEFT: readonly Point[] = [
  [0.2, 0.37],
  [0.238, 0.172],
  [0.408, 0.3],
]

/** El hueco coral de la oreja: sólo existe cuando el tamaño lo aguanta. */
const EAR_LEFT_IN: readonly Point[] = [
  [0.262, 0.342],
  [0.25, 0.236],
  [0.366, 0.306],
]

/** El palo de la «R», que es también el cuello de la raposa. */
const STEM = { x0: 0.27, x1: 0.405, y0: 0.285, y1: 0.795, r: 0.03 } as const

/** La pierna de la «R», que sale del cuenco hacia la esquina. */
const LEG: readonly Point[] = [
  [0.6, 0.515],
  [0.7, 0.555],
  [0.83, 0.79],
  [0.705, 0.79],
]

/** El triángulo de reproducción, en el contador de la «R». */
const PLAY: readonly Point[] = [
  [0.47, 0.345],
  [0.47, 0.555],
  [0.655, 0.45],
]

/**
 * La órbita coral. Inclinada, con grosor que se afina al subir y dibujada
 * **detrás** del cuerpo: por delante cruzaba la cara y el contador, y a 64 px
 * el icono era una raposa con un cinturón.
 */
const ORBIT = { cx: 0.5, cy: 0.585, rx: 0.405, ry: 0.135, rot: -0.3 } as const

/** El destello de cuatro puntas. */
const SPARK = { cx: 0.818, cy: 0.222, rx: 0.066, ry: 0.076 } as const

/**
 * La marca reducida: la «R» desnuda, sin raposa, sin órbita y sin destello.
 *
 * A 16 px la silueta completa es una mancha de crema con un punto: se midió.
 * Lo que sobrevive es la letra, con el palo y la pierna a dos píxeles y el
 * contador abierto. Es la misma marca, contada con menos piezas.
 */
const MICRO = {
  stem: { x0: 0.245, x1: 0.375, y0: 0.205, y1: 0.795, r: 0.02 },
  bowl: { cx: 0.485, cy: 0.375, rx: 0.225, ry: 0.18 },
  hole: { cx: 0.485, cy: 0.375, rx: 0.1, ry: 0.09 },
  leg: [
    [0.455, 0.455],
    [0.575, 0.455],
    [0.775, 0.795],
    [0.635, 0.795],
  ] as readonly Point[],
} as const

/** Signo del producto vectorial: positivo a un lado de la recta, negativo al otro. */
function side(x: number, y: number, a: Point, b: Point): number {
  return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])
}

/** Interiores de un polígono convexo, sea cual sea el sentido de sus vértices. */
function insideConvexPolygon(x: number, y: number, points: readonly Point[]): boolean {
  const orientacion = signedArea(points) >= 0 ? 1 : -1

  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    if (a === undefined || b === undefined) continue
    if (side(x, y, a, b) * orientacion < 0) return false
  }

  return true
}

function distanceToSegment(x: number, y: number, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const largo = dx * dx + dy * dy
  const t = largo === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / largo))
  const px = a[0] + t * dx
  const py = a[1] + t * dy

  return Math.hypot(x - px, y - py)
}

function centroid(points: readonly Point[]): Point {
  let x = 0
  let y = 0

  for (const p of points) {
    x += p[0]
    y += p[1]
  }

  return [x / points.length, y / points.length]
}

/**
 * El área con signo: dice hacia dónde giran los vértices y, con eso, cuál es el
 * lado interior de cada arista.
 */
function signedArea(points: readonly Point[]): number {
  let suma = 0

  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    if (a === undefined || b === undefined) continue
    suma += a[0] * b[1] - b[0] * a[1]
  }

  return suma / 2
}

/** El punto donde se cruzan dos rectas dadas por su normal y su término. */
function intersect(
  a: { readonly nx: number; readonly ny: number; readonly c: number },
  b: { readonly nx: number; readonly ny: number; readonly c: number },
): Point {
  const det = a.nx * b.ny - a.ny * b.nx
  if (Math.abs(det) < 1e-9) return [0, 0]

  return [(a.c * b.ny - b.c * a.ny) / det, (a.nx * b.c - b.nx * a.c) / det]
}

/**
 * El polígono encogido: cada arista se desplaza `radius` hacia dentro y los
 * vértices nuevos son los cruces de las aristas desplazadas.
 *
 * Encoger escalando sobre el centro —lo que se hacía antes— funciona en un
 * cuadrado, pero una pierna larga y fina se acorta hasta desaparecer: el
 * inradio es su mitad de ancho, y escalar por eso mata también la longitud.
 */
function erode(points: readonly Point[], radius: number): readonly Point[] {
  const signo = signedArea(points) >= 0 ? 1 : -1
  const rectas = points.map((a, i) => {
    const b = points[(i + 1) % points.length] ?? a
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const largo = Math.hypot(dx, dy) || 1
    // La normal interior es la de la arista girada un cuarto de vuelta.
    const nx = (-dy / largo) * signo
    const ny = (dx / largo) * signo

    return { nx, ny, c: nx * a[0] + ny * a[1] + radius }
  })

  return rectas.map((recta, i) => {
    const previa = rectas[(i - 1 + rectas.length) % rectas.length] ?? recta

    return intersect(previa, recta)
  })
}

/** El radio máximo que admite el polígono sin que la erosión lo dé la vuelta. */
function inradius(points: readonly Point[]): number {
  const interior = erode(points, 0)
  const [cx, cy] = centroid(interior)
  let menor = Number.POSITIVE_INFINITY

  for (let i = 0; i < interior.length; i++) {
    const a = interior[i]
    const b = interior[(i + 1) % interior.length]
    if (a === undefined || b === undefined) continue
    menor = Math.min(menor, distanceToSegment(cx, cy, a, b))
  }

  return menor
}

/**
 * Un polígono con las esquinas redondeadas: su versión encogida, más un disco
 * del radio pedido alrededor (la suma de Minkowski).
 */
function insideRoundedPolygon(
  x: number,
  y: number,
  points: readonly Point[],
  radius: number,
): boolean {
  const r = Math.min(radius, inradius(points) * 0.9)
  const encogido = erode(points, r)

  if (insideConvexPolygon(x, y, encogido)) return true

  let menor = Number.POSITIVE_INFINITY

  for (let i = 0; i < encogido.length; i++) {
    const desde = encogido[i]
    const hasta = encogido[(i + 1) % encogido.length]
    if (desde === undefined || hasta === undefined) continue
    menor = Math.min(menor, distanceToSegment(x, y, desde, hasta))
  }

  return menor <= r
}

function insideEllipse(
  x: number,
  y: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): boolean {
  const dx = (x - cx) / rx
  const dy = (y - cy) / ry

  return dx * dx + dy * dy <= 1
}

/** Rectángulo redondeado: la distancia al rectángulo encogido, comparada con el radio. */
function insideRoundedRect(
  x: number,
  y: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
): boolean {
  const qx = Math.max(x0 + radius, Math.min(x1 - radius, x))
  const qy = Math.max(y0 + radius, Math.min(y1 - radius, y))
  const dx = x - qx
  const dy = y - qy

  return dx * dx + dy * dy <= radius * radius
}

/** Una superelipse: con exponente menor que uno, el rombo se vuelve destello. */
function insideSparkle(x: number, y: number): boolean {
  const dx = Math.abs((x - SPARK.cx) / SPARK.rx)
  const dy = Math.abs((y - SPARK.cy) / SPARK.ry)

  return dx ** 0.52 + dy ** 0.52 <= 1
}

/** El aro de la órbita, con grosor que depende del ángulo. */
function insideOrbit(x: number, y: number): boolean {
  const cos = Math.cos(ORBIT.rot)
  const sin = Math.sin(ORBIT.rot)
  const dx = x - ORBIT.cx
  const dy = y - ORBIT.cy
  const rx = dx * cos + dy * sin
  const ry = -dx * sin + dy * cos

  const theta = Math.atan2(ry / ORBIT.ry, rx / ORBIT.rx)
  const ex = ORBIT.rx * Math.cos(theta)
  const ey = ORBIT.ry * Math.sin(theta)
  const distancia = Math.hypot(rx - ex, ry - ey)

  // Grueso en la bajada izquierda y fino al coronar por la derecha: así la
  // órbita se lee como un trazo y no como un anillo de planetario.
  const t = (0.5 - 0.5 * Math.cos(theta)) ** 0.8
  const grosor = 0.012 + 0.04 * t

  return distancia <= grosor / 2
}

function mixColor(a: Rgba, b: Rgba, t: number): Rgba {
  const k = Math.max(0, Math.min(1, t))

  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
    Math.round(a[3] + (b[3] - a[3]) * k),
  ]
}

/** Lo que se puede permitir el dibujo a cada tamaño. */
interface Detail {
  readonly micro: boolean
  readonly glow: boolean
  readonly earInner: boolean
  readonly playPlate: boolean
  readonly orbit: boolean
  readonly sparkle: boolean
}

function detailFor(size: number): Detail {
  if (size >= 128) {
    return {
      micro: false,
      glow: true,
      earInner: true,
      playPlate: true,
      orbit: true,
      sparkle: true,
    }
  }

  if (size >= 48) {
    return {
      micro: false,
      glow: false,
      earInner: true,
      playPlate: true,
      orbit: true,
      sparkle: false,
    }
  }

  // En la bandeja y el favicon sólo queda la marca desnuda: la «R» gruesa.
  return {
    micro: true,
    glow: false,
    earInner: false,
    playPlate: false,
    orbit: false,
    sparkle: false,
  }
}

function isBody(x: number, y: number): boolean {
  if (insideEllipse(x, y, HEAD.cx, HEAD.cy, HEAD.rx, HEAD.ry)) return true

  if (insideRoundedPolygon(x, y, EAR_LEFT, 0.024)) return true
  if (insideRoundedPolygon(x, y, mirror(EAR_LEFT), 0.024)) return true

  if (insideRoundedRect(x, y, STEM.x0, STEM.y0, STEM.x1, STEM.y1, STEM.r)) return true

  return insideRoundedPolygon(x, y, LEG, 0.03)
}

function mirror(points: readonly Point[]): readonly Point[] {
  const eje = 0.475

  return points.map(([x, y]) => [eje * 2 - x, y] as Point)
}

/** El mismo polígono, agrandado o encogido sobre su centro. */
function scale(points: readonly Point[], factor: number): readonly Point[] {
  const [cx, cy] = centroid(points)

  return points.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor] as Point)
}

/** El triángulo de tinta que enmarca el play: un escalón de contorno, no un borde. */
const PLAY_PLATE = scale(PLAY, 1.22)

function isMicroBody(x: number, y: number): boolean {
  const { stem, bowl, hole, leg } = MICRO

  if (insideRoundedRect(x, y, stem.x0, stem.y0, stem.x1, stem.y1, stem.r)) return true
  if (
    insideEllipse(x, y, bowl.cx, bowl.cy, bowl.rx, bowl.ry) &&
    !insideEllipse(x, y, hole.cx, hole.cy, hole.rx, hole.ry)
  ) {
    return true
  }

  return insideRoundedPolygon(x, y, leg, 0.02)
}

function sample(x: number, y: number, detail: Detail): Rgba {
  if (!insideRoundedRect(x, y, 0, 0, 1, 1, PLATE_RADIUS)) return NADA

  if (detail.micro) return isMicroBody(x, y) ? CREAM : PLATE

  let color: Rgba = PLATE

  if (detail.glow) {
    const dx = (x - 0.42) / 0.34
    const dy = (y - 0.36) / 0.34
    const brillo = Math.exp(-(dx * dx + dy * dy) * 1.9)
    color = mixColor(PLATE, PLATE_LIFT, brillo)
  }

  // La órbita va antes del cuerpo: sólo se ve el arco que sale de la silueta,
  // como el anillo de un planeta. Por delante cruzaba la cara y el contador.
  if (detail.orbit && insideOrbit(x, y)) color = CORAL

  if (isBody(x, y)) color = CREAM

  if (detail.earInner) {
    if (insideRoundedPolygon(x, y, EAR_LEFT_IN, 0.012)) color = CORAL
    if (insideRoundedPolygon(x, y, mirror(EAR_LEFT_IN), 0.012)) color = CORAL
  }

  // Con sitio, el play lleva su contorno de tinta; sin él, es tinta directa
  // sobre crema, que es el par que sobrevive a 16 px.
  if (detail.playPlate && insideRoundedPolygon(x, y, PLAY_PLATE, 0.03)) color = INK
  if (insideRoundedPolygon(x, y, PLAY, 0.02)) {
    color = detail.playPlate ? CORAL : INK
  }

  if (detail.sparkle && insideSparkle(x, y)) color = CREAM

  return color
}

/**
 * Los píxeles RGBA de un lado, con supermuestreo.
 *
 * Se promedian las muestras de cada píxel en vez de decidir con su centro: sin
 * esto, el borde de la silueta sale escalonado y el icono parece roto en los
 * tamaños grandes. El muestreo baja con el tamaño porque un píxel de 1024 no
 * necesita las mismas muestras que uno de 16.
 */
export function render(size: number): Uint8Array {
  const rgba = new Uint8Array(size * size * 4)
  const detail = detailFor(size)
  const muestras = size <= 64 ? 4 : size <= 256 ? 3 : 2
  const total = muestras * muestras

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      for (let sy = 0; sy < muestras; sy++) {
        for (let sx = 0; sx < muestras; sx++) {
          const [cr, cg, cb, ca] = sample(
            (px + (sx + 0.5) / muestras) / size,
            (py + (sy + 0.5) / muestras) / size,
            detail,
          )
          r += cr
          g += cg
          b += cb
          a += ca
        }
      }

      const base = (py * size + px) * 4
      rgba[base] = Math.round(r / total)
      rgba[base + 1] = Math.round(g / total)
      rgba[base + 2] = Math.round(b / total)
      rgba[base + 3] = Math.round(a / total)
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

/**
 * Cuatro bytes en little-endian.
 *
 * Hace falta porque el `.ico` es el único de los tres formatos que va así: el PNG
 * y el ICNS escriben sus enteros al revés. Confundirlos no da un archivo
 * ilegible, da uno con los números del revés, que es peor: se abre y lo que dice
 * dentro es mentira.
 */
function le32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
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
        // En **little-endian**, como todo el `.ico`. Con big-endian —el orden
        // natural de un PNG o un ICNS, que es de donde vino la confusión— el
        // tamaño y la posición se leen al revés: el inyector de recursos de Bun
        // escribía un ejecutable de 2,66 GB. Salió de aquí.
        le32(datos.byteLength),
        le32(offset),
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
