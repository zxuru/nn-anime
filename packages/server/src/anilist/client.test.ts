/**
 * El cliente de AniList, con `fetch`, reloj y espera inyectados.
 *
 * Ninguna prueba sale a la red. Lo que se mide es lo que el cliente promete y no
 * se ve leyendo el código: que las peticiones salen espaciadas —el presupuesto—,
 * que un 429 se obedece, que una respuesta con otra forma es un error y no un
 * dato, y que una redirección fuera de la lista blanca se corta.
 */

import { describe, expect, test } from 'bun:test'
import type { FetchLike, Resolver } from '@nn-anime/media-proxy'
import { z } from 'zod'
import { createAniListClient, retryAfterMs } from './client'

/** Un resolutor de mentira: cualquier nombre resuelve a una IP pública. */
const RESOLVER: Resolver = async () => ['140.82.121.3']

interface FakeClock {
  readonly now: () => number
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Los milisegundos que se pidió esperar, en orden. */
  readonly esperas: readonly number[]
}

function relojFalso(inicio = 1_000_000): FakeClock {
  let t = inicio
  const esperas: number[] = []

  return {
    now: () => t,
    async sleep(ms: number) {
      esperas.push(ms)
      t += ms
    },
    esperas,
  }
}

const schema = z.object({ Page: z.object({ total: z.number() }) })
const CONSULTA = { query: 'query { Page { total } }', variables: {}, schema }

/** El cliente con un `fetch` que responde lo que diga la lista de respuestas. */
function cliente(respuestas: readonly (() => Response)[], reloj = relojFalso()) {
  const marcas: number[] = []
  const peticiones: { readonly method: string | undefined; readonly body: string }[] = []
  let indice = 0

  const impl: FetchLike = async (_input, init) => {
    marcas.push(reloj.now())
    peticiones.push({
      method: init?.method,
      body: typeof init?.body === 'string' ? init.body : '',
    })

    const siguiente = respuestas[Math.min(indice, respuestas.length - 1)]
    indice += 1

    return siguiente === undefined ? new Response('{}', { status: 500 }) : siguiente()
  }

  const client = createAniListClient({
    fetchImpl: impl,
    resolver: RESOLVER,
    now: reloj.now,
    sleep: reloj.sleep,
  })

  return { client, reloj, marcas, peticiones }
}

describe('el presupuesto de peticiones', () => {
  test('dos consultas seguidas salen espaciadas por el intervalo mínimo', async () => {
    const ok = () => Response.json({ data: { Page: { total: 1 } } })
    const { client, reloj, marcas } = cliente([ok, ok])

    await client.query({ key: 'uno', ...CONSULTA })
    await client.query({ key: 'dos', ...CONSULTA })

    // La primera no espera; la segunda espera el intervalo entero.
    expect(reloj.esperas).toEqual([2000])
    expect((marcas[1] ?? 0) - (marcas[0] ?? 0)).toBe(2000)
    expect(client.calls()).toBe(2)
  })

  test('una sola consulta no espera nada', async () => {
    const { client, reloj } = cliente([() => Response.json({ data: { Page: { total: 1 } } })])

    await client.query({ key: 'uno', ...CONSULTA })

    expect(reloj.esperas).toEqual([])
  })
})

describe('el POST de GraphQL', () => {
  test('va con su método, su cabecera y las variables en el cuerpo', async () => {
    const { client, peticiones } = cliente([() => Response.json({ data: { Page: { total: 3 } } })])

    const resultado = await client.query({
      key: 'uno',
      query: 'query ($n: Int) { Page(perPage: $n) { total } }',
      variables: { n: 3 },
      schema: z.object({ Page: z.object({ total: z.number() }) }),
    })

    expect(resultado.ok).toBe(true)
    expect(peticiones[0]?.method).toBe('POST')

    const cuerpo = JSON.parse(peticiones[0]?.body ?? '{}') as {
      query?: string
      variables?: Record<string, unknown>
    }
    expect(cuerpo.variables).toEqual({ n: 3 })
    expect(cuerpo.query).toContain('Page(perPage: $n)')
  })
})

describe('el 429', () => {
  test('obedece el Retry-After y reintenta una vez', async () => {
    const ok = () => Response.json({ data: { Page: { total: 7 } } })
    const limitado = () => new Response('{}', { status: 429, headers: { 'retry-after': '5' } })
    const { client, reloj } = cliente([limitado, ok])

    const resultado = await client.query({ key: 'uno', ...CONSULTA })

    expect(resultado.ok).toBe(true)
    expect(reloj.esperas).toEqual([5000])
  })

  test('al segundo 429 se rinde, sin insistir', async () => {
    const limitado = () => new Response('{}', { status: 429, headers: { 'retry-after': '2' } })
    const { client, marcas } = cliente([limitado, limitado])

    const resultado = await client.query({ key: 'uno', ...CONSULTA })

    expect(resultado.ok).toBe(false)
    // Dos peticiones —la original y el reintento— y ni una más.
    expect(marcas).toHaveLength(2)
  })

  test('el Retry-After tiene tope', () => {
    expect(retryAfterMs('5')).toBe(5000)
    expect(retryAfterMs('9999')).toBe(60_000)
    expect(retryAfterMs('0')).toBeUndefined()
    expect(retryAfterMs('lo que sea')).toBeUndefined()
    expect(retryAfterMs(null)).toBeUndefined()
  })
})

describe('lo que llega de fuera', () => {
  test('una respuesta que no es JSON es un error, no un dato', async () => {
    const { client } = cliente([() => new Response('<html>')])

    const resultado = await client.query({ key: 'uno', ...CONSULTA })

    expect(resultado.ok).toBe(false)
    expect(resultado.ok ? '' : resultado.error.message).toContain('no es JSON')
  })

  test('un error de GraphQL se cuenta con su mensaje', async () => {
    const { client } = cliente([
      () => Response.json({ data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] }),
    ])

    const resultado = await client.query({ key: 'uno', ...CONSULTA })

    expect(resultado.ok).toBe(false)
    expect(resultado.ok ? '' : resultado.error.message).toContain('Too Many Requests')
  })

  test('unos datos con otra forma son un error, no medio dato', async () => {
    const { client } = cliente([() => Response.json({ data: { Page: { total: 'tres' } } })])

    const resultado = await client.query({ key: 'uno', ...CONSULTA })

    expect(resultado.ok).toBe(false)
    expect(resultado.ok ? '' : resultado.error.message).toContain('forma esperada')
  })

  test('un estado que no es 2xx se cuenta con su código', async () => {
    const { client } = cliente([() => new Response('{}', { status: 500 })])

    const resultado = await client.query({ key: 'uno', ...CONSULTA })

    expect(resultado.ok).toBe(false)
    expect(resultado.ok ? '' : resultado.error.context?.status).toBe(500)
  })
})

describe('la lista blanca de hosts', () => {
  test('una redirección fuera de AniList se corta, y no se llega a pedir', async () => {
    const visitadas: string[] = []
    const impl: FetchLike = async (input) => {
      visitadas.push(input)

      return new Response(null, {
        status: 302,
        headers: { location: 'https://ejemplo.invalid/copia-de-anilist' },
      })
    }

    const client = createAniListClient({
      fetchImpl: impl,
      resolver: RESOLVER,
      now: () => 0,
      sleep: async () => {},
    })

    const resultado = await client.query({ key: 'uno', ...CONSULTA })

    expect(resultado.ok).toBe(false)
    expect(resultado.ok ? '' : resultado.error.message).toContain('no es de AniList')
    expect(visitadas).toEqual(['https://graphql.anilist.co'])
  })
})
