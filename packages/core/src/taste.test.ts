import { describe, expect, test } from 'bun:test'
import {
  emptyTasteProfile,
  LOCAL_TASTE_USER,
  normalizeGenreName,
  TASTE_SKIP_LIMIT_DEFAULT,
  tasteAutoOpenFromEnv,
  tasteProfileSchema,
  tasteSkipLimitFromEnv,
  tasteSurveyRequestSchema,
} from './taste'

describe('el perfil vacío', () => {
  test('nace sin empezar, sin señales y con su fecha', () => {
    const perfil = emptyTasteProfile('local', new Date('2026-11-18T10:00:00Z'))

    expect(perfil.userId).toBe(LOCAL_TASTE_USER)
    expect(perfil.genres).toEqual([])
    expect(perfil.excludedGenres).toEqual([])
    expect(perfil.titles).toEqual([])
    expect(perfil.format).toBeNull()
    expect(perfil.survey).toEqual({
      status: 'not_started',
      skips: 0,
      updatedAt: '2026-11-18T10:00:00.000Z',
    })
    expect(tasteProfileSchema.safeParse(perfil).success).toBe(true)
  })
})

describe('el nombre de un género', () => {
  test('se pliega sin tildes ni mayúsculas para comparar', () => {
    expect(normalizeGenreName('  ACCIÓN  ')).toBe('accion')
    expect(normalizeGenreName('Ciencia ficción')).toBe('ciencia ficcion')
    expect(normalizeGenreName('Acción')).toBe(normalizeGenreName('accion'))
  })
})

describe('el límite de omisiones del entorno', () => {
  test('sin variable vale el límite por defecto', () => {
    expect(tasteSkipLimitFromEnv({})).toBe(TASTE_SKIP_LIMIT_DEFAULT)
    // Una variable vacía es ausencia de configuración, no «cero omisiones».
    expect(tasteSkipLimitFromEnv({ RONA_TASTE_SKIP_LIMIT: '  ' })).toBe(TASTE_SKIP_LIMIT_DEFAULT)
  })

  test('un entero válido manda, incluido el cero', () => {
    expect(tasteSkipLimitFromEnv({ RONA_TASTE_SKIP_LIMIT: '0' })).toBe(0)
    expect(tasteSkipLimitFromEnv({ RONA_TASTE_SKIP_LIMIT: '5' })).toBe(5)
  })

  test('lo absurdo se acota y lo ilegible vuelve al defecto', () => {
    expect(tasteSkipLimitFromEnv({ RONA_TASTE_SKIP_LIMIT: '99' })).toBe(20)
    expect(tasteSkipLimitFromEnv({ RONA_TASTE_SKIP_LIMIT: '-2' })).toBe(TASTE_SKIP_LIMIT_DEFAULT)
    expect(tasteSkipLimitFromEnv({ RONA_TASTE_SKIP_LIMIT: 'muchas' })).toBe(
      TASTE_SKIP_LIMIT_DEFAULT,
    )
  })
})

describe('la abertura automática', () => {
  test('por defecto sí: es el equivalente local al alta', () => {
    expect(tasteAutoOpenFromEnv({})).toBe(true)
    expect(tasteAutoOpenFromEnv({ RONA_TASTE_AUTO_OPEN: '1' })).toBe(true)
  })

  test('se apaga con 0, false o no', () => {
    expect(tasteAutoOpenFromEnv({ RONA_TASTE_AUTO_OPEN: '0' })).toBe(false)
    expect(tasteAutoOpenFromEnv({ RONA_TASTE_AUTO_OPEN: 'false' })).toBe(false)
    expect(tasteAutoOpenFromEnv({ RONA_TASTE_AUTO_OPEN: ' NO ' })).toBe(false)
  })
})

describe('la petición de la encuesta', () => {
  test('los pasos opcionales pueden faltar y se normalizan', () => {
    const parsed = tasteSurveyRequestSchema.parse({ genres: ['Acción'] })

    expect(parsed.status).toBe('completed')
    expect(parsed.excludedGenres).toEqual([])
    expect(parsed.titles).toEqual([])
    expect(parsed.format).toBeNull()
    expect(parsed.tone).toBeNull()
  })

  test('un estado inventado no entra', () => {
    const parsed = tasteSurveyRequestSchema.safeParse({ status: 'a medias' })

    expect(parsed.success).toBe(false)
  })
})
