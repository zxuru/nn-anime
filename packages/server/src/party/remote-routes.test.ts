import { describe, expect, test } from 'bun:test'
import { createApp } from '../index'

const PORT = 7717
const BASE = `http://127.0.0.1:${PORT}`
const SESSION = {
  cookieName: 'nn_session',
  value: 'sesion-de-prueba',
  matches: (candidate: string | undefined) => candidate === 'sesion-de-prueba',
}
const HEADERS = {
  cookie: 'nn_session=sesion-de-prueba',
  origin: BASE,
  'content-type': 'application/json',
}

function anfitrion() {
  return async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input)

    if (url.pathname === '/api/party/join') {
      return Response.json({
        roomId: 'sala-1',
        token: 't'.repeat(43),
        expiresAt: 9_999_999,
        state: null,
        roster: [],
      })
    }

    if (url.pathname.endsWith('/events')) {
      return new Response(
        new ReadableStream<Uint8Array>({
          start() {
            // Sin eventos: el flujo queda abierto hasta que se salga.
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      )
    }

    return new Response('', { status: init?.method === 'POST' ? 204 : 404 })
  }
}

function app() {
  return createApp({
    port: PORT,
    session: SESSION,
    bootToken: 'token-de-arrastre',
    version: '0.1.0',
    party: { enabled: true, fetchImpl: anfitrion() },
  })
}

describe('las rutas del invitado en su propio servidor', () => {
  test('sin la sesión local no se enlaza con nadie', async () => {
    const target = app()
    const respuesta = await target.request(`${BASE}/api/party/remote/join`, {
      method: 'POST',
      headers: { origin: BASE, 'content-type': 'application/json' },
      body: JSON.stringify({ baseUrl: '127.0.0.1:7718', code: 'ABCDEFGHJKMNPQRS', name: 'Ana' }),
    })

    expect(respuesta.status).toBe(401)
  })

  test('con sesión enlaza y devuelve el snapshot sin token', async () => {
    const target = app()
    const respuesta = await target.request(`${BASE}/api/party/remote/join`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ baseUrl: '127.0.0.1:7718', code: 'ABCDEFGHJKMNPQRS', name: 'Ana' }),
    })

    expect(respuesta.status).toBe(200)
    const cuerpo = (await respuesta.json()) as Record<string, unknown>
    expect(cuerpo.roomId).toBe('sala-1')
    expect(cuerpo).not.toHaveProperty('token')

    const snapshot = await target.request(`${BASE}/api/party/remote`, { headers: HEADERS })
    expect(snapshot.status).toBe(200)

    // El flujo local entrega el `welcome` de la instantánea al suscribirse: es
    // lo que hace que una pestaña que recarga no se quede sin sala.
    const controlador = new AbortController()
    const eventos = await target.request(`${BASE}/api/party/remote/events`, {
      headers: HEADERS,
      signal: controlador.signal,
    })

    expect(eventos.status).toBe(200)
    expect(eventos.headers.get('content-type')).toContain('text/event-stream')

    const reader = eventos.body?.getReader()
    if (reader === undefined) throw new Error('sin cuerpo')
    const { value } = await reader.read()
    const texto = new TextDecoder().decode(value)

    expect(texto).toContain('"type":"welcome"')
    expect(texto).toContain('"roomId":"sala-1"')

    controlador.abort()
    await reader.cancel().catch(() => undefined)

    const salida = await target.request(`${BASE}/api/party/remote/leave`, {
      method: 'POST',
      headers: HEADERS,
    })
    expect(salida.status).toBe(204)
  })
})
