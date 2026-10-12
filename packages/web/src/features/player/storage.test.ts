import { describe, expect, test } from 'bun:test'
import {
  type Almacen,
  almacenLocal,
  CLAVE_AUTOPLAY,
  claveDeProgreso,
  guardarAutoplay,
  guardarProgreso,
  leerAutoplay,
  leerProgreso,
  olvidarProgreso,
  reanudarEn,
} from './storage'

/**
 * Un almacén de mentira, con la memoria en un `Map`.
 *
 * Se pasa a las funciones en vez de tocar `localStorage`: lo que se prueba aquí
 * es qué se guarda, qué se lee y **qué pasa cuando el almacén falla**, y eso
 * último no se puede provocar desde un navegador de verdad.
 */
function almacenFalso(inicial: Record<string, string> = {}): Almacen & {
  readonly datos: Map<string, string>
} {
  const datos = new Map(Object.entries(inicial))

  return {
    datos,
    getItem: (clave) => datos.get(clave) ?? null,
    setItem: (clave, valor) => void datos.set(clave, valor),
    removeItem: (clave) => void datos.delete(clave),
  }
}

/** Un almacén que lanza en todo, como el de un navegador con el sitio bloqueado. */
const almacenRoto: Almacen = {
  getItem: () => {
    throw new Error('sin acceso')
  },
  setItem: () => {
    throw new Error('sin acceso')
  },
  removeItem: () => {
    throw new Error('sin acceso')
  },
}

describe('el progreso de un episodio', () => {
  test('la clave lleva el prefijo de la aplicación y las dos referencias', () => {
    expect(claveDeProgreso('fixture', 'aurora-nocturna#3')).toBe(
      'nn-anime:progreso:fixture:aurora-nocturna#3',
    )
    expect(CLAVE_AUTOPLAY.startsWith('nn-anime:')).toBe(true)
  })

  test('se guarda y se lee lo mismo', () => {
    const almacen = almacenFalso()
    const clave = claveDeProgreso('fixture', 'aurora-nocturna#3')

    guardarProgreso(almacen, clave, { positionS: 42, durationS: 600 })

    expect(leerProgreso(almacen, clave)).toEqual({ positionS: 42, durationS: 600 })
  })

  test('un progreso que no es el que se escribió no se interpreta', () => {
    const clave = claveDeProgreso('fixture', 'aurora-nocturna#3')

    for (const crudo of [
      'no es json',
      '{}',
      '{"positionS":"42","durationS":600}',
      'null',
      '[1,2]',
    ]) {
      expect(leerProgreso(almacenFalso({ [clave]: crudo }), clave)).toBeUndefined()
    }
  })

  test('sin almacén no pasa nada: ni se guarda, ni se lee, ni se rompe', () => {
    expect(() => guardarProgreso(undefined, 'x', { positionS: 1, durationS: 2 })).not.toThrow()
    expect(leerProgreso(undefined, 'x')).toBeUndefined()
    expect(() => olvidarProgreso(undefined, 'x')).not.toThrow()

    expect(() => guardarProgreso(almacenRoto, 'x', { positionS: 1, durationS: 2 })).not.toThrow()
    expect(leerProgreso(almacenRoto, 'x')).toBeUndefined()
    expect(() => olvidarProgreso(almacenRoto, 'x')).not.toThrow()
  })

  test('olvidarlo lo borra', () => {
    const almacen = almacenFalso()
    const clave = claveDeProgreso('fixture', 'aurora-nocturna#3')

    guardarProgreso(almacen, clave, { positionS: 42, durationS: 600 })
    olvidarProgreso(almacen, clave)

    expect(leerProgreso(almacen, clave)).toBeUndefined()
  })
})

describe('cuándo se reanuda', () => {
  /**
   * Los dos límites son la mitad de la función.
   *
   * Por debajo de diez segundos, quien abrió el episodio no lo estaba viendo. Por
   * encima del noventa y cinco por ciento, lo que hay es un episodio terminado y
   * lo que toca es el siguiente. Reanudar en cualquiera de los dos casos es
   * empezar por donde no es.
   */
  test('en medio, sí', () => {
    expect(reanudarEn({ positionS: 42, durationS: 600 })).toBe(42)
    expect(reanudarEn({ positionS: 560, durationS: 600 })).toBe(560)
  })

  test('por debajo de diez segundos, no', () => {
    expect(reanudarEn({ positionS: 10, durationS: 600 })).toBeUndefined()
    expect(reanudarEn({ positionS: 3, durationS: 600 })).toBeUndefined()
  })

  test('por encima del noventa y cinco por ciento, tampoco', () => {
    expect(reanudarEn({ positionS: 570.1, durationS: 600 })).toBeUndefined()
    expect(reanudarEn({ positionS: 600, durationS: 600 })).toBeUndefined()
  })

  test('sin duración no hay proporción que valga', () => {
    expect(reanudarEn({ positionS: 42, durationS: 0 })).toBeUndefined()
    expect(reanudarEn(undefined)).toBeUndefined()
  })
})

describe('la reproducción automática', () => {
  test('por defecto, sí: lo que no se eligió nunca es lo que trae la aplicación', () => {
    expect(leerAutoplay(almacenFalso())).toBe(true)
    expect(leerAutoplay(undefined)).toBe(true)
    expect(leerAutoplay(almacenRoto)).toBe(true)
  })

  test('lo que se apaga se recuerda, y se vuelve a encender', () => {
    const almacen = almacenFalso()

    guardarAutoplay(almacen, false)
    expect(leerAutoplay(almacen)).toBe(false)

    guardarAutoplay(almacen, true)
    expect(leerAutoplay(almacen)).toBe(true)
  })

  test('un valor que no es el que se escribió se lee como encendido', () => {
    expect(leerAutoplay(almacenFalso({ [CLAVE_AUTOPLAY]: 'quizá' }))).toBe(true)
  })
})

describe('el almacén del navegador', () => {
  test('sin `localStorage` —el servidor— devuelve nada en vez de lanzar', () => {
    // En el runner de pruebas no hay `window`: lo que se mide es que la función
    // no lance y devuelva algo que se pueda usar o nada.
    const almacen = almacenLocal()

    expect(almacen === undefined || typeof almacen.getItem === 'function').toBe(true)
  })
})
