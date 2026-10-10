import { describe, expect, test } from 'bun:test'
import { AppError, ProviderError, StoreError, UpstreamError } from './errors'

describe('AppError', () => {
  test('expone código, mensaje, causa y contexto', () => {
    const cause = new Error('la conexión se cortó')
    const error = new AppError({
      code: 'internal',
      message: 'algo falló',
      cause,
      context: { intento: 2 },
    })

    expect(error.code).toBe('internal')
    expect(error.message).toBe('algo falló')
    expect(error.cause).toBe(cause)
    expect(error.context).toEqual({ intento: 2 })
  })

  test('es un Error de verdad, con nombre propio y pila', () => {
    const error = new AppError({ code: 'internal', message: 'algo falló' })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('AppError')
    expect(error.stack).toBeString()
  })

  test('el contexto por defecto es un objeto vacío, nunca undefined', () => {
    const error = new AppError({ code: 'internal', message: 'algo falló' })

    expect(error.context).toEqual({})
  })
})

describe('ProviderError.from', () => {
  test('clasifica el fallo como provider y guarda alcance y operación', () => {
    const cause = new Error('tiempo agotado')
    const error = ProviderError.from('fuente-ejemplo', 'search', cause)

    expect(error.code).toBe('provider')
    expect(error.scope).toBe('fuente-ejemplo')
    expect(error.op).toBe('search')
    expect(error.cause).toBe(cause)
  })

  test('el mensaje nombra el alcance y la operación para poder buscar en los logs', () => {
    const error = ProviderError.from('fuente-ejemplo', 'search', new Error('tiempo agotado'))

    expect(error.message).toContain('fuente-ejemplo.search')
    expect(error.message).toContain('tiempo agotado')
  })

  test('acepta una causa que no es Error', () => {
    const error = ProviderError.from('fuente-ejemplo', 'search', 'texto suelto')

    expect(error.message).toContain('texto suelto')
  })

  test('acepta una causa undefined sin romper el mensaje', () => {
    const error = ProviderError.from('fuente-ejemplo', 'search', undefined)

    expect(error.message).toBeString()
    expect(error.message).toContain('fuente-ejemplo.search')
  })

  test('es instancia de AppError y de Error', () => {
    const error = ProviderError.from('fuente-ejemplo', 'search', undefined)

    expect(error).toBeInstanceOf(ProviderError)
    expect(error).toBeInstanceOf(AppError)
    expect(error).toBeInstanceOf(Error)
  })
})

describe('StoreError y UpstreamError', () => {
  test('StoreError se clasifica como store', () => {
    const error = StoreError.from('catalog-store', 'readAnime', undefined)

    expect(error.code).toBe('store')
    expect(error).toBeInstanceOf(AppError)
  })

  test('UpstreamError se clasifica como upstream', () => {
    const error = UpstreamError.from('media-proxy', 'fetch', undefined)

    expect(error.code).toBe('upstream')
    expect(error).toBeInstanceOf(AppError)
  })

  test('cada subtipo tiene su propio nombre para distinguirlos en los logs', () => {
    expect(ProviderError.from('a', 'b', undefined).name).toBe('ProviderError')
    expect(StoreError.from('a', 'b', undefined).name).toBe('StoreError')
    expect(UpstreamError.from('a', 'b', undefined).name).toBe('UpstreamError')
  })
})
