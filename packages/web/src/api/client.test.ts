import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  ApiError,
  ApiShapeError,
  apiGet,
  apiPatch,
  apiPost,
  type RequestDeps,
  request,
  send,
} from './client'

const HEALTH = z.strictObject({ version: z.string(), port: z.number() })

interface Call {
  readonly input: string
  readonly init: RequestInit
}

interface Fake {
  readonly calls: Call[]
  readonly deps: RequestDeps
}

function fake(status = 200, body = '{"version":"0.1.0","port":7717}'): Fake {
  const calls: Call[] = []

  return {
    calls,
    deps: {
      fetch: (input, init) => {
        calls.push({ input, init })
        return Promise.resolve(new Response(body, { status }))
      },
    },
  }
}

function failing(error: Error): RequestDeps {
  return { fetch: () => Promise.reject(error) }
}

function headersOf(call: Call | undefined): Record<string, string> {
  return (call?.init.headers ?? {}) as Record<string, string>
}

describe('forma de la petición', () => {
  test('usa la ruta relativa tal cual', async () => {
    const target = fake()

    await request('/api/health', HEALTH, {}, target.deps)

    expect(target.calls[0]?.input).toBe('/api/health')
  })

  test('manda las credenciales del mismo origen, que es lo que lleva la cookie', async () => {
    const target = fake()

    await request('/api/health', HEALTH, {}, target.deps)

    expect(target.calls[0]?.init.credentials).toBe('same-origin')
  })

  test('no adjunta ninguna cabecera de autorización', async () => {
    const target = fake()

    await request('/api/health', HEALTH, {}, target.deps)

    expect(Object.keys(headersOf(target.calls[0])).map((name) => name.toLowerCase())).not.toContain(
      'authorization',
    )
  })

  test('no manda cuerpo ni tipo de contenido en una lectura', async () => {
    const target = fake()

    await request('/api/health', HEALTH, {}, target.deps)

    expect(target.calls[0]?.init.body).toBeUndefined()
    expect(headersOf(target.calls[0])['content-type']).toBeUndefined()
  })

  test('en una escritura manda JSON y el tipo de contenido', async () => {
    const target = fake(204, '')

    await apiPost('/api/watch', { positionS: 12 }, {}, target.deps)

    expect(target.calls[0]?.init.method).toBe('POST')
    expect(target.calls[0]?.init.body).toBe('{"positionS":12}')
    expect(headersOf(target.calls[0])['content-type']).toBe('application/json')
  })

  test('apiPatch usa el método PATCH', async () => {
    const target = fake(204, '')

    await apiPatch('/api/watch/1', { positionS: 30 }, {}, target.deps)

    expect(target.calls[0]?.init.method).toBe('PATCH')
  })

  test('propaga la señal de cancelación que se le pasa', async () => {
    const target = fake()
    const controller = new AbortController()

    await apiGet('/api/health', HEALTH, { signal: controller.signal }, target.deps)

    expect(target.calls[0]?.init.signal).toBe(controller.signal)
  })

  test('el tiempo límite se puede subir para una respuesta lenta', async () => {
    const target = fake()

    await apiGet('/api/health', HEALTH, { timeoutMs: 60_000 }, target.deps)

    expect(target.calls[0]?.init.signal).toBeInstanceOf(AbortSignal)
  })

  test('con tiempo límite cero, no hay límite', async () => {
    const target = fake()

    await apiGet('/api/health', HEALTH, { timeoutMs: 0 }, target.deps)

    expect(target.calls[0]?.init.signal).toBeUndefined()
  })

  test('un tiempo límite negativo se rechaza con un mensaje propio', async () => {
    const target = fake()

    await expect(apiGet('/api/health', HEALTH, { timeoutMs: -1 }, target.deps)).rejects.toThrow(
      /timeoutMs/,
    )
  })

  test('un tiempo límite infinito también se rechaza', async () => {
    const target = fake()

    await expect(
      apiGet('/api/health', HEALTH, { timeoutMs: Number.POSITIVE_INFINITY }, target.deps),
    ).rejects.toThrow(/timeoutMs/)
  })

  test('una señal propia gana sobre el tiempo límite', async () => {
    const target = fake()
    const controller = new AbortController()

    await apiGet('/api/health', HEALTH, { signal: controller.signal, timeoutMs: 0 }, target.deps)

    expect(target.calls[0]?.init.signal).toBe(controller.signal)
  })

  test('sin señal explícita, pone un tiempo límite', async () => {
    const target = fake()

    await apiGet('/api/health', HEALTH, {}, target.deps)

    expect(target.calls[0]?.init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('deduplicación de lecturas', () => {
  test('dos lecturas simultáneas de lo mismo hacen una sola petición', async () => {
    let calls = 0
    const deps: RequestDeps = {
      fetch: async () => {
        calls += 1
        await Bun.sleep(5)
        return new Response('{"version":"0.1.0","port":7717}')
      },
    }

    const [first, second] = await Promise.all([
      apiGet('/api/health', HEALTH, {}, deps),
      apiGet('/api/health', HEALTH, {}, deps),
    ])

    expect(calls).toBe(1)
    expect(first).toEqual(second)
  })

  test('rutas distintas no se deduplican entre sí', async () => {
    let calls = 0
    const deps: RequestDeps = {
      fetch: async () => {
        calls += 1
        return new Response('{"version":"0.1.0","port":7717}')
      },
    }

    await Promise.all([
      apiGet('/api/health', HEALTH, {}, deps),
      apiGet('/api/health?x=1', HEALTH, {}, deps),
    ])

    expect(calls).toBe(2)
  })

  test('pasada la primera, la siguiente vuelve a pedir', async () => {
    const target = fake()

    await apiGet('/api/health', HEALTH, {}, target.deps)
    await apiGet('/api/health', HEALTH, {}, target.deps)

    expect(target.calls).toHaveLength(2)
  })

  test('las mutaciones no se deduplican nunca', async () => {
    const target = fake(204, '')

    await Promise.all([
      apiPost('/api/watch', { positionS: 1 }, {}, target.deps),
      apiPost('/api/watch', { positionS: 1 }, {}, target.deps),
    ])

    expect(target.calls).toHaveLength(2)
  })

  test('una lectura que falla se puede reintentar', async () => {
    let calls = 0
    const deps: RequestDeps = {
      fetch: async () => {
        calls += 1
        return new Response('', { status: calls === 1 ? 401 : 200 })
      },
    }

    await expect(apiGet('/api/health', HEALTH, {}, deps)).rejects.toBeInstanceOf(ApiError)
    await expect(apiGet('/api/health', HEALTH, {}, deps)).rejects.toBeInstanceOf(ApiShapeError)

    expect(calls).toBe(2)
  })
})

describe('validación de la respuesta', () => {
  test('devuelve el objeto ya validado', async () => {
    const target = fake()

    expect(await apiGet('/api/health', HEALTH, {}, target.deps)).toEqual({
      version: '0.1.0',
      port: 7717,
    })
  })

  test('un campo que falta es un ApiShapeError, no un undefined silencioso', async () => {
    const target = fake(200, '{"version":"0.1.0"}')

    await expect(apiGet('/api/health', HEALTH, {}, target.deps)).rejects.toBeInstanceOf(
      ApiShapeError,
    )
  })

  test('un campo con el tipo cambiado también falla en la frontera', async () => {
    const target = fake(200, '{"version":"0.1.0","port":"7717"}')

    await expect(apiGet('/api/health', HEALTH, {}, target.deps)).rejects.toBeInstanceOf(
      ApiShapeError,
    )
  })

  test('un campo de más se rechaza, porque los schemas son estrictos', async () => {
    const target = fake(200, '{"version":"0.1.0","port":7717,"sobra":true}')

    await expect(apiGet('/api/health', HEALTH, {}, target.deps)).rejects.toBeInstanceOf(
      ApiShapeError,
    )
  })

  test('el error nombra la ruta y el problema', async () => {
    const target = fake(200, '{"version":1,"port":7717}')

    try {
      await apiGet('/api/health', HEALTH, {}, target.deps)
      throw new Error('debería haber lanzado')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiShapeError)
      if (error instanceof ApiShapeError) {
        expect(error.path).toBe('/api/health')
        expect(error.issues).toContain('version')
      }
    }
  })

  test('un cuerpo que no es JSON es un ApiShapeError', async () => {
    const target = fake(200, 'esto no es json')

    await expect(apiGet('/api/health', HEALTH, {}, target.deps)).rejects.toBeInstanceOf(
      ApiShapeError,
    )
  })

  test('un 204 donde se espera cuerpo es un ApiShapeError', async () => {
    const target = fake(204, '')

    await expect(apiGet('/api/health', HEALTH, {}, target.deps)).rejects.toBeInstanceOf(
      ApiShapeError,
    )
  })
})

describe('códigos de error', () => {
  test('un 401 lanza ApiError y se reconoce como sesión perdida', async () => {
    const target = fake(401, '')

    try {
      await apiGet('/api/health', HEALTH, {}, target.deps)
      throw new Error('debería haber lanzado')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      if (error instanceof ApiError) {
        expect(error.status).toBe(401)
        expect(error.isSessionLost).toBe(true)
      }
    }
  })

  test('un 500 es ApiError y no una sesión perdida', async () => {
    const target = fake(500, '')

    try {
      await apiGet('/api/health', HEALTH, {}, target.deps)
      throw new Error('debería haber lanzado')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      if (error instanceof ApiError) expect(error.isSessionLost).toBe(false)
    }
  })

  test('el error nombra método, ruta y código', async () => {
    const target = fake(403, '')

    try {
      await apiGet('/api/health', HEALTH, {}, target.deps)
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

    await expect(apiGet('/api/health', HEALTH, {}, failing(boom))).rejects.toBe(boom)
  })
})

describe('send: mutaciones sin cuerpo de respuesta', () => {
  test('no analiza el cuerpo y resuelve sin valor', async () => {
    const target = fake(204, '')

    expect(await send('/api/watch', { method: 'POST', body: {} }, target.deps)).toBeUndefined()
  })

  test('un 401 sigue siendo un ApiError', async () => {
    const target = fake(401, '')

    await expect(send('/api/watch', { method: 'POST' }, target.deps)).rejects.toBeInstanceOf(
      ApiError,
    )
  })
})
