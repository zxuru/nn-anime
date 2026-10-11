import { describe, expect, test } from 'bun:test'
import {
  canvasSize,
  frameHasImage,
  MAX_CANVAS_WIDTH,
  type PainterDeps,
  probeDecision,
  startCompatPainter,
} from './compat-paint'

/**
 * Un programador de fotogramas de mentira, con los callbacks en la mano.
 *
 * Lo que se prueba aquí es **cuándo** se pinta y **cuándo** se vuelve a
 * programar, no que el navegador sepa pintar: eso es del e2e y del equipo del
 * usuario. Con esto, cada paso del bucle se puede provocar a voluntad.
 */
function programadorFalso() {
  const pendientes = new Map<number, () => void>()
  let siguiente = 1

  return {
    pedidos: 0,
    cancelados: [] as number[],

    requestFrame(callback: () => void): number {
      const id = siguiente
      siguiente += 1
      pendientes.set(id, callback)
      this.pedidos += 1

      return id
    },

    cancelFrame(handle: number): void {
      this.cancelados.push(handle)
      pendientes.delete(handle)
    },

    /** Ejecuta el último callback programado, como haría el navegador. */
    correr(): void {
      const entradas = [...pendientes.entries()]
      const ultima = entradas[entradas.length - 1]
      if (ultima === undefined) return

      pendientes.delete(ultima[0])
      ultima[1]()
    },
  }
}

/** Unas dependencias del pintor con un fotograma de tamaño fijo. */
function pintorFalso(ancho = 1280, alto = 720) {
  const programador = programadorFalso()
  const tamanos: { readonly width: number; readonly height: number }[] = []
  let pintados = 0

  const deps: PainterDeps = {
    videoWidth: () => ancho,
    videoHeight: () => alto,
    resize: (width, height) => tamanos.push({ width, height }),
    paint: () => {
      pintados += 1
    },
    requestFrame: (callback) => programador.requestFrame(callback),
    cancelFrame: (handle) => programador.cancelFrame(handle),
  }

  return {
    deps,
    programador,
    tamanos,
    get pintados() {
      return pintados
    },
    cambiarTamano(nuevoAncho: number, nuevoAlto: number) {
      ancho = nuevoAncho
      alto = nuevoAlto
    },
  }
}

describe('la lectura de un fotograma', () => {
  test('un cuadro negro con alfa opaco no es imagen', () => {
    // El alfa no cuenta: si contara, este píxel —negro y opaco— pasaría por
    // imagen y el modo compatible no se encendería nunca.
    expect(frameHasImage([0, 0, 0, 255])).toBe(false)
    expect(frameHasImage([0, 0, 0, 255, 0, 0, 0, 255])).toBe(false)
  })

  test('un canal por encima del umbral es imagen', () => {
    expect(frameHasImage([0, 0, 9, 255])).toBe(true)
    expect(frameHasImage([0, 0, 0, 255, 0, 0, 0, 255, 0, 40, 0, 255])).toBe(true)
  })

  test('el umbral está en ocho y es el mismo que usa la sonda', () => {
    expect(frameHasImage([0, 0, 8, 255])).toBe(true)
    expect(frameHasImage([0, 0, 7, 255])).toBe(false)
  })

  test('una lectura sin píxeles no es imagen', () => {
    expect(frameHasImage([])).toBe(false)
  })
})

describe('la decisión de pintar por CPU', () => {
  test('se enciende sólo si la GPU no trajo imagen y la CPU sí', () => {
    expect(probeDecision({ gpu: false, cpu: true })).toBe(true)
  })

  test('con imagen por GPU no hay nada que arreglar', () => {
    expect(probeDecision({ gpu: true, cpu: true })).toBe(false)
    expect(probeDecision({ gpu: true, cpu: false })).toBe(false)
  })

  test('si no hay imagen por ningún camino no es este el fallo', () => {
    // Ese caso es el otro: el decodificador no entrega fotogramas, y el
    // reproductor ya lo cuenta con «el audio suena y la imagen no llega».
    expect(probeDecision({ gpu: false, cpu: false })).toBe(false)
  })
})

describe('el tamaño del lienzo', () => {
  test('por debajo del tope se queda como está', () => {
    expect(canvasSize(1280, 720)).toEqual({ width: 1280, height: 720 })
    expect(canvasSize(MAX_CANVAS_WIDTH, 1080)).toEqual({ width: 1920, height: 1080 })
  })

  test('por encima del tope recorta el ancho y conserva la relación', () => {
    expect(canvasSize(3840, 2160)).toEqual({ width: 1920, height: 1080 })
    expect(canvasSize(2560, 1440)).toEqual({ width: 1920, height: 1080 })
  })

  test('el tope se puede bajar', () => {
    expect(canvasSize(1280, 720, 640)).toEqual({ width: 640, height: 360 })
  })
})

describe('el bucle que pinta', () => {
  test('pinta el fotograma y vuelve a programarse', () => {
    const pintor = pintorFalso()
    startCompatPainter(pintor.deps)

    expect(pintor.pintados).toBe(0)
    expect(pintor.programador.pedidos).toBe(1)

    pintor.programador.correr()
    expect(pintor.pintados).toBe(1)
    expect(pintor.tamanos).toEqual([{ width: 1280, height: 720 }])
    expect(pintor.programador.pedidos).toBe(2)

    pintor.programador.correr()
    expect(pintor.pintados).toBe(2)
  })

  test('sin tamaño de fotograma no pinta, pero sigue esperando', () => {
    // Un `<video>` de sólo audio mide cero. Pintar entonces es pintar nada.
    const pintor = pintorFalso(0, 0)
    startCompatPainter(pintor.deps)

    pintor.programador.correr()

    expect(pintor.pintados).toBe(0)
    expect(pintor.tamanos).toEqual([])
    expect(pintor.programador.pedidos).toBe(2)
  })

  test('redimensiona sólo cuando el tamaño cambia', () => {
    const pintor = pintorFalso()
    startCompatPainter(pintor.deps)

    pintor.programador.correr()
    pintor.programador.correr()
    expect(pintor.tamanos).toHaveLength(1)

    pintor.cambiarTamano(1920, 1080)
    pintor.programador.correr()
    expect(pintor.tamanos).toHaveLength(2)
    expect(pintor.tamanos[1]).toEqual({ width: 1920, height: 1080 })
  })

  test('pararlo cancela el siguiente fotograma y no pinta más', () => {
    const pintor = pintorFalso()
    const parar = startCompatPainter(pintor.deps)

    pintor.programador.correr()
    expect(pintor.pintados).toBe(1)

    const ultimo = pintor.programador.pedidos
    parar()

    expect(pintor.programador.cancelados).toEqual([ultimo])

    // Y un callback que llegue tarde —el navegador ya lo tenía— no pinta nada.
    pintor.programador.correr()
    expect(pintor.pintados).toBe(1)
  })
})
