import { describe, expect, test } from 'bun:test'
import { duracionDeLaBarra, posicionEnLaBarra } from './usePlayerBarra'

/**
 * La posición que pinta la barra, sin navegador.
 *
 * Es la mitad que no se ve en el marcado: mientras se arrastra manda el dedo y al
 * soltar manda el elemento. Si la regla se rompe, el pulgar vuelve a su sitio
 * entre dos `timeupdate` y la barra tiembla justo cuando se intenta soltarla.
 */
describe('la posición de la barra', () => {
  test('sin duración conocida la barra vale cero, no `NaN`', () => {
    expect(duracionDeLaBarra(0)).toBe(0)
    expect(duracionDeLaBarra(-3)).toBe(0)
    expect(duracionDeLaBarra(Number.NaN)).toBe(0)
    expect(duracionDeLaBarra(Number.POSITIVE_INFINITY)).toBe(0)
    expect(duracionDeLaBarra(1440)).toBe(1440)
  })

  test('sin arrastre se pinta la posición del elemento', () => {
    expect(posicionEnLaBarra(undefined, 31.5, 1440)).toBe(31.5)
  })

  test('mientras se arrastra manda el dedo', () => {
    // El elemento sigue avisando de su posición vieja: si ganara, el pulgar
    // volvería atrás en mitad del gesto.
    expect(posicionEnLaBarra(200, 31.5, 1440)).toBe(200)
  })

  test('la posición no se sale de la duración', () => {
    expect(posicionEnLaBarra(2000, 31.5, 1440)).toBe(1440)
    expect(posicionEnLaBarra(undefined, 2000, 1440)).toBe(1440)
  })
})
