import { describe, expect, test } from 'bun:test'
import { CLAVE_EXTENDIDO, guardarExtendido, leerExtendido } from './extendido'
import type { Almacen } from './storage'

/**
 * Un almacén de mentira, con la memoria en un `Map`.
 *
 * Se pasa a las funciones en vez de tocar `localStorage`: lo que se prueba aquí
 * es qué se guarda, qué se lee y **qué pasa cuando el almacén falla**, que es lo
 * que no se puede provocar desde un navegador de verdad.
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

describe('la preferencia del modo extendido', () => {
  test('la clave lleva el prefijo de la aplicación', () => {
    expect(CLAVE_EXTENDIDO.startsWith('nn-anime:')).toBe(true)
  })

  test('sin nada guardado el reproductor abre en ventana normal', () => {
    expect(leerExtendido(almacenFalso())).toBe(false)
    expect(leerExtendido(undefined)).toBe(false)
  })

  test('se guarda y se lee lo mismo', () => {
    const almacen = almacenFalso()

    guardarExtendido(almacen, true)
    expect(almacen.datos.get(CLAVE_EXTENDIDO)).toBe('si')
    expect(leerExtendido(almacen)).toBe(true)

    guardarExtendido(almacen, false)
    expect(almacen.datos.get(CLAVE_EXTENDIDO)).toBe('no')
    expect(leerExtendido(almacen)).toBe(false)
  })

  /**
   * Lo que no escribió esta aplicación no enciende el modo.
   *
   * Es un valor del navegador, no un contrato: una versión vieja, una mano ajena
   * o basura no pueden dejar el reproductor arrancando a ventana completa. Sólo
   * el «si» que se escribe aquí vale.
   */
  test('un valor que no se escribió aquí no enciende el modo', () => {
    for (const crudo of ['true', '1', 'SI', 'yes', '{"si":true}', '']) {
      expect(leerExtendido(almacenFalso({ [CLAVE_EXTENDIDO]: crudo })), crudo).toBe(false)
    }
  })

  test('un almacén roto no rompe el reproductor', () => {
    expect(leerExtendido(almacenRoto)).toBe(false)
    expect(() => guardarExtendido(almacenRoto, true)).not.toThrow()
  })
})
