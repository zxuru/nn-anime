/**
 * El cliente de AniSkip, con `fetch` y resolutor inyectados.
 *
 * Ninguna prueba sale a la red. Lo que se mide es lo que el cliente promete y no
 * se ve leyendo el código: la URL con sus tipos, el plazo corto, el tope del
 * cuerpo, que un estado malo es un fallo y no un dato, y que una redirección
 * fuera de la lista blanca se corta antes de pedirse.
 */

import { describe, expect, test } from 'bun:test'
import type { FetchLike, Resolver } from '@rona/media-proxy'
import {
  ANISKIP_OFFLINE_ENV,
  ANISKIP_TIMEOUT_MS,
  aniskipOfflineFromEnv,
  aniskipUrl,
  createAniSkipClient,
  MAX_ANISKIP_BYTES,
} from './client'

/** Un resolutor de mentira: cualquier nombre resuelve a una IP pública. */
const RESOLVER: Resolver = async () => ['140.82.121.3']

const RESPUESTA = {
  found: true,
  results: [
    {
      interval: { startTime: 128.406, endTime: 218.406 },
      skipType: 'op',
      skipId: 'op-1',
      episodeLength: 1441.94,
    },
  ],
}

interface Peticion {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

/** El cliente con un `fetch` falso que apunta lo que se le pide. */
function cliente(respuesta: () => Response, timeoutMs?: number) {
  const peticiones: Peticion[] = []

  const impl: FetchLike = async (input, init) => {
    peticiones.push({
      url: input,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
    })

    return respuesta()
  }

  const client = createAniSkipClient({
    fetchImpl: impl,
    resolver: RESOLVER,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  })

  return { client, peticiones }
}

describe('la petición', () => {
  test('sin fetch inyectado, un DNS privado se corta antes de pedir', async () => {
    const client = createAniSkipClient({
      resolver: async () => ['127.0.0.1'],
    })

    const resultado = await client.fetch({ malId: 1, episode: 1, length: 1440 })

    expect(resultado.ok).toBe(false)
    expect(resultado.ok ? '' : resultado.error.message).toContain('loopback')
  })

  test('sin fetch inyectado, la conexión no pasa por el fetch global', async () => {
    const original = globalThis.fetch
    let llamado = false
    // El doble no necesita `preconnect`: se declara para que el tipo de `fetch`
    // de Bun quede completo y el test no tenga que silenciar nada con un `as`.
    const falso: typeof fetch = Object.assign(
      async () => {
        llamado = true

        return new Response('{}')
      },
      { preconnect: () => undefined },
    )
    globalThis.fetch = falso

    try {
      const client = createAniSkipClient({
        resolver: async () => ['203.0.113.10'],
        timeoutMs: 20,
      })

      await client.fetch({ malId: 1, episode: 1, length: 1440 })
      expect(llamado).toBe(false)
    } finally {
      globalThis.fetch = original
    }
  })

  test('va al host y a la ruta de AniSkip, con todos los tipos y la duración', async () => {
    const { client, peticiones } = cliente(() => Response.json(RESPUESTA))

    const resultado = await client.fetch({ malId: 16498, episode: 1, length: 1441.94 })

    expect(resultado).toEqual({ ok: true, payload: RESPUESTA })

    const url = new URL(peticiones[0]?.url ?? '')
    expect(url.protocol).toBe('https:')
    expect(url.hostname).toBe('api.aniskip.com')
    expect(url.pathname).toBe('/v2/skip-times/16498/1')
    expect(url.searchParams.getAll('types[]')).toEqual([
      'op',
      'ed',
      'recap',
      'mixed-op',
      'mixed-ed',
    ])
    // La duración se redondea al segundo: la clave de caché y la URL tienen que
    // hablar del mismo número.
    expect(url.searchParams.get('episodeLength')).toBe('1442')
  })

  test('el plazo por defecto es el que midió la investigación: 3000 ms', () => {
    // Tres segundos: lo que tarda como mucho un episodio en decidir si hay
    // botones. La prueba del plazo usa un valor inyectado para no esperar.
    expect(ANISKIP_TIMEOUT_MS).toBe(3000)
  })

  test('se identifica con su user-agent y pide JSON', async () => {
    const { client, peticiones } = cliente(() => Response.json(RESPUESTA))

    await client.fetch({ malId: 16498, episode: 1, length: 1440 })

    expect(peticiones[0]?.headers['user-agent']).toContain('RoNa')
    expect(peticiones[0]?.headers.accept).toBe('application/json')
  })

  test('la URL se compone con `URL`, no a mano', () => {
    const url = aniskipUrl({ malId: 16498, episode: 3, length: 24 })

    expect(url).toStartWith('https://api.aniskip.com/v2/skip-times/16498/3?')
    expect(url).toContain('types%5B%5D=op')
  })
})

describe('los errores de la API', () => {
  test('un 404 con found:false es una respuesta buena: «no hay datos»', async () => {
    const cuerpo = { found: false, results: [], message: 'No skip times found', statusCode: 404 }
    const { client } = cliente(() => Response.json(cuerpo, { status: 404 }))

    const resultado = await client.fetch({ malId: 52991, episode: 2, length: 1440 })

    // El 404 es el caso mayoritario de AniSkip y significa «consultado y sin
    // datos»: si aquí se devolviera un fallo, el servicio lo cachearía con el TTL
    // de error y multiplicaría las consultas al tercero.
    expect(resultado).toEqual({ ok: true, payload: cuerpo })
    expect(client.calls()).toBe(1)
  })

  test('un 404 con un cuerpo que no es de AniSkip sí es un fallo', async () => {
    const { client } = cliente(() => new Response('no', { status: 404 }))

    const resultado = await client.fetch({ malId: 16498, episode: 1, length: 1440 })

    expect(resultado.ok).toBe(false)
    expect(resultado.ok ? undefined : resultado.error.context?.status).toBe(404)
  })

  test('un 400 de validación es un fallo con su código', async () => {
    const validacion = { statusCode: 400, message: 'Validation failed', errors: [] }
    const { client } = cliente(() => Response.json(validacion, { status: 400 }))

    const resultado = await client.fetch({ malId: 16498, episode: 1, length: 1440 })

    expect(resultado.ok).toBe(false)
    expect(resultado.ok ? undefined : resultado.error.context?.status).toBe(400)
  })

  test('un 500 se cuenta con su código', async () => {
    const { client } = cliente(() => new Response('boom', { status: 500 }))

    const resultado = await client.fetch({ malId: 16498, episode: 1, length: 1440 })

    expect(resultado.ok).toBe(false)
    expect(resultado.ok ? undefined : resultado.error.context?.status).toBe(500)
  })

  test('un cuerpo que no es JSON es un error, no un dato', async () => {
    const { client } = cliente(() => new Response('<html>'))

    const resultado = await client.fetch({ malId: 16498, episode: 1, length: 1440 })

    expect(resultado.ok).toBe(false)
    expect(resultado.ok ? '' : resultado.error.message).toContain('no es JSON')
  })

  test('una respuesta que pasa del tope no se lee entera', async () => {
    const { client } = cliente(() => new Response('x'.repeat(MAX_ANISKIP_BYTES + 1)))

    const resultado = await client.fetch({ malId: 16498, episode: 1, length: 1440 })

    expect(resultado.ok).toBe(false)
    expect(resultado.ok ? '' : resultado.error.message).toContain('tope')
  })

  test('un tercero que no contesta dentro del plazo es un fallo, no una espera', async () => {
    const colgado: FetchLike = (_input, init) =>
      new Promise<Response>((_resolver, rechazar) => {
        if (init.signal?.aborted === true) {
          rechazar(new Error('abortado'))

          return
        }

        init.signal?.addEventListener('abort', () => rechazar(new Error('abortado')), {
          once: true,
        })
      })

    const client = createAniSkipClient({ fetchImpl: colgado, resolver: RESOLVER, timeoutMs: 20 })

    const resultado = await client.fetch({ malId: 16498, episode: 1, length: 1440 })

    expect(resultado.ok).toBe(false)
    expect(resultado.ok ? '' : resultado.error.message).toContain('tiempo')
  })
})

describe('la lista blanca de hosts', () => {
  test('una redirección fuera de AniSkip se corta, y no se llega a pedir', async () => {
    const visitadas: string[] = []
    const impl: FetchLike = async (input) => {
      visitadas.push(input)

      return new Response(null, {
        status: 302,
        headers: { location: 'https://ejemplo.invalid/copia-de-aniskip' },
      })
    }

    const client = createAniSkipClient({ fetchImpl: impl, resolver: RESOLVER })

    const resultado = await client.fetch({ malId: 16498, episode: 1, length: 1440 })

    expect(resultado.ok).toBe(false)
    expect(resultado.ok ? '' : resultado.error.message).toContain('no es de AniSkip')
    expect(visitadas).toEqual([expect.stringContaining('api.aniskip.com')])
  })
})

describe('el interruptor del arnés', () => {
  test('apagado no sale a la red y contesta como un AniSkip caído', async () => {
    const llamadas: string[] = []
    const apagado = createAniSkipClient({
      offline: true,
      fetchImpl: async (input) => {
        llamadas.push(input)

        return Response.json(RESPUESTA)
      },
    })

    const resultado = await apagado.fetch({ malId: 16498, episode: 1, length: 1440 })

    expect(resultado.ok).toBe(false)
    expect(resultado.ok ? '' : resultado.error.message).toContain('apagado')
    expect(llamadas).toEqual([])
    expect(apagado.calls()).toBe(0)
  })

  test('el entorno lo enciende con 1 o true', () => {
    expect(aniskipOfflineFromEnv({ [ANISKIP_OFFLINE_ENV]: '1' })).toBe(true)
    expect(aniskipOfflineFromEnv({ [ANISKIP_OFFLINE_ENV]: 'true' })).toBe(true)
    expect(aniskipOfflineFromEnv({ [ANISKIP_OFFLINE_ENV]: '0' })).toBe(false)
    expect(aniskipOfflineFromEnv({})).toBe(false)
  })
})

describe('el contador de salidas', () => {
  test('cuenta las peticiones reales y no las que se quedan en error de guardián', async () => {
    const { client, peticiones } = cliente(() => Response.json(RESPUESTA))

    await client.fetch({ malId: 16498, episode: 1, length: 1440 })
    await client.fetch({ malId: 16498, episode: 2, length: 1440 })

    expect(client.calls()).toBe(2)
    expect(peticiones).toHaveLength(2)
  })
})
