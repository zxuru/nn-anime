#!/usr/bin/env bun
/**
 * El icono de la aplicación, generado desde código.
 *
 * **El maestro es `packaging/icons/icon.svg`**, el dibujo vectorial de la marca.
 * Este archivo lo rasteriza a los ocho PNG, al `.ico` de Windows y al `.icns` de
 * macOS, y escribe también el favicon y el icono táctil de la web, para que no
 * haya dos originales. Guardar sólo los binarios dejaría el repositorio con tres
 * formatos que nadie puede revisar ni rehacer; guardar sólo el SVG dejaría al
 * empaquetado sin icono, porque ni Windows ni macOS leen SVG para el ejecutable.
 *
 * La marca se llama **la R-raposa**: una «R» cuyo cuenco es la cabeza de una
 * raposa, con el triángulo de reproducción en el contador y una órbita coral que
 * la rodea. El dibujo padre usa degradados y un resplandor; aquí se rasteriza el
 * **subconjunto de SVG que el archivo necesita** —rect, circle, polygon, path con
 * `M L H V C Q S T Z`, `use` y `linearGradient`— y se ignoran los filtros: a
 * tamaño de icono, un desenfoque de 12 unidades es una mancha de color, no una
 * luz. Si el SVG estrena una etiqueta o un comando que este archivo no conoce,
 * **falla con su nombre** en vez de dibujar otra cosa en silencio.
 *
 * **Una sola marca, en todas las tallas.** La raposa del maestro se rasteriza
 * igual a 16 px que a 1024: el lanzador, la barra de tareas, la bandeja del
 * sistema y la pestaña del navegador enseñan el mismo dibujo. Antes había una
 * variante micro —la «R» desnuda— por debajo de 48 px, y el icono del ejecutable
 * no se parecía al de la cabecera; se retiró. Si una talla no se lee, se
 * simplifica la raposa —orejas, ojos y play—, no se cambia de marca.
 *
 * No hay dependencias de imagen: el PNG se codifica aquí. Bun trae `deflate`, y
 * el resto —CRC-32, el envoltorio zlib, el contenedor ICO y el ICNS— son formatos
 * cortos y documentados. La alternativa era una dependencia nueva en un
 * repositorio que no tiene ninguna de imagen, para dibujar una raposa.
 *
 * Uso: `bun run icon`
 */

import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ROOT } from './workspaces'

const ICONS = join(ROOT, 'packaging', 'icons')
const SVG = join(ICONS, 'icon.svg')
/**
 * La marca de la web.
 *
 * El favicon y el icono táctil se escriben aquí y no a mano: si fueran dos PNG
 * mantenidos aparte, podrían separarse del maestro y la pestaña del navegador
 * enseñaría una marca que el ejecutable no lleva.
 */
const WEB = join(ROOT, 'packages', 'web', 'public', 'brand')

type Rgb = readonly [number, number, number]
type Point = readonly [number, number]

// --- El SVG, reducido a lo que este archivo sabe dibujar ---------------------

interface Bbox {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

interface Stop {
  readonly offset: number
  readonly rgb: Rgb
}

interface Gradient {
  readonly id: string
  readonly stops: Stop[]
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

type Paint =
  | { readonly kind: 'solid'; readonly rgb: Rgb; readonly alpha: number }
  | { readonly kind: 'gradient'; readonly gradient: Gradient; readonly alpha: number }

interface Shape {
  readonly polylines: readonly (readonly Point[])[]
  readonly bbox: Bbox
  readonly paint: Paint
}

const SUPERMUESTREO = 4

function numero(texto: string | undefined, defecto = 0): number {
  if (texto === undefined) return defecto
  const valor = Number.parseFloat(texto)

  return Number.isFinite(valor) ? valor : defecto
}

function color(texto: string): Rgb {
  const limpio = texto.trim().replace('#', '')

  if (limpio.length === 3) {
    const [r, g, b] = limpio.split('')

    return [
      Number.parseInt(`${r}${r}`, 16),
      Number.parseInt(`${g}${g}`, 16),
      Number.parseInt(`${b}${b}`, 16),
    ]
  }

  return [
    Number.parseInt(limpio.slice(0, 2), 16),
    Number.parseInt(limpio.slice(2, 4), 16),
    Number.parseInt(limpio.slice(4, 6), 16),
  ]
}

function atributos(bloque: string): Record<string, string> {
  const salida: Record<string, string> = {}

  for (const coincidencia of bloque.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    const clave = coincidencia[1]
    if (clave !== undefined) salida[clave] = coincidencia[2] ?? ''
  }

  return salida
}

function bboxDe(puntos: readonly Point[]): Bbox {
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY

  for (const [x, y] of puntos) {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }

  return { x0, y0, x1, y1 }
}

/**
 * El `d` de un `path`, convertido en polilíneas.
 *
 * Las curvas se aplanan a segmentos fijos: 24 por cúbica y 16 por cuadrática. A
 * 1024 px, el error de la cuerda no llega al medio píxel, y un aplanado adaptativo
 * añadiría una cota que nadie va a ajustar.
 */
function aplanar(d: string): Point[][] {
  const fichas = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []
  const subcaminos: Point[][] = []
  let actual: Point[] = []
  let x = 0
  let y = 0
  let inicioX = 0
  let inicioY = 0
  let controlX = 0
  let controlY = 0
  let mando = ''
  let i = 0

  const siguiente = (): number => {
    const valor = Number(fichas[i] ?? '0')
    i++

    return valor
  }

  const trazar = (px: number, py: number): void => {
    actual.push([px, py])
  }

  const cerrar = (): void => {
    if (actual.length > 0) subcaminos.push(actual)
    actual = []
  }

  while (i < fichas.length) {
    const ficha = fichas[i] ?? ''
    if (/[A-Za-z]/.test(ficha)) {
      mando = ficha
      i++
    }

    const relativo = mando === mando.toLowerCase()
    const baseX = relativo ? x : 0
    const baseY = relativo ? y : 0

    switch (mando.toUpperCase()) {
      case 'M': {
        x = baseX + siguiente()
        y = baseY + siguiente()
        inicioX = x
        inicioY = y
        cerrar()
        trazar(x, y)
        // Los pares que siguen a un `M` son `L`, como manda el estándar.
        mando = relativo ? 'l' : 'L'
        break
      }
      case 'L': {
        x = baseX + siguiente()
        y = baseY + siguiente()
        trazar(x, y)
        break
      }
      case 'H': {
        x = baseX + siguiente()
        trazar(x, y)
        break
      }
      case 'V': {
        y = baseY + siguiente()
        trazar(x, y)
        break
      }
      case 'C': {
        const c1x = baseX + siguiente()
        const c1y = baseY + siguiente()
        const c2x = baseX + siguiente()
        const c2y = baseY + siguiente()
        const fx = baseX + siguiente()
        const fy = baseY + siguiente()
        const desdeX = x
        const desdeY = y

        for (let paso = 1; paso <= 24; paso++) {
          const t = paso / 24
          const u = 1 - t
          trazar(
            u * u * u * desdeX + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * fx,
            u * u * u * desdeY + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * fy,
          )
        }

        x = fx
        y = fy
        controlX = c2x
        controlY = c2y
        break
      }
      case 'S': {
        const c2x = baseX + siguiente()
        const c2y = baseY + siguiente()
        const fx = baseX + siguiente()
        const fy = baseY + siguiente()
        const c1x = x * 2 - controlX
        const c1y = y * 2 - controlY
        const desdeX = x
        const desdeY = y

        for (let paso = 1; paso <= 24; paso++) {
          const t = paso / 24
          const u = 1 - t
          trazar(
            u * u * u * desdeX + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * fx,
            u * u * u * desdeY + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * fy,
          )
        }

        x = fx
        y = fy
        controlX = c2x
        controlY = c2y
        break
      }
      case 'Q': {
        const qx = baseX + siguiente()
        const qy = baseY + siguiente()
        const fx = baseX + siguiente()
        const fy = baseY + siguiente()
        const desdeX = x
        const desdeY = y

        for (let paso = 1; paso <= 16; paso++) {
          const t = paso / 16
          const u = 1 - t
          trazar(
            u * u * desdeX + 2 * u * t * qx + t * t * fx,
            u * u * desdeY + 2 * u * t * qy + t * t * fy,
          )
        }

        x = fx
        y = fy
        controlX = qx
        controlY = qy
        break
      }
      case 'T': {
        const fx = baseX + siguiente()
        const fy = baseY + siguiente()
        const qx = x * 2 - controlX
        const qy = y * 2 - controlY
        const desdeX = x
        const desdeY = y

        for (let paso = 1; paso <= 16; paso++) {
          const t = paso / 16
          const u = 1 - t
          trazar(
            u * u * desdeX + 2 * u * t * qx + t * t * fx,
            u * u * desdeY + 2 * u * t * qy + t * t * fy,
          )
        }

        x = fx
        y = fy
        controlX = qx
        controlY = qy
        break
      }
      case 'Z': {
        if (actual.length > 0) {
          trazar(inicioX, inicioY)
          subcaminos.push(actual)
          actual = []
        }
        x = inicioX
        y = inicioY
        break
      }
      default:
        throw new Error(`scripts/icon.ts: comando de path no soportado «${mando}»`)
    }
  }

  if (actual.length > 0) subcaminos.push(actual)

  return subcaminos
}

function redondo(x: number, y: number, ancho: number, alto: number, radio: number): Point[] {
  const r = Math.min(radio, ancho / 2, alto / 2)
  const puntos: Point[] = []

  const esquina = (cx: number, cy: number, desde: number): void => {
    for (let paso = 0; paso <= 12; paso++) {
      const angulo = desde + (paso / 12) * (Math.PI / 2)
      puntos.push([cx + Math.cos(angulo) * r, cy + Math.sin(angulo) * r])
    }
  }

  esquina(x + ancho - r, y + r, -Math.PI / 2)
  esquina(x + ancho - r, y + alto - r, 0)
  esquina(x + r, y + alto - r, Math.PI / 2)
  esquina(x + r, y + r, Math.PI)

  return puntos
}

function circulo(cx: number, cy: number, r: number): Point[] {
  const puntos: Point[] = []

  for (let paso = 0; paso < 64; paso++) {
    const angulo = (paso / 64) * Math.PI * 2
    puntos.push([cx + Math.cos(angulo) * r, cy + Math.sin(angulo) * r])
  }

  return puntos
}

/** El área con signo: dice hacia dónde giran los vértices. */
function area(puntos: readonly Point[]): number {
  let suma = 0

  for (let i = 0; i < puntos.length; i++) {
    const a = puntos[i]
    const b = puntos[(i + 1) % puntos.length]
    if (a === undefined || b === undefined) continue
    suma += a[0] * b[1] - b[0] * a[1]
  }

  return suma / 2
}

/**
 * El contorno de un trazo de unión redonda, como polígono.
 *
 * Sólo se usa en los polígonos del play, que son convexos: para un contorno
 * general haría falta desplazar lados de un polígono cóncavo, y esas aristas ya
 * se ignoran porque el maestro las dibuja con 3–6 unidades, que no llegan a un
 * píxel en ningún tamaño.
 */
function contorno(puntos: readonly Point[], grosor: number): Point[] {
  if (grosor <= 0) return [...puntos]
  const signo = area(puntos) >= 0 ? 1 : -1
  const r = grosor / 2
  const lados = puntos.length
  const salida: Point[] = []

  for (let i = 0; i < lados; i++) {
    const a = puntos[i]
    const b = puntos[(i + 1) % lados]
    if (a === undefined || b === undefined) continue
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const largo = Math.hypot(dx, dy) || 1
    const nx = (dy / largo) * signo
    const ny = (-dx / largo) * signo

    salida.push([a[0] + nx * r, a[1] + ny * r])
    salida.push([b[0] + nx * r, b[1] + ny * r])
  }

  return salida
}

/**
 * Un polígono convexo, en cualquier sentido.
 *
 * El contorno de un trazo sólo se calcula sobre convexos: desplazar los lados de
 * un polígono cóncavo puede cruzarlos entre sí, y la estrella de la marca es
 * cóncava. Su trazo mide 4 unidades sobre 1254, así que ignorarlo no se ve.
 */
function esConvexo(puntos: readonly Point[]): boolean {
  let anterior = 0

  for (let i = 0; i < puntos.length; i++) {
    const a = puntos[i]
    const b = puntos[(i + 1) % puntos.length]
    const c = puntos[(i + 2) % puntos.length]
    if (a === undefined || b === undefined || c === undefined) continue
    const cruz = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])

    if (cruz === 0) continue
    if (anterior !== 0 && Math.sign(cruz) !== anterior) return false
    anterior = Math.sign(cruz)
  }

  return true
}

interface Documento {
  readonly formas: readonly Shape[]
}

export function leerSvg(texto: string): Documento {
  const gradientes = new Map<string, Gradient>()
  const caminos = new Map<string, string>()
  const pendientes: { tag: string; attrs: Record<string, string> }[] = []

  let dentroDefs = 0
  let gradiente: Gradient | null = null
  const cuerpo = texto.replace(/<!--[\s\S]*?-->/g, '')

  for (const etiqueta of cuerpo.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g)) {
    const cierre = etiqueta[1] === '/'
    const tag = etiqueta[2] ?? ''
    const attrs = atributos(etiqueta[3] ?? '')

    if (tag === 'defs') {
      dentroDefs += cierre ? -1 : 1
      continue
    }

    if (tag === 'linearGradient') {
      const id = attrs.id ?? ''
      gradiente = {
        id,
        stops: [],
        x1: numero(attrs.x1, 0),
        y1: numero(attrs.y1, 0),
        x2: numero(attrs.x2, 1),
        y2: numero(attrs.y2, 0),
      }
      gradientes.set(id, gradiente)
      continue
    }

    if (tag === 'stop') {
      if (gradiente !== null) {
        const offset = (attrs.offset ?? '0').replace('%', '')
        const proporcion = (attrs.offset ?? '').includes('%') ? 100 : 1
        gradiente.stops.push({
          offset: numero(offset) / proporcion,
          rgb: color(attrs['stop-color'] ?? '#000000'),
        })
      }
      continue
    }

    if (tag === 'svg' || tag === 'title' || tag === 'metadata') continue

    if (dentroDefs > 0) {
      if (tag === 'path' && attrs.id !== undefined) caminos.set(attrs.id, attrs.d ?? '')
      continue
    }

    if (
      tag === 'rect' ||
      tag === 'circle' ||
      tag === 'polygon' ||
      tag === 'path' ||
      tag === 'use'
    ) {
      pendientes.push({ tag, attrs })
      continue
    }

    throw new Error(`scripts/icon.ts: elemento SVG no soportado «${tag}»`)
  }

  const formas: Shape[] = []

  for (const { tag, attrs } of pendientes) {
    const relleno = attrs.fill ?? '#000000'
    if (relleno === 'none') continue

    const alfa = numero(attrs['fill-opacity'], 1)
    let paint: Paint

    if (relleno.startsWith('url(')) {
      const id = relleno.slice(4, -1).replace('#', '')
      const gradienteHallado = gradientes.get(id)
      if (gradienteHallado === undefined) {
        throw new Error(`scripts/icon.ts: gradiente «${id}» sin definir`)
      }
      paint = { kind: 'gradient', gradient: gradienteHallado, alpha: alfa }
    } else {
      paint = { kind: 'solid', rgb: color(relleno), alpha: alfa }
    }

    let polilineas: Point[][]

    if (tag === 'rect') {
      const x = numero(attrs.x)
      const y = numero(attrs.y)
      const ancho = numero(attrs.width)
      const alto = numero(attrs.height)
      const radio = numero(attrs.rx, 0)

      polilineas = [redondo(x, y, ancho, alto, radio)]
    } else if (tag === 'circle') {
      polilineas = [circulo(numero(attrs.cx), numero(attrs.cy), numero(attrs.r))]
    } else if (tag === 'polygon') {
      const numeros = (attrs.points ?? '').match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []
      const puntos: Point[] = []

      for (let i = 0; i + 1 < numeros.length; i += 2) {
        puntos.push([numero(numeros[i]), numero(numeros[i + 1])])
      }

      polilineas = [puntos]
    } else if (tag === 'path') {
      polilineas = aplanar(attrs.d ?? '')
    } else {
      const referencia = (attrs.href ?? attrs['xlink:href'] ?? '').replace('#', '')
      const d = caminos.get(referencia)
      if (d === undefined)
        throw new Error(`scripts/icon.ts: «use» apunta a «${referencia}», que no existe`)
      polilineas = aplanar(d)
    }

    const todos = polilineas.flat()
    if (todos.length < 3) continue

    // El trazo se convierte en contorno sólo en los polígonos convexos; en el
    // resto se ignora, y está dicho arriba el porqué.
    const grosor = numero(attrs['stroke-width'], 0)
    const contornoAplicado =
      grosor > 0 && polilineas.length === 1 && esConvexo(todos)
        ? [contorno(todos, grosor)]
        : polilineas
    const finales = contornoAplicado.flat()

    formas.push({
      polylines: contornoAplicado,
      bbox: bboxDe(finales),
      paint,
    })
  }

  if (formas.length === 0) throw new Error('scripts/icon.ts: el SVG no tiene formas que dibujar')

  return { formas }
}

const DOCUMENTO = leerSvg(readFileSync(SVG, 'utf8'))

// --- Rasterizado ------------------------------------------------------------

interface Arista {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  readonly direccion: number
}

function aristasDe(polilineas: readonly (readonly Point[])[], escala: number): Arista[] {
  const aristas: Arista[] = []

  for (const linea of polilineas) {
    for (let i = 0; i < linea.length; i++) {
      const a = linea[i]
      const b = linea[(i + 1) % linea.length]
      if (a === undefined || b === undefined) continue
      const x1 = a[0] * escala
      const y1 = a[1] * escala
      const x2 = b[0] * escala
      const y2 = b[1] * escala

      aristas.push({ x1, y1, x2, y2, direccion: y2 > y1 ? 1 : -1 })
    }
  }

  return aristas
}

function colorEn(paint: Paint, x: number, y: number, bbox: Bbox): Rgb {
  if (paint.kind === 'solid') return paint.rgb

  const { gradient } = paint
  const ancho = bbox.x1 - bbox.x0
  const alto = bbox.y1 - bbox.y0
  const px1 = bbox.x0 + gradient.x1 * ancho
  const py1 = bbox.y0 + gradient.y1 * alto
  const px2 = bbox.x0 + gradient.x2 * ancho
  const py2 = bbox.y0 + gradient.y2 * alto
  const dx = px2 - px1
  const dy = py2 - py1
  const largo = dx * dx + dy * dy

  const t = largo === 0 ? 0 : Math.max(0, Math.min(1, ((x - px1) * dx + (y - py1) * dy) / largo))
  const stops = gradient.stops
  const primero = stops[0]
  if (primero === undefined) return [0, 0, 0]

  let desde = primero
  let hasta = primero

  for (const stop of stops) {
    if (stop.offset <= t) desde = stop
    if (stop.offset >= t) {
      hasta = stop
      break
    }
  }

  const tramo = hasta.offset - desde.offset
  const k = tramo === 0 ? 0 : (t - desde.offset) / tramo

  return [
    Math.round(desde.rgb[0] + (hasta.rgb[0] - desde.rgb[0]) * k),
    Math.round(desde.rgb[1] + (hasta.rgb[1] - desde.rgb[1]) * k),
    Math.round(desde.rgb[2] + (hasta.rgb[2] - desde.rgb[2]) * k),
  ]
}

/**
 * Rellena una forma por barrido de líneas, con la regla de llenado `nonzero`.
 *
 * Se pinta sobre una rejilla sobremuestreada y se reduce al final: así los
 * bordes curvos y las diagonales no salen con dientes de sierra, y el coste cae
 * en el tamaño grande, que se genera una vez.
 */
function pintarForma(
  buffer: Uint8Array,
  lado: number,
  forma: Shape,
  escala: number,
  aristas: readonly Arista[],
): void {
  const x0 = Math.max(0, Math.floor(forma.bbox.x0 * escala) - 1)
  const y0 = Math.max(0, Math.floor(forma.bbox.y0 * escala) - 1)
  const x1 = Math.min(lado - 1, Math.ceil(forma.bbox.x1 * escala) + 1)
  const y1 = Math.min(lado - 1, Math.ceil(forma.bbox.y1 * escala) + 1)

  for (let py = y0; py <= y1; py++) {
    const sy = py + 0.5
    const cortes: { x: number; direccion: number }[] = []

    for (const arista of aristas) {
      const cruza = (arista.y1 <= sy && arista.y2 > sy) || (arista.y2 <= sy && arista.y1 > sy)
      if (!cruza) continue

      const t = (sy - arista.y1) / (arista.y2 - arista.y1)
      cortes.push({ x: arista.x1 + t * (arista.x2 - arista.x1), direccion: arista.direccion })
    }

    if (cortes.length < 2) continue
    cortes.sort((a, b) => a.x - b.x)

    let vuelta = 0

    for (let i = 0; i < cortes.length - 1; i++) {
      const corte = cortes[i]
      if (corte === undefined) continue
      vuelta += corte.direccion
      if (vuelta === 0) continue

      const desde = Math.max(x0, Math.ceil(corte.x - 0.5))
      const hasta = Math.min(x1, Math.floor((cortes[i + 1]?.x ?? corte.x) - 0.5))

      for (let px = desde; px <= hasta; px++) {
        const rgb = colorEn(forma.paint, (px + 0.5) / escala, (py + 0.5) / escala, forma.bbox)
        const alfa = forma.paint.alpha
        const base = (py * lado + px) * 4

        if (alfa >= 1) {
          buffer[base] = rgb[0]
          buffer[base + 1] = rgb[1]
          buffer[base + 2] = rgb[2]
          buffer[base + 3] = 255
        } else {
          const destino = (buffer[base + 3] ?? 0) / 255
          const salida = alfa + destino * (1 - alfa)
          buffer[base] = Math.round(
            (rgb[0] * alfa + (buffer[base] ?? 0) * destino * (1 - alfa)) / salida,
          )
          buffer[base + 1] = Math.round(
            (rgb[1] * alfa + (buffer[base + 1] ?? 0) * destino * (1 - alfa)) / salida,
          )
          buffer[base + 2] = Math.round(
            (rgb[2] * alfa + (buffer[base + 2] ?? 0) * destino * (1 - alfa)) / salida,
          )
          buffer[base + 3] = Math.round(salida * 255)
        }
      }
    }
  }
}

/** Reduce la rejilla sobremuestreada, ponderando por alfa para no oscurecer los bordes. */
function reducir(buffer: Uint8Array, lado: number, size: number, factor: number): Uint8Array {
  const salida = new Uint8Array(size * size * 4)
  const muestras = factor * factor

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const base = ((y * factor + sy) * lado + x * factor + sx) * 4
          const alfa = (buffer[base + 3] ?? 0) / 255
          a += alfa
          r += (buffer[base] ?? 0) * alfa
          g += (buffer[base + 1] ?? 0) * alfa
          b += (buffer[base + 2] ?? 0) * alfa
        }
      }

      const base = (y * size + x) * 4
      const alfa = a / muestras

      salida[base] = a === 0 ? 0 : Math.round(r / a)
      salida[base + 1] = a === 0 ? 0 : Math.round(g / a)
      salida[base + 2] = a === 0 ? 0 : Math.round(b / a)
      salida[base + 3] = Math.round(alfa * 255)
    }
  }

  return salida
}

function rasterizarSvg(size: number): Uint8Array {
  const factor = size <= 128 ? SUPERMUESTREO : 2
  const lado = size * factor
  const escala = lado / 1254
  const buffer = new Uint8Array(lado * lado * 4)

  for (const forma of DOCUMENTO.formas) {
    pintarForma(buffer, lado, forma, escala, aristasDe(forma.polylines, escala))
  }

  return reducir(buffer, lado, size, factor)
}

/**
 * Los píxeles RGBA de un lado.
 *
 * Todas las tallas salen del maestro. El corte que dibujaba la «R» desnuda por
 * debajo de 48 px se retiró: dos marcas en el mismo producto era el problema,
 * no la solución.
 */
export function render(size: number): Uint8Array {
  return rasterizarSvg(size)
}

// --- Los contenedores -------------------------------------------------------

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

/** El icono táctil de la web, que no está en `SIZES` porque no es de la app. */
const TACTIL = 180

async function main(): Promise<void> {
  await mkdir(ICONS, { recursive: true })
  await mkdir(WEB, { recursive: true })

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

  /*
   * La web bebe del mismo maestro. El favicon es el PNG de 32 de la lista —el
   * mismo que usa la bandeja— y el táctil se rasteriza aparte porque 180 no es
   * una talla de la aplicación. El SVG también se copia: así la cabecera y el
   * ejecutable no pueden quedarse con dos dibujos distintos.
   */
  const favicon = images.find((image) => image.size === 32)
  if (favicon !== undefined) await Bun.write(join(WEB, 'favicon-32.png'), favicon.png)
  await Bun.write(join(WEB, 'touch-180.png'), encodePng(render(TACTIL), TACTIL))
  await Bun.write(join(WEB, 'logo.svg'), readFileSync(SVG))

  process.stdout.write(`iconos escritos en ${ICONS}\n`)
  process.stdout.write(`  tamaños: ${SIZES.join(', ')}\n`)
  process.stdout.write(`marca de la web escrita en ${WEB}\n`)
}

if (import.meta.main) {
  await main()
}
