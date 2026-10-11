import { describe, expect, test } from 'bun:test'
import { createRegistry, readApiVersion, readProviderId, validateProvider } from './registry'
import type { Provider } from './types'

const REF = { providerId: 'fixture', value: 'titulo-1' }

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'fixture',
    name: 'Fixture',
    apiVersion: '1',
    capabilities: { search: true, sub: true, dub: false, trending: false, feed: false },
    search: async () => [],
    getAnime: async () => ({ ref: REF, title: 'Un título', genres: [], studios: [] }),
    getEpisodes: async () => [],
    resolveStream: async () => [],
    ...overrides,
  }
}

describe('validateProvider', () => {
  test('acepta un proveedor completo y conserva sus claves propias', () => {
    const cache = new Map([['x', 1]])
    const candidate = { ...provider(), cache }
    const result = validateProvider(candidate)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.id).toBe('fixture')
      // El contrato no declara `cache`, así que se lee sin fingir un tipo: lo
      // que se comprueba es que el plugin lo conserva, no que sea del contrato.
      expect(Reflect.get(result.value, 'cache')).toBe(cache)
    }
  })

  test('una versión distinta nombra la esperada y la encontrada', () => {
    const result = validateProvider(provider({ apiVersion: '2' as '1' }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain("'2'")
      expect(result.error.message).toContain("'1'")
      expect(result.error.context.kind).toBe('api-version')
    }
  })

  test('un campo que falta se rechaza nombrando el campo', () => {
    const result = validateProvider({ id: 'fixture', name: 'Fixture', apiVersion: '1' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('capabilities')
  })

  test('sin id, el mensaje no finge uno', () => {
    const result = validateProvider({ name: 'Fixture' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('(sin id)')
  })

  test('un valor que no es objeto se rechaza sin lanzar', () => {
    for (const candidate of [undefined, null, 42, 'texto', []]) {
      const result = validateProvider(candidate)
      expect(result.ok, JSON.stringify(candidate) ?? 'undefined').toBe(false)
    }
  })

  test('la versión se rechaza antes que la forma, porque explica más', () => {
    // Objeto sin nada más que la versión: si se validara la forma primero, el
    // error hablaría de `name` y no de la versión, que es la causa real.
    const result = validateProvider({ id: 'fixture', apiVersion: '2' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.context.kind).toBe('api-version')
  })
})

describe('lectura defensiva para los mensajes', () => {
  test('readProviderId lee el id cuando se puede', () => {
    expect(readProviderId({ id: 'fuente' })).toBe('fuente')
  })

  test('readProviderId no inventa un id', () => {
    for (const candidate of [undefined, null, {}, { id: '' }, { id: 7 }]) {
      expect(readProviderId(candidate)).toBe('(sin id)')
    }
  })

  test('readApiVersion distingue la ausente de la no textual', () => {
    expect(readApiVersion({ apiVersion: '1' })).toBe('1')
    expect(readApiVersion({ apiVersion: 1 })).toBeUndefined()
    expect(readApiVersion({})).toBeUndefined()
    expect(readApiVersion('texto')).toBeUndefined()
  })
})

describe('registro', () => {
  test('empieza vacío', () => {
    const registry = createRegistry()

    expect(registry.size()).toBe(0)
    expect(registry.list()).toEqual([])
    expect(registry.get('fixture')).toBeUndefined()
    expect(registry.has('fixture')).toBe(false)
  })

  test('da de alta y consulta por id', () => {
    const registry = createRegistry()
    const candidate = provider()

    const added = registry.add(candidate)

    expect(added.ok).toBe(true)
    expect(registry.size()).toBe(1)
    expect(registry.has('fixture')).toBe(true)
    expect(registry.get('fixture')?.id).toBe('fixture')
    expect(registry.get('fixture')?.name).toBe(candidate.name)
  })

  test('conserva el orden de alta', () => {
    const registry = createRegistry()
    registry.add(provider({ id: 'uno' }))
    registry.add(provider({ id: 'dos' }))

    expect(registry.list().map((item) => item.id)).toEqual(['uno', 'dos'])
  })

  test('un id duplicado se rechaza y gana el primero', () => {
    const registry = createRegistry()
    const first = provider({ id: 'fuente', name: 'Primero' })
    const second = provider({ id: 'fuente', name: 'Segundo' })

    registry.add(first)
    const conflict = registry.add(second)

    expect(conflict.ok).toBe(false)
    if (!conflict.ok) {
      expect(conflict.error.message).toContain('fuente')
      expect(conflict.error.context.kind).toBe('duplicate-id')
    }
    expect(registry.size()).toBe(1)
    expect(registry.get('fuente')?.name).toBe('Primero')
  })

  test('un plugin inválido no cambia el registro', () => {
    const registry = createRegistry()
    registry.add(provider({ id: 'bueno' }))

    const rejected = registry.add({ id: 'malo', apiVersion: '2' })

    expect(rejected.ok).toBe(false)
    expect(registry.size()).toBe(1)
    expect(registry.has('malo')).toBe(false)
  })

  test('acepta una lista inicial y aísla lo que falla dentro de ella', () => {
    const registry = createRegistry([
      provider({ id: 'uno' }),
      { id: 'roto' },
      provider({ id: 'dos' }),
    ])

    expect(registry.list().map((item) => item.id)).toEqual(['uno', 'dos'])
  })
})
