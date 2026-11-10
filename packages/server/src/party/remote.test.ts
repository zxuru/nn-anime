import { describe, expect, test } from 'bun:test'
import type { PartyEvent } from '@nn-anime/core'
import { RemoteParty } from './remote'

const TOKEN = 't'.repeat(43)
const ROOM_ID = 'sala-de-prueba'

interface Llamada {
  readonly url: string
  readonly init: RequestInit | undefined
}

function esperar(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Un anfitrión de mentira: las cuatro respuestas que el invitado puede recibir,
 * y un flujo SSE que la prueba controla.
 */
function anfitrion(joinStatus = 200) {
  const llamadas: Llamada[] = []
  let sse: ReadableStreamDefaultController<Uint8Array> | undefined

  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    llamadas.push({ url: input, init })
    const url = new URL(input)

    if (url.pathname === '/api/party/join') {
      if (joinStatus !== 200) return new Response('', { status: joinStatus })

      return Response.json({
        roomId: ROOM_ID,
        token: TOKEN,
        expiresAt: 10_000,
        state: null,
        roster: [],
      })
    }

    if (url.pathname.endsWith('/events')) {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            sse = controller
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      )
    }

    if (url.pathname.endsWith('/report')) return new Response('', { status: 204 })
    if (url.pathname.endsWith('/sync')) {
      return Response.json({ t0: 1_000, t1: 1_005, t2: 1_006 })
    }
    if (url.pathname.endsWith('/leave')) return new Response('', { status: 204 })

    return new Response('', { status: 404 })
  }

  return {
    fetchImpl,
    llamadas,
    enviar(evento: PartyEvent) {
      sse?.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(evento)}\n\n`))
    },
  }
}

describe('RemoteParty.join', () => {
  test('normaliza la dirección que escribe la persona y no manda el token a la pestaña', async () => {
    const host = anfitrion()
    const relay = new RemoteParty({ fetchImpl: host.fetchImpl, now: () => 1_000 })

    const resultado = await relay.join({
      baseUrl: '192.168.1.5:7717',
      code: 'ABCD-EFGH-JKMN-PQRS',
      name: 'Ana',
    })

    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.snapshot.roomId).toBe(ROOM_ID)
      expect(resultado.snapshot).not.toHaveProperty('token')
    }

    expect(host.llamadas[0]?.url).toBe('http://192.168.1.5:7717/api/party/join')
    expect(JSON.parse(String(host.llamadas[0]?.init?.body))).toEqual({
      code: 'ABCD-EFGH-JKMN-PQRS',
      name: 'Ana',
    })
  })

  test('una dirección que no es HTTP no sale a la red', async () => {
    const host = anfitrion()
    const relay = new RemoteParty({ fetchImpl: host.fetchImpl })

    expect(await relay.join({ baseUrl: 'file:///etc/passwd', code: 'x', name: 'Ana' })).toEqual({
      ok: false,
      reason: 'invalid-base',
    })
    expect(host.llamadas).toHaveLength(0)
  })

  test('distingue sala inexistente, llena y límite', async () => {
    const casos = [
      [404, 'not-found'],
      [409, 'full'],
      [429, 'rate-limited'],
      [500, 'unavailable'],
    ] as const

    for (const [status, reason] of casos) {
      const relay = new RemoteParty({ fetchImpl: anfitrion(status).fetchImpl })
      const resultado = await relay.join({ baseUrl: '127.0.0.1:7717', code: 'x', name: 'Ana' })

      expect(resultado).toEqual({ ok: false, reason })
    }
  })
})

describe('RemoteParty en marcha', () => {
  test('los eventos del anfitrión llegan a los suscriptores locales', async () => {
    const host = anfitrion()
    const relay = new RemoteParty({ fetchImpl: host.fetchImpl, now: () => 1_000 })
    const recibidos: string[] = []

    await relay.join({ baseUrl: '127.0.0.1:7717', code: 'ABCDEFGHJKMNPQRS', name: 'Ana' })
    await esperar()
    relay.subscribe((evento) => recibidos.push(evento.type))

    // El `subscribe` entrega el welcome de la instantánea.
    expect(recibidos).toEqual(['welcome'])

    host.enviar({
      type: 'state',
      state: {
        media: { kind: 'episode', title: 'Aurora', episode: 1 },
        positionS: 10,
        paused: false,
        rate: 1,
        seq: 1,
        atMs: 1_000,
      },
    })
    await esperar()

    expect(recibidos).toEqual(['welcome', 'state'])
    expect(relay.snapshot()?.state?.positionS).toBe(10)
  })

  test('reportar y medir el reloj usan el token contra el anfitrión', async () => {
    const host = anfitrion()
    const relay = new RemoteParty({ fetchImpl: host.fetchImpl, now: () => 1_000 })

    await relay.join({ baseUrl: '127.0.0.1:7717', code: 'ABCDEFGHJKMNPQRS', name: 'Ana' })

    expect(await relay.report({ positionS: 3, paused: false, buffering: false, ready: true })).toBe(
      'ok',
    )
    expect(await relay.sync(1_000)).toEqual({ t0: 1_000, t1: 1_005, t2: 1_006 })

    const reporte = host.llamadas.find((llamada) => llamada.url.endsWith('/report'))
    const cabeceras = reporte?.init?.headers as Record<string, string>
    expect(cabeceras.authorization).toBe(`Bearer ${TOKEN}`)
  })

  test('salir avisa al anfitrión y cierra a los suscriptores', async () => {
    const host = anfitrion()
    const relay = new RemoteParty({ fetchImpl: host.fetchImpl, now: () => 1_000 })
    const recibidos: string[] = []

    await relay.join({ baseUrl: '127.0.0.1:7717', code: 'ABCDEFGHJKMNPQRS', name: 'Ana' })
    relay.subscribe((evento) => recibidos.push(evento.type))

    await relay.leave()

    expect(recibidos).toContain('closed')
    expect(host.llamadas.some((llamada) => llamada.url.endsWith('/leave'))).toBe(true)
    expect(relay.snapshot()).toBeUndefined()
  })

  test('un enlace que el anfitrión ya no reconoce se cierra como host-left', async () => {
    const host = anfitrion()
    const relay = new RemoteParty({ fetchImpl: host.fetchImpl, now: () => 1_000 })
    const recibidos: string[] = []

    await relay.join({ baseUrl: '127.0.0.1:7717', code: 'ABCDEFGHJKMNPQRS', name: 'Ana' })
    await esperar()
    relay.subscribe((evento) => recibidos.push(evento.type))

    host.enviar({ type: 'closed', reason: 'host-left' })
    await esperar()

    expect(recibidos).toContain('closed')
    expect(relay.hasLink()).toBe(false)
  })
})
