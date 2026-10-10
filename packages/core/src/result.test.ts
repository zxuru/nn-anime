import { describe, expect, test } from 'bun:test'
import { err, map, mapErr, ok, type Result, unwrapOr } from './result'

describe('ok y err', () => {
  test('ok marca el resultado como exitoso y guarda el valor', () => {
    const result = ok(42)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(42)
  })

  test('err marca el resultado como fallido y guarda el error', () => {
    const result = err(new Error('boom'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toBe('boom')
  })
})

describe('map', () => {
  test('transforma el valor de un resultado exitoso', () => {
    const result = map(ok(2), (value) => value * 3)

    expect(result).toEqual({ ok: true, value: 6 })
  })

  test('deja intacto el error sin invocar la función', () => {
    let invoked = false
    const failure = err('roto')

    const result = map(failure, (value: number) => {
      invoked = true
      return value
    })

    expect(result).toEqual({ ok: false, error: 'roto' })
    expect(invoked).toBe(false)
  })
})

describe('mapErr', () => {
  test('transforma el error de un resultado fallido', () => {
    const result = mapErr(err('roto'), (error) => error.toUpperCase())

    expect(result).toEqual({ ok: false, error: 'ROTO' })
  })

  test('deja intacto el valor sin invocar la función', () => {
    let invoked = false

    const result = mapErr(ok(2), (error: string) => {
      invoked = true
      return error
    })

    expect(result).toEqual({ ok: true, value: 2 })
    expect(invoked).toBe(false)
  })
})

describe('unwrapOr', () => {
  test('devuelve el valor cuando el resultado es exitoso', () => {
    expect(unwrapOr(ok(7), 0)).toBe(7)
  })

  test('devuelve el valor por defecto cuando el resultado es fallido', () => {
    expect(unwrapOr(err('roto'), 0)).toBe(0)
  })

  test('respeta un valor exitoso aunque sea undefined y no cae al sustituto', () => {
    const result: Result<string | undefined, string> = ok(undefined)

    expect(unwrapOr(result, 'alternativa')).toBeUndefined()
  })
})
