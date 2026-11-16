import { describe, expect, test } from 'bun:test'
import { gestoDelDobleClic } from './usePlayerGestos'

/**
 * El doble gesto sobre la imagen, por zonas.
 *
 * El borde izquierdo retrocede, el derecho adelanta y el centro pide pantalla
 * completa. La regla vive fuera del componente para poder medirla: en un teléfono
 * estos bordes son el único mando de ±10 s que queda, así que una zona que se
 * estrecha deja un salto que ya no se puede hacer.
 */
describe('el doble clic sobre el video', () => {
  test('el borde izquierdo retrocede y el derecho adelanta', () => {
    expect(gestoDelDobleClic(0)).toBe('atras')
    expect(gestoDelDobleClic(0.1)).toBe('atras')
    expect(gestoDelDobleClic(0.9)).toBe('adelante')
    expect(gestoDelDobleClic(1)).toBe('adelante')
  })

  test('el centro pide la pantalla completa', () => {
    expect(gestoDelDobleClic(0.5)).toBe('pantalla-completa')
  })

  test('las zonas de salto llegan justo hasta el treinta por ciento', () => {
    expect(gestoDelDobleClic(0.3)).toBe('atras')
    expect(gestoDelDobleClic(0.31)).toBe('pantalla-completa')
    expect(gestoDelDobleClic(0.7)).toBe('adelante')
    expect(gestoDelDobleClic(0.69)).toBe('pantalla-completa')
  })
})
