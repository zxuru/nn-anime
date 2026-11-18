/**
 * El cliente de AniList, con `fetch`, reloj y espera inyectados.
 *
 * Ninguna prueba sale a la red. Lo que se mide es lo que el cliente promete y no
 * se ve leyendo el código: que la primera carga sale en ráfaga y el resto se
 * espacia —el presupuesto—, que un 429 se obedece, que una respuesta con otra
 * forma es un error y no un dato, y que una redirección fuera de la lista blanca
 * se corta.
 */

import { describe, expect, test } from 'bun:test'
import type { FetchLike, Resolver } from '@rona/media-proxy'
import { z } from 'zod'
import { createAniListClient, retryAfterMs } from './client'

/** Un resolutor de mentira: cualquier nombre resuelve a una IP pública. */
const RESOLVER: Resolver = async () => ['140.82.121.3']

interface FakeClock {
  readonly now: () => number
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Los milisegundos que se pidió esperar, en orden. */
  readonly esperas: readonly number[]
  /** Mueve el reloj sin que nadie espere: el tiempo de calma entre consultas. */
  readonly avanzar: (ms: number) => void
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
    avanzar(ms: number) {
      t += ms
    },
    esperas,
  }
}

/**
 * Un reloj de mentira con temporizadores que no se resuelven solos.
 *
 * La prueba los avanza con `correr()` y los que vencen a la vez se resuelven
 * juntos: así tres latencias de red que empiezan en el mismo instante cuestan
 * una, no tres. Es lo que hace medible la concurrencia sin esperar de verdad y
 * lo que separa la espera del presupuesto de la latencia del tercero.
 */
interface SimulatedClock {
  readonly now: () => number
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Lo que el cliente pidió esperar por el presupuesto, en orden. */
  readonly esperas: readonly number[]
  /** La latencia de la red de mentira: no es una espera del presupuesto. */
  readonly red: (ms: number) => Promise<void>
  /** Avanza hasta que no quede ningún temporizador pendiente. */
  readonly correr: () => Promise<void>
}

function relojSimulado(inicio = 1_000_000): SimulatedClock {
  let t = inicio
  const esperas: number[] = []
  const pendientes: { readonly hasta: number; readonly despertar: () => void }[] = []

  const esperar = (ms: number): Promise<void> =>
    new Promise((despertar) => {
      pendientes.push({ hasta: t + ms, despertar })
    })

  // Un turno de verdad para que las promesas pendientes lleguen a su temporizador.
  // No se espera tiempo: sólo se deja correr la cola.
  const ceder = (): Promise<void> => new Promise((resolver) => setTimeout(resolver, 0))

  return {
    now: () => t,
    esperas,
    sleep(ms: number) {
      esperas.push(ms)
      return esperar(ms)
    },
    red: esperar,
    async correr() {
      await ceder()

      while (pendientes.length > 0) {
        t = Math.max(t, Math.min(...pendientes.map((timer) => timer.hasta)))

        const vencidos = pendientes.filter((timer) => timer.hasta <= t)
        for (const vencido of vencidos) {
          pendientes.splice(pendientes.indexOf(vencido), 1)
          vencido.despertar()
        }

        await ceder()
      }
    },
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

/** El cliente con una red que tarda lo que le diga el reloj simulado. */
function clienteConRed(
  reloj: SimulatedClock,
  respuestas: readonly (() => Response)[],
  latenciaMs: number,
) {
  const marcas: number[] = []
  let indice = 0

  const impl: FetchLike = async () => {
    marcas.push(reloj.now())
    await reloj.red(latenciaMs)

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

  return { client, marcas }
}

const OK = () => Response.json({ data: { Page: { total: 1 } } })

describe('el presupuesto de peticiones', () => {
  test('la ráfaga deja salir las tres primeras y la cuarta espera el intervalo', async () => {
    const { client, reloj, marcas } = cliente([OK, OK, OK, OK])

    for (const key of ['top', 'airing', 'recent', 'related']) {
      await client.query({ key, ...CONSULTA })
    }

    // Las tres de la primera carga no esperan; la cuarta sí, y su turno se mide
    // desde la primera, no desde que la anterior terminó.
    expect(reloj.esperas).toEqual([2000])
    const primera = marcas[0] ?? Number.NaN
    expect(marcas.slice(0, 3)).toEqual([primera, primera, primera])
    expect((marcas[3] ?? 0) - primera).toBe(2000)
    expect(client.calls()).toBe(4)
  })

  test('una sola consulta no espera nada', async () => {
    const { client, reloj } = cliente([OK])

    await client.query({ key: 'uno', ...CONSULTA })

    expect(reloj.esperas).toEqual([])
  })

  test('el tiempo repone los créditos de uno en uno', async () => {
    const { client, reloj } = cliente([OK, OK, OK, OK, OK, OK])

    for (const key of ['top', 'airing', 'recent']) {
      await client.query({ key, ...CONSULTA })
    }

    // Cuatro segundos de calma devuelven dos créditos: dos consultas salen sin
    // esperar y la tercera vuelve a hacer cola.
    reloj.avanzar(4000)
    await client.query({ key: 'cuatro', ...CONSULTA })
    await client.query({ key: 'cinco', ...CONSULTA })
    await client.query({ key: 'seis', ...CONSULTA })

    expect(reloj.esperas).toEqual([2000])
  })

  test('con `burst: 1` el turno es el de siempre', async () => {
    let t = 0
    const esperas: number[] = []
    let indice = 0
    const impl: FetchLike = async () => {
      indice += 1
      return OK()
    }

    const client = createAniListClient({
      fetchImpl: impl,
      resolver: RESOLVER,
      now: () => t,
      sleep: async (ms) => {
        esperas.push(ms)
        t += ms
      },
      burst: 1,
    })

    await client.query({ key: 'uno', ...CONSULTA })
    await client.query({ key: 'dos', ...CONSULTA })
    await client.query({ key: 'tres', ...CONSULTA })

    expect(indice).toBe(3)
    expect(esperas).toEqual([2000, 2000])
  })
})

describe('la primera carga', () => {
  test('las tres filas frías salen a la vez y caben en el presupuesto', async () => {
    const reloj = relojSimulado()
    // Los 926 ms medidos de la primera consulta fría, redondeados: el presupuesto
    // es 1,5 s y no depende de que AniList conteste en tiempo real.
    const { client, marcas } = clienteConRed(reloj, [OK, OK, OK], 900)
    const inicio = reloj.now()

    const lote = Promise.all([
      client.query({ key: 'discover:top', ...CONSULTA }),
      client.query({ key: 'discover:airing', ...CONSULTA }),
      client.query({ key: 'discover:recent', ...CONSULTA }),
    ])

    await reloj.correr()
    const resultados = await lote

    expect(resultados.every((resultado) => resultado.ok)).toBe(true)
    // Las tres salen en el mismo instante: no hay turno entre ellas.
    expect(marcas).toEqual([inicio, inicio, inicio])
    expect(reloj.esperas).toEqual([])
    // Con los 900 ms de una consulta fría, la última fila está servida a 900 ms
    // —por debajo de los 1 200 ms de la prueba y del presupuesto de 1 500 ms— en
    // vez de a 900 + 2 000 + 2 000.
    expect(reloj.now() - inicio).toBe(900)
    expect(reloj.now() - inicio).toBeLessThanOrEqual(1200)
  })

  test('la cuarta consulta espera su turno', async () => {
    const reloj = relojSimulado()
    const { client, marcas } = clienteConRed(reloj, [OK, OK, OK, OK], 900)
    const inicio = reloj.now()

    const lote = Promise.all([
      client.query({ key: 'top', ...CONSULTA }),
      client.query({ key: 'airing', ...CONSULTA }),
      client.query({ key: 'recent', ...CONSULTA }),
      client.query({ key: 'related', ...CONSULTA }),
    ])

    await reloj.correr()
    const resultados = await lote

    expect(resultados.every((resultado) => resultado.ok)).toBe(true)
    expect(marcas.slice(0, 3)).toEqual([inicio, inicio, inicio])
    expect((marcas[3] ?? 0) - inicio).toBe(2000)
    expect(reloj.esperas).toEqual([2000])
  })

  test('la ráfaga tiene tope: seis consultas a la vez son tres y luego una cada dos segundos', async () => {
    const reloj = relojSimulado()
    const { client, marcas } = clienteConRed(reloj, [OK, OK, OK, OK, OK, OK], 100)
    const inicio = reloj.now()

    const lote = Promise.all(
      ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis'].map((key) =>
        client.query({ key, ...CONSULTA }),
      ),
    )

    await reloj.correr()
    await lote

    expect(marcas.map((marca) => marca - inicio)).toEqual([0, 0, 0, 2000, 4000, 6000])
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
