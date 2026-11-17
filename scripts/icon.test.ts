import { describe, expect, test } from 'bun:test'
import { encodeIcns, encodeIco, encodePng, leerSvg, render } from './icon'

/**
 * Lo que estas pruebas defienden.
 *
 * El icono tiene dos decisiones que **no fallan cuando se rompen**: si la marca
 * micro deja de ser micro, la bandeja del sistema enseña una mancha y nadie ve
 * un error; y si el `.ico` vuelve a escribir sus números en big-endian, Bun
 * genera un ejecutable de 2,66 GB que Windows rechaza. Por eso se mide el
 * dibujo y se leen los bytes del contenedor, no la intención del código.
 */

interface Conteo {
  readonly coral: number
  readonly crema: number
  readonly opacos: number
  readonly transparentes: number
}

function contar(rgba: Uint8Array): Conteo {
  let coral = 0
  let crema = 0
  let opacos = 0
  let transparentes = 0

  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i] ?? 0
    const g = rgba[i + 1] ?? 0
    const b = rgba[i + 2] ?? 0
    const a = rgba[i + 3] ?? 0

    if (a === 255) opacos++
    if (a === 0) transparentes++
    if (a > 200 && r > 200 && g < 140 && b < 120) coral++
    if (a > 200 && r > 220 && g > 220 && b > 200) crema++
  }

  return { coral, crema, opacos, transparentes }
}

describe('el detalle del icono se adapta al tamaño', () => {
  test('la marca completa lleva coral y crema', () => {
    const { coral, crema } = contar(render(128))

    expect(coral, 'la órbita y el play son de coral').toBeGreaterThan(100)
    expect(crema, 'la silueta es de crema').toBeGreaterThan(1000)
  })

  test('la marca micro no lleva coral: es la «R» desnuda', () => {
    const { coral, crema } = contar(render(32))

    expect(coral, 'a 32 px no caben la órbita ni el play coral').toBe(0)
    expect(crema, 'la «R» sigue ahí').toBeGreaterThan(100)
  })

  test('las esquinas de la lámina son transparentes y el centro es opaco', () => {
    const lado = 32
    const rgba = render(lado)
    const alfa = (x: number, y: number): number => rgba[(y * lado + x) * 4 + 3] ?? 0

    expect(alfa(0, 0), 'la esquina se recorta').toBe(0)
    expect(alfa(lado / 2, lado / 2), 'el centro pinta').toBe(255)
  })

  test('el lector del SVG falla con lo que no sabe dibujar', () => {
    // El contrato es no dibujar otra cosa en silencio: si el maestro estrena una
    // etiqueta, el generador se para con su nombre.
    expect(() => leerSvg('<svg><text>RoNa</text></svg>')).toThrow(/no soportado/)
  })
})

describe('los contenedores del icono', () => {
  test('el PNG declara el lado que se le pide', () => {
    const png = encodePng(render(16), 16)
    const vista = new DataView(png.buffer, png.byteOffset, png.byteLength)

    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(vista.getUint32(16)).toBe(16) // ancho
    expect(vista.getUint32(20)).toBe(16) // alto
  })

  test('el ICO escribe el tamaño y la posición en little-endian', () => {
    const lado = 16
    const icono = encodeIco([{ size: lado, rgba: render(lado), png: new Uint8Array(0) }])
    const vista = new DataView(icono.buffer, icono.byteOffset, icono.byteLength)

    const cuerpo = 40 + lado * lado * 4 + Math.ceil(lado / 32) * 4 * lado

    expect(vista.getUint16(2, true), 'tipo: icono').toBe(1)
    expect(vista.getUint16(4, true), 'una entrada').toBe(1)
    expect(vista.getUint32(14, true), 'tamaño de la entrada').toBe(cuerpo)
    // La cabecera del directorio son 6 bytes más 16 por entrada.
    expect(vista.getUint32(18, true), 'dónde empieza la entrada').toBe(6 + 16)
    expect(vista.getUint32(22, true), 'cabecera DIB').toBe(40)
  })

  test('el ICNS empieza por su firma y lleva el PNG del tamaño', () => {
    const icns = encodeIcns([{ size: 128, rgba: render(128), png: encodePng(render(128), 128) }])
    const texto = new TextDecoder()

    expect(texto.decode(icns.subarray(0, 4))).toBe('icns')
    expect(texto.decode(icns.subarray(8, 12)), 'ic07 es el tipo de 128').toBe('ic07')
  })
})
