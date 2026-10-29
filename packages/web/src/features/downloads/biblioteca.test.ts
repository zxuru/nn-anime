import { describe, expect, test } from 'bun:test'
import type { DownloadItem } from '@nn-anime/core/api'
import {
  agruparBiblioteca,
  calcularVelocidad,
  estaActiva,
  estimarRestante,
  formatearBytes,
  formatearEspera,
  porcentaje,
} from './biblioteca'

/**
 * Una fila de descarga con lo mínimo que mira la biblioteca.
 *
 * Los campos que no importan para la cuenta se rellenan con valores fijos: si
 * una prueba empieza a depender de ellos, es que la función está mirando más de
 * lo que dice su contrato.
 */
function descarga(cambios: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id: 1,
    providerId: 'fixture',
    animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
    episodeRef: { providerId: 'fixture', value: 'aurora-nocturna#1' },
    title: 'Aurora Nocturna',
    episodeLabel: 'Episodio 1',
    kind: 'file',
    status: 'complete',
    bytes: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...cambios,
  }
}

describe('la biblioteca agrupa por título', () => {
  test('una serie reúne sus episodios completos y suma lo que ocupan', () => {
    const series = agruparBiblioteca([
      descarga({ id: 2, bytes: 7, createdAt: '2026-01-02T00:00:00.000Z' }),
      descarga({ id: 1, bytes: 3, createdAt: '2026-01-01T00:00:00.000Z' }),
    ])

    expect(series).toHaveLength(1)
    expect(series[0]?.episodes.map((item) => item.id)).toEqual([1, 2])
    expect(series[0]?.bytes).toBe(10)
    expect(series[0]?.latest).toBe('2026-01-02T00:00:00.000Z')
  })

  test('lo que no está completo no entra en la estantería', () => {
    const series = agruparBiblioteca([
      descarga({ id: 1 }),
      descarga({ id: 2, status: 'downloading' }),
      descarga({ id: 3, status: 'failed' }),
      descarga({ id: 4, status: 'cancelled' }),
    ])

    expect(series).toHaveLength(1)
    expect(series[0]?.episodes.map((item) => item.id)).toEqual([1])
  })

  test('dos títulos distintos son dos series, ordenadas por la descarga más reciente', () => {
    const series = agruparBiblioteca([
      descarga({
        id: 1,
        animeRef: { providerId: 'fixture', value: 'vieja' },
        title: 'Vieja',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      descarga({
        id: 2,
        animeRef: { providerId: 'fixture', value: 'nueva' },
        title: 'Nueva',
        createdAt: '2026-01-03T00:00:00.000Z',
      }),
    ])

    expect(series.map((serie) => serie.title)).toEqual(['Nueva', 'Vieja'])
  })

  test('la identidad es la referencia, no el nombre: un título renombrado sigue siendo la misma serie', () => {
    const series = agruparBiblioteca([
      descarga({ id: 1, title: 'Aurora Nocturna' }),
      descarga({
        id: 2,
        title: 'Aurora Nocturna (segunda temporada)',
        createdAt: '2026-01-02T00:00:00.000Z',
      }),
    ])

    expect(series).toHaveLength(1)
    expect(series[0]?.episodes).toHaveLength(2)
  })
})

describe('el avance de una descarga', () => {
  test('sin total no hay porcentaje: la barra se queda sin cifra', () => {
    expect(porcentaje(descarga({ totalBytes: undefined }))).toBeUndefined()
    expect(porcentaje(descarga({ totalBytes: 0 }))).toBeUndefined()
  })

  test('con total, el porcentaje se redondea y no se sale de la barra', () => {
    expect(porcentaje(descarga({ bytes: 3, totalBytes: 10 }))).toBe(30)
    expect(porcentaje(descarga({ bytes: 11, totalBytes: 10 }))).toBe(100)
    expect(porcentaje(descarga({ bytes: -1, totalBytes: 10 }))).toBe(0)
  })

  test('la velocidad sale de dos lecturas; sin crecimiento no hay dato', () => {
    expect(calcularVelocidad(1_000, 500, 2)).toBe(250)
    expect(calcularVelocidad(1_000, undefined, 2)).toBeUndefined()
    expect(calcularVelocidad(1_000, 1_000, 2)).toBeUndefined()
    expect(calcularVelocidad(1_000, 500, 0)).toBeUndefined()
  })

  test('lo que falta se mide con el total y la velocidad', () => {
    expect(estimarRestante(1_000, 400, 100)).toBe(6)
    expect(estimarRestante(undefined, 400, 100)).toBeUndefined()
    expect(estimarRestante(1_000, 400, undefined)).toBeUndefined()
    expect(estimarRestante(1_000, 1_000, 100)).toBeUndefined()
  })
})

describe('los textos de la biblioteca', () => {
  test('un tamaño se queda en la unidad que le toca', () => {
    expect(formatearBytes(0)).toBe('0 B')
    expect(formatearBytes(512)).toBe('512 B')
    expect(formatearBytes(1_536)).toBe('1,5 KiB')
    expect(formatearBytes(2 * 1024 * 1024)).toBe('2,0 MiB')
  })

  test('una espera se dice en palabras', () => {
    expect(formatearEspera(40)).toBe('40 s')
    expect(formatearEspera(120)).toBe('2 min')
    expect(formatearEspera(130)).toBe('2 min 10 s')
    expect(formatearEspera(3_900)).toBe('1 h 5 min')
  })
})

describe('qué es una descarga activa', () => {
  test('la cola, la pausa y el fallo se ven en la zona de descargas', () => {
    for (const status of ['queued', 'downloading', 'paused', 'failed'] as const) {
      expect(estaActiva(descarga({ status }))).toBe(true)
    }
  })

  test('lo completo y lo cancelado no', () => {
    expect(estaActiva(descarga({ status: 'complete' }))).toBe(false)
    expect(estaActiva(descarga({ status: 'cancelled' }))).toBe(false)
  })
})
