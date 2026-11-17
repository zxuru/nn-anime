import { describe, expect, test } from 'bun:test'
import { cacheHeader } from './cache-header'

describe('el X-Cache de una fila con varias fuentes', () => {
  test('sin fuentes consultadas no hay encabezado', () => {
    expect(cacheHeader([])).toBeUndefined()
  })

  test('todo de caché fresca es un hit', () => {
    expect(cacheHeader(['hit', 'hit'])).toBe('hit')
  })

  test('una fuente caducada baja el conjunto a stale', () => {
    expect(cacheHeader(['hit', 'stale'])).toBe('stale')
    expect(cacheHeader(['stale', 'stale'])).toBe('stale')
  })

  test('una fuente que salió a la red manda: miss', () => {
    // El orden no importa: el peor origen es el que describe la respuesta.
    expect(cacheHeader(['miss', 'hit'])).toBe('miss')
    expect(cacheHeader(['stale', 'miss', 'hit'])).toBe('miss')
  })
})
