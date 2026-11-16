import { describe, expect, test } from 'bun:test'
import { duenoDelEscape, type EscenaDeEscape } from './player-teclas'

/** Una escena en la que no hay nada abierto, para declarar sólo lo que importa. */
const CERRADO: EscenaDeEscape = {
  menu: false,
  dialogo: false,
  tutorial: false,
  pantallaCompleta: false,
  extendido: false,
}

describe('el escape del reproductor', () => {
  /**
   * Un gesto, una cosa.
   *
   * Es el caso que el e2e mide con el navegador —`Escape` con el menú abierto y
   * el modo extendido puesto— y el que se rompe si el orden de esta función
   * cambia: el menú se cerraría y el modo se apagaría a la vez.
   */
  test('con el menú abierto y el modo puesto, el escape es del menú', () => {
    expect(duenoDelEscape({ ...CERRADO, menu: true, extendido: true })).toBe('menu')
  })

  test('con el modo extendido y nada más, el escape lo quita', () => {
    expect(duenoDelEscape({ ...CERRADO, extendido: true })).toBe('extendido')
  })

  test('el diálogo de la ayuda y el tutorial gastan su propio escape', () => {
    expect(duenoDelEscape({ ...CERRADO, extendido: true, dialogo: true })).toBe('nadie')
    expect(duenoDelEscape({ ...CERRADO, extendido: true, tutorial: true })).toBe('nadie')
  })

  test('el navegador abandona la pantalla completa antes que el modo', () => {
    expect(duenoDelEscape({ ...CERRADO, extendido: true, pantallaCompleta: true })).toBe('nadie')
  })

  test('sin nada abierto, el escape no es de nadie', () => {
    expect(duenoDelEscape(CERRADO)).toBe('nadie')
  })
})
