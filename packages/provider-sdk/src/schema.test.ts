import { describe, expect, test } from 'bun:test'
import {
  providerCapabilitiesSchema,
  providerIdSchema,
  providerSchema,
  providerStreamSourceSchema,
  providerStreamSourcesSchema,
} from './schema'
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

/** Igual que el mensaje que compone el módulo: nombra el campo, no sólo el problema. */
function joined(
  issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[],
): string {
  return issues.map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`).join(' | ')
}

describe('forma del plugin', () => {
  test('acepta un proveedor completo', () => {
    expect(providerSchema.safeParse(provider()).success).toBe(true)
  })

  test('las claves propias del plugin sobreviven a la validación', () => {
    // Un plugin puede llevar su propio estado y usarlo desde sus métodos con
    // `this`. Un objeto estricto lo descartaría y el plugin fallaría al llamar.
    const cache = new Map([['x', 1]])
    const withState = { ...provider(), cache }
    const result = providerSchema.safeParse(withState)

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.cache).toBe(cache)
  })

  test('un método que no es función se rechaza nombrando el método', () => {
    const broken = { ...provider(), getEpisodes: 'pronto' }
    const result = providerSchema.safeParse(broken)

    expect(result.success).toBe(false)
    if (!result.success) expect(joined(result.error.issues)).toContain('getEpisodes')
  })

  test('un método del contrato que falta se rechaza nombrando el método', () => {
    const withoutResolve: Partial<Provider> = { ...provider() }
    delete withoutResolve.resolveStream
    const result = providerSchema.safeParse(withoutResolve)

    expect(result.success).toBe(false)
    if (!result.success) expect(joined(result.error.issues)).toContain('resolveStream')
  })

  test('getTrending es opcional', () => {
    expect(providerSchema.safeParse(provider()).success).toBe(true)
  })

  test('una versión del contrato distinta se rechaza en el schema', () => {
    const other = { ...provider(), apiVersion: '2' }

    expect(providerSchema.safeParse(other).success).toBe(false)
  })

  test('un id que no es kebab-case se rechaza con el ejemplo', () => {
    const result = providerIdSchema.safeParse('Mi Fuente')

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toContain('mi-fuente')
  })

  test('acepta los id en kebab-case del spec', () => {
    for (const id of ['fuente', 'mi-fuente', 'fuente-2']) {
      expect(providerIdSchema.safeParse(id).success, id).toBe(true)
    }
  })

  test('una capacidad que falta no se inventa por defecto', () => {
    const result = providerCapabilitiesSchema.safeParse({ search: true, sub: true, dub: false })

    expect(result.success).toBe(false)
    if (!result.success) expect(joined(result.error.issues)).toContain('trending')
  })
})

describe('headers del stream: el mensaje nombra al culpable', () => {
  test('acepta nombres válidos y valores sin caracteres de control', () => {
    const source = {
      url: 'https://ejemplo/a.mp4',
      kind: 'file',
      headers: { Referer: 'https://sitio.example', 'User-Agent': 'nn-anime' },
    }

    expect(providerStreamSourceSchema.safeParse(source).success).toBe(true)
  })

  test('un nombre inválido se rechaza nombrando el header', () => {
    const source = { url: 'https://ejemplo/a.mp4', kind: 'file', headers: { 'X Inyectada': 'sí' } }
    const result = providerStreamSourceSchema.safeParse(source)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('X Inyectada')
      expect(result.error.issues[0]?.path).toEqual(['headers', 'X Inyectada'])
    }
  })

  test('un salto de línea en el valor se rechaza nombrando el header', () => {
    const source = {
      url: 'https://ejemplo/a.mp4',
      kind: 'file',
      headers: { Referer: 'https://sitio.example\r\nX-Inyectada: sí' },
    }
    const result = providerStreamSourceSchema.safeParse(source)

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toContain('Referer')
  })

  test('un NUL en el valor también se rechaza nombrando el header', () => {
    const source = { url: 'https://ejemplo/a.mp4', kind: 'file', headers: { Cookie: 'a\0b' } }
    const result = providerStreamSourceSchema.safeParse(source)

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toContain('Cookie')
  })

  test('el mensaje apunta al header dentro de una lista de streams', () => {
    const result = providerStreamSourcesSchema.safeParse([
      { url: 'https://ejemplo/uno.mp4', kind: 'file' },
      { url: 'https://ejemplo/dos.mp4', kind: 'file', headers: { 'mal nombre': 'x' } },
    ])

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual([1, 'headers', 'mal nombre'])
    }
  })

  test('una URL con esquema peligroso se rechaza en la respuesta', () => {
    const source = { url: 'javascript:alert(1)', kind: 'file' }

    expect(providerStreamSourceSchema.safeParse(source).success).toBe(false)
  })
})
