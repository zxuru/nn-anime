import { describe, expect, test } from 'bun:test'
import { relatedResponseSchema, watchedResponseSchema } from './api'

const fila = {
  number: 3,
  mode: 'sub',
  positionS: 600,
  durationS: 1440,
  ratio: 0.4166,
  finished: false,
  watchedAt: '2026-10-12T10:00:00.000Z',
}

describe('watchedResponseSchema', () => {
  test('acepta una fila completa', () => {
    const parsed = watchedResponseSchema.safeParse({ episodes: [fila] })

    expect(parsed.success).toBe(true)
  })

  test('rechaza una proporción fuera de [0, 1]', () => {
    // Sin el tope, un `durationS` mal calculado pintaría una barra que se sale
    // de su carril sin que nadie se entere hasta verla.
    expect(watchedResponseSchema.safeParse({ episodes: [{ ...fila, ratio: 1.2 }] }).success).toBe(
      false,
    )
    expect(watchedResponseSchema.safeParse({ episodes: [{ ...fila, ratio: -0.1 }] }).success).toBe(
      false,
    )
  })

  test('rechaza un modo que no existe', () => {
    expect(
      watchedResponseSchema.safeParse({ episodes: [{ ...fila, mode: 'latino' }] }).success,
    ).toBe(false)
  })
})

describe('relatedResponseSchema', () => {
  test('una lista vacía es válida: «no hay hermanos» no es un error', () => {
    expect(relatedResponseSchema.safeParse({ items: [] }).success).toBe(true)
  })

  test('rechaza una clave de más: el contrato es estricto', () => {
    expect(
      relatedResponseSchema.safeParse({
        items: [{ ref: { providerId: 'fixture', value: 'x' }, title: 'X', score: 1 }],
      }).success,
    ).toBe(false)
  })
})
