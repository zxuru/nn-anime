import { describe, expect, test } from 'bun:test'
import { assertConforms, inspectConformance } from './conformance'
import type { Provider } from './types'

const REF = { providerId: 'fixture', value: 'titulo-1' }

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'fixture',
    name: 'Fixture',
    apiVersion: '1',
    capabilities: { search: true, sub: true, dub: false, trending: false },
    search: async () => [],
    getAnime: async () => ({ ref: REF, title: 'Un título', genres: [], studios: [] }),
    getEpisodes: async () => [],
    resolveStream: async () => [],
    ...overrides,
  }
}

/** Un objeto crudo, para poder escribir formas que no son un `Provider`. */
function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'fixture',
    name: 'Fixture',
    apiVersion: '1',
    capabilities: { search: true, sub: true, dub: false, trending: false },
    search: async () => [],
    getAnime: async () => ({ ref: REF, title: 'Un título', genres: [], studios: [] }),
    getEpisodes: async () => [],
    resolveStream: async () => [],
    ...overrides,
  }
}

describe('assertConforms', () => {
  test('acepta un proveedor conforme', () => {
    const result = assertConforms(provider())

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.id).toBe('fixture')
  })

  test('un método que falta se reporta nombrando el método', () => {
    const withoutEpisodes = raw()
    delete withoutEpisodes.getEpisodes

    const result = assertConforms(withoutEpisodes)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('getEpisodes')
      expect(result.error.context.kind).toBe('invalid-shape')
    }
  })

  test('un método que no es función se reporta nombrando el método', () => {
    const result = assertConforms(raw({ resolveStream: 'pronto' }))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('resolveStream')
  })

  test('varios métodos que faltan se reportan todos, no sólo el primero', () => {
    const result = assertConforms({ id: 'fixture', name: 'Fixture', apiVersion: '1' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      for (const method of ['search', 'getAnime', 'getEpisodes', 'resolveStream']) {
        expect(result.error.message, method).toContain(method)
      }
    }
  })

  test('una versión distinta se reporta con la esperada', () => {
    const result = assertConforms(raw({ apiVersion: '2' }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain("'1'")
      expect(result.error.context.kind).toBe('api-version')
    }
  })

  test('declarar trending sin implementarlo se reporta: es una promesa rota', () => {
    const result = assertConforms(
      raw({ capabilities: { search: true, sub: true, dub: false, trending: true } }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('getTrending')
  })

  test('declarar trending e implementarlo es conforme', () => {
    const result = assertConforms(
      raw({
        capabilities: { search: true, sub: true, dub: false, trending: true },
        getTrending: async () => [],
      }),
    )

    expect(result.ok).toBe(true)
  })

  test('cualquier cosa que no sea un objeto se rechaza sin lanzar', () => {
    for (const candidate of [undefined, null, 42, 'texto', [], () => 1]) {
      const result = assertConforms(candidate)
      expect(result.ok, JSON.stringify(candidate) ?? 'undefined').toBe(false)
    }
  })
})

describe('inspectConformance', () => {
  test('recorre los cinco métodos del contrato y marca cuáles son obligatorios', () => {
    const report = inspectConformance(provider())

    expect(report.methods.map((item) => item.method)).toEqual([
      'search',
      'getAnime',
      'getEpisodes',
      'resolveStream',
      'getTrending',
    ])
    expect(report.methods.filter((item) => item.required).map((item) => item.method)).toEqual([
      'search',
      'getAnime',
      'getEpisodes',
      'resolveStream',
    ])
    expect(report.ok).toBe(true)
    expect(report.problems).toEqual([])
  })

  test('un opcional que falta no es un problema', () => {
    const report = inspectConformance(provider())

    expect(report.methods.find((item) => item.method === 'getTrending')?.present).toBe(false)
    expect(report.ok).toBe(true)
  })

  test('lista qué métodos faltan sin validar el resto', () => {
    const report = inspectConformance({ id: 'a-medio-hacer', search: async () => [] })

    expect(report.providerId).toBe('a-medio-hacer')
    expect(report.ok).toBe(false)
    expect(report.problems).toHaveLength(3)
    for (const problem of report.problems) expect(problem).toContain('método')
  })

  test('no lanza con una entrada sin forma', () => {
    for (const candidate of [undefined, null, 42, 'texto']) {
      expect(inspectConformance(candidate).ok).toBe(false)
    }
  })
})
