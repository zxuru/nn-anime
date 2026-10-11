import { describe, expect, test } from 'bun:test'
import {
  episodeResponseSchema,
  episodesResponseSchema,
  relatedResponseSchema,
  watchedResponseSchema,
} from './api'

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

  test('acepta el episodio decimal: el visionado de un 12.5 también se guarda', () => {
    expect(watchedResponseSchema.safeParse({ episodes: [{ ...fila, number: 12.5 }] }).success).toBe(
      true,
    )
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

const EPISODIO = {
  ref: { providerId: 'fixture', value: 'aurora-nocturna/12.5' },
  animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
  number: 12.5,
  mode: 'sub',
}

describe('episodesResponseSchema: la página', () => {
  test('una respuesta sin página sigue valiendo, y la página por defecto es la primera', () => {
    // El servidor aprendió a paginar después que el cliente a leer `episodes`:
    // un campo requerido nuevo habría roto a quien ya lo leía.
    const parsed = episodesResponseSchema.safeParse({ episodes: [EPISODIO] })

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.page).toBe(1)
      expect(parsed.data.hasMore).toBe(false)
    }
  })

  test('acepta la página con su total y el episodio decimal', () => {
    const parsed = episodesResponseSchema.safeParse({
      episodes: [EPISODIO],
      page: 2,
      hasMore: true,
      total: 26,
    })

    expect(parsed.success).toBe(true)
  })

  test('rechaza la página 0: las páginas se numeran desde la uno', () => {
    expect(episodesResponseSchema.safeParse({ episodes: [], page: 0 }).success).toBe(false)
  })

  test('rechaza un hasMore que no es booleano', () => {
    expect(episodesResponseSchema.safeParse({ episodes: [], hasMore: 'sí' }).success).toBe(false)
  })
})

describe('episodeResponseSchema: el episodio suelto', () => {
  test('acepta el episodio que se pidió por número', () => {
    expect(episodeResponseSchema.safeParse({ episode: EPISODIO }).success).toBe(true)
  })

  test('rechaza un cuerpo sin episodio', () => {
    expect(episodeResponseSchema.safeParse({}).success).toBe(false)
  })
})
