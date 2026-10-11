import { describe, expect, test } from 'bun:test'
import { FINISHED_RATIO, isFinished, watchedRatio } from './watch-progress'

describe('watchedRatio', () => {
  test('es la posición entre la duración', () => {
    expect(watchedRatio(720, 1440)).toBe(0.5)
  })

  test('sin duración no hay proporción', () => {
    expect(watchedRatio(720, 0)).toBe(0)
    expect(watchedRatio(720, Number.NaN)).toBe(0)
  })

  test('nunca sale de [0, 1]', () => {
    expect(watchedRatio(2000, 1440)).toBe(1)
    expect(watchedRatio(-5, 1440)).toBe(0)
  })
})

describe('isFinished', () => {
  test('el umbral incluye el 90 % exacto', () => {
    expect(isFinished(1296, 1440)).toBe(true)
    expect(isFinished(1440, 1440)).toBe(true)
  })

  test('por debajo del umbral no está terminado', () => {
    // Mutar `>=` por `>` o bajar el umbral a 0.89 deja esta prueba en rojo.
    expect(isFinished(1281, 1440)).toBe(false)
  })

  test('un episodio sin duración nunca está terminado', () => {
    expect(isFinished(1440, 0)).toBe(false)
  })

  test('el umbral es el que se declara', () => {
    expect(FINISHED_RATIO).toBe(0.9)
  })
})
