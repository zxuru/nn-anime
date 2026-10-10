import { describe, expect, test } from 'bun:test'
import { ApiError, apiGet, apiPatch, apiPost, type RequestDeps } from './client'

interface Call {
  readonly input: string
  readonly init: RequestInit
}

interface Fake {
  readonly calls: Call[]
  readonly deps: RequestDeps
}

function fake(status = 200, body = '{}', headers: Record<string, string> = {}): Fake {
  const calls: Call[] = []

  return {
    calls,
    deps: {
      fetch: (input, init) => {
        calls.push({ input, init })
        return Promise.resolve(new Response(body, { status, headers }))
      },
    },
  }
}

function failing(error: Error): RequestDeps {
  return {
    fetch: () => Promise.reject(error),
  }
}

describe('request: forma de la petición', () => {
  test('usa la ruta relativa tal cual', async () => {
    const target = fake()

    await apiGet('/api/health', {}, target.deps)

    expect(target.calls[0]?.input).toBe('/api/health')
  })

  test('manda las credenciales del mismo origen, que es lo que lleva la cookie', async () => {
    const target = fake()

    await apiGet('/api/health', {}, target.deps)

    expect(target.calls[0]?.init.credentials).toBe('same-origin')
  })

  test('no adjunta ninguna cabecera de autorización', async () => {
    const target = fake()

    await apiGet('/api/health', {}, target.deps)

    const headers = target.calls[0]?.init.headers as Record<string, string>
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain('authorization')
  })

  test('acepta JSON', async () => {
    const target = fake()

    await apiGet('/api/health', {}, target.deps)

    const headers = target.calls[0]?.init.headers as Record<string, string>
    expect(headers.accept).toBe('application/json')
  })

  test('no manda cuerpo ni tipo de contenido en una lectura', async () => {
    const target = fake()

    await apiGet('/api/health', {}, target.deps)

    expect(target.calls[0]?.init.body).toBeUndefined()
    const headers = target.calls[0]?.init.headers as Record<string, string>
    expect(headers['content-type']).toBeUndefined()
  })

  test('en una escritura manda JSON y el tipo de contenido', async () => {
    const target = fake()

    await apiPost('/api/watch', { positionS: 12 }, {}, target.deps)

    expect(target.calls[0]?.init.method).toBe('POST')
    expect(target.calls[0]?.init.body).toBe('{"positionS":12}')
    const headers = target.calls[0]?.init.headers as Record<string, string>
    expect(headers['content-type']).toBe('application/json')
  })

  test('apiPatch usa el método PATCH', async () => {
    const target = fake()

    await apiPatch('/api/watch/1', { positionS: 30 }, {}, target.deps)

    expect(target.calls[0]?.init.method).toBe('PATCH')
  })

  test('propaga la señal de cancelación que se le pasa', async () => {
    const target = fake()
    const controller = new AbortController()

    await apiGet('/api/search', { signal: controller.signal }, target.deps)

    expect(target.calls[0]?.init.signal).toBe(controller.signal)
  })

  test('sin señal explícita, pone un tiempo límite', async () => {
    const target = fake()

    await apiGet('/api/health', {}, target.deps)

    expect(target.calls[0]?.init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('request: respuestas', () => {
  test('devuelve el JSON ya analizado', async () => {
    const target = fake(200, '{"version":"0.1.0"}', { 'content-type': 'application/json' })

    expect(await apiGet<{ version: string }>('/api/health', {}, target.deps)).toEqual({
      version: '0.1.0',
    })
  })

  test('devuelve undefined en un 204', async () => {
    const target = fake(204)

    expect(await apiGet('/api/watch/1', {}, target.deps)).toBeUndefined()
  })

  test('lanza ApiError con el código en un 401', async () => {
    const target = fake(401)

    await expect(apiGet('/api/health', {}, target.deps)).rejects.toBeInstanceOf(ApiError)
  })

  test('el ApiError de un 401 se reconoce como sesión perdida', async () => {
    const target = fake(401)

    try {
      await apiGet('/api/health', {}, target.deps)
      throw new Error('debería haber lanzado')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      if (error instanceof ApiError) {
        expect(error.status).toBe(401)
        expect(error.isSessionLost).toBe(true)
      }
    }
  })

  test('un 500 también es un ApiError, y no una sesión perdida', async () => {
    const target = fake(500)

    try {
      await apiGet('/api/health', {}, target.deps)
      throw new Error('debería haber lanzado')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      if (error instanceof ApiError) expect(error.isSessionLost).toBe(false)
    }
  })

  test('el mensaje del error nombra método, ruta y código', async () => {
    const target = fake(403)

    try {
      await apiGet('/api/health', {}, target.deps)
      throw new Error('debería haber lanzado')
    } catch (error) {
      if (error instanceof ApiError) {
        expect(error.message).toContain('GET')
        expect(error.message).toContain('/api/health')
        expect(error.message).toContain('403')
      }
    }
  })

  test('un fallo de red se propaga tal cual, sin disfrazarse de ApiError', async () => {
    const boom = new Error('sin conexión')

    await expect(apiGet('/api/health', {}, failing(boom))).rejects.toBe(boom)
  })
})
