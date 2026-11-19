/**
 * La única partición que queda: el formato.
 *
 * T372 retiró la familia de contenido. Estas pruebas fijan dos cosas que no
 * pueden volver a mezclarse: el formato se deduce con una precedencia explícita y
 * el filtro no descarta nada cuando no se pide formato.
 */

import { describe, expect, test } from 'bun:test'
import { type Clasificable, formatOf, type MediaFilter, pasaElFiltro } from './media'
import type { MediaFormat } from './models'

interface CasoFormato {
  readonly nombre: string
  readonly item: Clasificable
  readonly esperado: MediaFormat
}

const CASOS_FORMATO: readonly CasoFormato[] = [
  {
    nombre: 'lo declarado gana sobre `mediaType` y `kind`',
    item: { format: 'movie', mediaType: 'series', kind: 'tv' },
    esperado: 'movie',
  },
  {
    nombre: '`mediaType: movie` es una película',
    item: { mediaType: 'movie', kind: 'tv' },
    esperado: 'movie',
  },
  {
    nombre: '`mediaType: series` es una serie aunque el `kind` diga película',
    item: { mediaType: 'series', kind: 'movie' },
    esperado: 'series',
  },
  {
    nombre: '`mediaType: anime` es una serie sin dato de formato',
    item: { mediaType: 'anime', kind: 'movie' },
    esperado: 'series',
  },
  {
    nombre: 'el manga no tiene formato de vídeo: se lee como serie',
    item: { mediaType: 'manga' },
    esperado: 'series',
  },
  {
    nombre: '`kind: movie` es una película',
    item: { kind: 'movie' },
    esperado: 'movie',
  },
  {
    nombre: 'un OVA es una serie',
    item: { kind: 'ova' },
    esperado: 'series',
  },
  {
    nombre: 'un especial es una serie',
    item: { kind: 'special' },
    esperado: 'series',
  },
  {
    nombre: 'sin nada, una serie: un título sin formato no es una película',
    item: {},
    esperado: 'series',
  },
]

describe('formatOf: cómo está contada la obra', () => {
  for (const caso of CASOS_FORMATO) {
    test(caso.nombre, () => {
      expect(formatOf(caso.item)).toBe(caso.esperado)
    })
  }
})

describe('pasaElFiltro: el formato pedido', () => {
  test('sin formato pedido entran los dos', () => {
    const sinFormato: MediaFilter = {}

    expect(pasaElFiltro(sinFormato, { format: 'movie' })).toBe(true)
    expect(pasaElFiltro(sinFormato, { format: 'series' })).toBe(true)
  })

  test('con formato pedido, decide el formato del título', () => {
    expect(pasaElFiltro({ format: 'movie' }, { format: 'movie' })).toBe(true)
    expect(pasaElFiltro({ format: 'movie' }, { format: 'series' })).toBe(false)
    expect(pasaElFiltro({ format: 'series' }, { kind: 'movie' })).toBe(false)
    expect(pasaElFiltro({ format: 'series' }, { kind: 'tv' })).toBe(true)
  })

  test('el formato declarado por la fuente gana sobre el `kind`', () => {
    // Una película de anime declarada como serie no puede caer en Películas por
    // su `kind`: lo que la fuente dice del formato manda.
    expect(pasaElFiltro({ format: 'series' }, { format: 'series', kind: 'movie' })).toBe(true)
    expect(pasaElFiltro({ format: 'movie' }, { format: 'series', kind: 'movie' })).toBe(false)
  })

  test('el manga se descarta siempre, con o sin formato pedido', () => {
    expect(pasaElFiltro({}, { mediaType: 'manga' })).toBe(false)
    expect(pasaElFiltro({ format: 'series' }, { mediaType: 'manga' })).toBe(false)
  })
})
