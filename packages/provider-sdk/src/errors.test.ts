import { describe, expect, test } from 'bun:test'
import { ProviderError } from '@nn-anime/core'
import {
  apiVersionMismatch,
  classifyThrow,
  describeProblems,
  duplicateId,
  invalidShape,
  providerFailure,
} from './errors'

describe('classifyThrow', () => {
  test('un timeout y una cancelación se distinguen por el nombre', () => {
    expect(classifyThrow(new DOMException('se agotó', 'TimeoutError'))).toBe('timeout')
    expect(classifyThrow(new DOMException('cancelado', 'AbortError'))).toBe('aborted')
  })

  test('un error cualquiera es «lanzó»', () => {
    expect(classifyThrow(new Error('boom'))).toBe('threw')
    expect(classifyThrow('texto')).toBe('threw')
    expect(classifyThrow(undefined)).toBe('threw')
    expect(classifyThrow({ name: 'TimeoutError' })).toBe('threw')
  })

  test('un error con otro nombre no se confunde con una cancelación', () => {
    const other = new Error('otro')
    other.name = 'TypeError'

    expect(classifyThrow(other)).toBe('threw')
  })
})

describe('providerFailure', () => {
  test('nombra el proveedor, el método y la causa', () => {
    const error = providerFailure({
      providerId: 'fixture',
      method: 'search',
      kind: 'threw',
      cause: new Error('el sitio cambió'),
    })

    expect(error).toBeInstanceOf(ProviderError)
    expect(error.code).toBe('provider')
    expect(error.message).toContain("'fixture'")
    expect(error.message).toContain('search')
    expect(error.message).toContain('el sitio cambió')
    expect(error.scope).toBe('fixture')
    expect(error.op).toBe('search')
    expect(error.context.kind).toBe('threw')
  })

  test('sin método habla del contrato, no de una llamada', () => {
    const error = providerFailure({ providerId: 'fixture', kind: 'api-version' })

    expect(error.message).toContain('no cumple el contrato')
    expect(error.message).not.toContain('falló en')
    expect(error.op).toBeUndefined()
  })

  test('un detalle propio sustituye al texto por defecto', () => {
    const error = providerFailure({
      providerId: 'fixture',
      method: 'resolveStream',
      kind: 'invalid-shape',
      detail: 'headers.Referer: no admite caracteres de control',
    })

    expect(error.message).toContain('headers.Referer')
    expect(error.message).not.toContain('la respuesta no cumple el contrato')
  })

  test('la causa se conserva para quien la necesite', () => {
    const cause = new Error('raíz')
    const error = providerFailure({ providerId: 'f', method: 'search', kind: 'threw', cause })

    expect(error.cause).toBe(cause)
  })
})

describe('errores con nombre propio', () => {
  test('apiVersionMismatch nombra la esperada y la encontrada', () => {
    const error = apiVersionMismatch('fixture', '2')

    expect(error.message).toContain("'2'")
    expect(error.message).toContain("'1'")
    expect(error.context.kind).toBe('api-version')
  })

  test('duplicateId dice cuál gana', () => {
    const error = duplicateId('fuente')

    expect(error.message).toContain('fuente')
    expect(error.message).toContain('gana el primero')
    expect(error.context.kind).toBe('duplicate-id')
  })

  test('invalidShape compone el motivo nombrando el campo', () => {
    const error = invalidShape('fixture', [
      { path: ['capabilities', 'trending'], message: 'se esperaba boolean' },
      { path: ['getEpisodes'], message: 'no es una función' },
    ])

    expect(error.message).toContain('capabilities.trending: se esperaba boolean')
    expect(error.message).toContain('getEpisodes: no es una función')
    expect(error.context.kind).toBe('invalid-shape')
  })

  test('sin problemas, el mensaje sigue siendo un motivo', () => {
    const error = invalidShape('fixture', [])

    expect(error.message).toContain('la respuesta no cumple el contrato')
  })
})

describe('describeProblems', () => {
  test('una línea por problema, con la ruta delante', () => {
    expect(
      describeProblems([
        { path: [0, 'title'], message: 'obligatorio' },
        { path: ['headers', 'X Malo'], message: 'nombre inválido' },
      ]),
    ).toBe('0.title: obligatorio; headers.X Malo: nombre inválido')
  })

  test('un problema sin ruta no queda sin mensaje', () => {
    expect(describeProblems([{ path: [], message: 'forma inválida' }])).toBe('forma inválida')
  })
})
