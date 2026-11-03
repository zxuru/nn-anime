import { describe, expect, test } from 'bun:test'
import type { PartyEvent } from '@nn-anime/core'
import { createApp } from '../index'

const PORT = 7717
const BASE = `http://127.0.0.1:${PORT}`
const GUEST_ORIGIN = 'http://127.0.0.1:9123'
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const HOST = {
  cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`,
  origin: BASE,
  'content-type': 'application/json',
}
const JSON_HEADERS = { 'content-type': 'application/json' }

const SESSION = {
  cookieName: SESSION_COOKIE,
  value: SESSION_VALUE,
  matches: (candidate: string | undefined) => candidate === SESSION_VALUE,
}

function app(options: { enabled?: boolean } = {}) {
  return createApp({
    port: PORT,
    session: SESSION,
    bootToken: 'token-de-arrastre',
    version: '0.1.0',
    ...(options.enabled === false
      ? {}
      : { party: { enabled: true, urls: () => ['http://192.168.1.10:7717'] } }),
  })
}

async function crearSala(target: ReturnType<typeof app>): Promise<{
  roomId: string
  code: string
}> {
  const respuesta = await target.request(`${BASE}/api/party/rooms`, {
    method: 'POST',
    headers: HOST,
    body: '{}',
  })

  expect(respuesta.status).toBe(201)

  return (await respuesta.json()) as { roomId: string; code: string }
}

async function unirse(
  target: ReturnType<typeof app>,
  code: string,
  name = 'Invitada',
): Promise<{ token: string; roomId: string }> {
  const respuesta = await target.request(`${BASE}/api/party/join`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, origin: GUEST_ORIGIN },
    body: JSON.stringify({ code, name }),
  })

  expect(respuesta.status).toBe(200)

  return (await respuesta.json()) as { token: string; roomId: string }
}

describe('la sala apagada', () => {
  test('sin `party.enabled` las rutas no existen', async () => {
    const target = app({ enabled: false })
    const respuesta = await target.request(`${BASE}/api/party/rooms`, {
      method: 'POST',
      headers: HOST,
      body: '{}',
    })

    expect(respuesta.status).toBe(404)
  })
})

describe('anfitrión', () => {
  test('crea la sala con su sesión y devuelve código y caducidad', async () => {
    const target = app()
    const sala = await crearSala(target)

    expect(sala.roomId.length).toBeGreaterThan(10)
    expect(sala.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/)
  })

  test('sin la cookie de la aplicación no se crea nada', async () => {
    const target = app()
    const respuesta = await target.request(`${BASE}/api/party/rooms`, {
      method: 'POST',
      headers: { origin: BASE, 'content-type': 'application/json' },
      body: '{}',
    })

    expect(respuesta.status).toBe(401)
  })

  test('el invitado no puede publicar el estado autoritativo', async () => {
    const target = app()
    const sala = await crearSala(target)
    const invitada = await unirse(target, sala.code)

    const respuesta = await target.request(`${BASE}/api/party/rooms/${sala.roomId}/state`, {
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        origin: GUEST_ORIGIN,
        authorization: `Bearer ${invitada.token}`,
      },
      body: JSON.stringify({
        media: { kind: 'episode', title: 'Aurora', episode: 1 },
        positionS: 1,
        paused: false,
        rate: 1,
      }),
    })

    expect(respuesta.status).toBe(401)
  })

  test('publicar estado reparte el sello y el invitado lo ve', async () => {
    const target = app()
    const sala = await crearSala(target)
    const invitada = await unirse(target, sala.code)

    const estado = await target.request(`${BASE}/api/party/rooms/${sala.roomId}/state`, {
      method: 'POST',
      headers: HOST,
      body: JSON.stringify({
        media: { kind: 'episode', title: 'Aurora', episode: 1 },
        positionS: 12,
        paused: false,
        rate: 1,
      }),
    })

    expect(estado.status).toBe(204)

    const vista = await target.request(`${BASE}/api/party/rooms/${sala.roomId}`, {
      headers: { authorization: `Bearer ${invitada.token}`, origin: GUEST_ORIGIN },
    })
    const cuerpo = (await vista.json()) as {
      state: { seq: number; atMs: number; positionS: number } | null
    }

    expect(vista.status).toBe(200)
    expect(cuerpo.state?.seq).toBe(1)
    expect(cuerpo.state?.positionS).toBe(12)
    expect(cuerpo.state?.atMs).toBeGreaterThanOrEqual(0)
  })

  test('el token de invitado no abre la API de la aplicación', async () => {
    const target = app()
    const sala = await crearSala(target)
    const invitada = await unirse(target, sala.code)

    const respuesta = await target.request(`${BASE}/api/health`, {
      headers: {
        authorization: `Bearer ${invitada.token}`,
        origin: GUEST_ORIGIN,
      },
    })

    expect(respuesta.status).toBe(401)
  })

  test('la lista de salas y las direcciones son del anfitrión', async () => {
    const target = app()
    await crearSala(target)

    const lista = await target.request(`${BASE}/api/party/rooms`, { headers: HOST })
    expect(((await lista.json()) as { rooms: unknown[] }).rooms).toHaveLength(1)

    const info = await target.request(`${BASE}/api/party/info`, { headers: HOST })
    expect(await info.json()).toEqual({ port: PORT, urls: ['http://192.168.1.10:7717'] })
  })
})

describe('invitado', () => {
  test('entra con el código, sin la cookie de la aplicación, y recibe un token', async () => {
    const target = app()
    const sala = await crearSala(target)
    const invitada = await unirse(target, sala.code, 'Ana')

    expect(invitada.token.length).toBeGreaterThan(30)
    expect(invitada.roomId).toBe(sala.roomId)

    const respuesta = await target.request(`${BASE}/api/party/join`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, origin: GUEST_ORIGIN },
      body: JSON.stringify({ code: 'AAAAAAAAAAAAAAAA', name: 'Ana' }),
    })

    expect(respuesta.status).toBe(404)
  })

  test('reporta su estado y sin token no reporta', async () => {
    const target = app()
    const sala = await crearSala(target)
    const invitada = await unirse(target, sala.code)

    const cuerpo = JSON.stringify({
      positionS: 30,
      paused: false,
      buffering: false,
      ready: true,
    })

    expect(
      (
        await target.request(`${BASE}/api/party/rooms/${sala.roomId}/report`, {
          method: 'POST',
          headers: {
            ...JSON_HEADERS,
            origin: GUEST_ORIGIN,
            authorization: `Bearer ${invitada.token}`,
          },
          body: cuerpo,
        })
      ).status,
    ).toBe(204)

    expect(
      (
        await target.request(`${BASE}/api/party/rooms/${sala.roomId}/report`, {
          method: 'POST',
          headers: { ...JSON_HEADERS, origin: GUEST_ORIGIN },
          body: cuerpo,
        })
      ).status,
    ).toBe(401)
  })

  test('mide el reloj contra el servidor y salir la saca del roster', async () => {
    const target = app()
    const sala = await crearSala(target)
    const invitada = await unirse(target, sala.code)

    const sync = await target.request(`${BASE}/api/party/rooms/${sala.roomId}/sync`, {
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        origin: GUEST_ORIGIN,
        authorization: `Bearer ${invitada.token}`,
      },
      body: JSON.stringify({ t0: 1_000 }),
    })

    expect(sync.status).toBe(200)
    const reloj = (await sync.json()) as { t0: number; t1: number; t2: number }
    expect(reloj.t0).toBe(1_000)
    expect(reloj.t1).toBeGreaterThanOrEqual(0)
    expect(reloj.t2).toBeGreaterThanOrEqual(reloj.t1)

    const salida = await target.request(`${BASE}/api/party/rooms/${sala.roomId}/leave`, {
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        origin: GUEST_ORIGIN,
        authorization: `Bearer ${invitada.token}`,
      },
    })

    expect(salida.status).toBe(204)
  })
})

describe('SSE', () => {
  test('llegar tarde entrega el `welcome` y publicar estado lo reenvía', async () => {
    const target = app()
    const sala = await crearSala(target)
    const invitada = await unirse(target, sala.code)

    const controlador = new AbortController()
    const respuesta = await target.request(`${BASE}/api/party/rooms/${sala.roomId}/events`, {
      headers: {
        authorization: `Bearer ${invitada.token}`,
        origin: GUEST_ORIGIN,
      },
      signal: controlador.signal,
    })

    expect(respuesta.status).toBe(200)
    expect(respuesta.headers.get('content-type')).toContain('text/event-stream')

    const reader = respuesta.body?.getReader()
    if (reader === undefined) throw new Error('sin cuerpo')

    const decoder = new TextDecoder()
    let resto = ''

    const siguiente = async (): Promise<PartyEvent> => {
      for (;;) {
        const corte = resto.indexOf('\n\n')
        if (corte !== -1) {
          const bloque = resto.slice(0, corte)
          resto = resto.slice(corte + 2)
          const linea = bloque.split('\n').find((candidata) => candidata.startsWith('data: '))
          if (linea !== undefined) {
            return JSON.parse(linea.slice('data: '.length)) as PartyEvent
          }
        }

        const { done, value } = await reader.read()
        if (done) throw new Error('el flujo se cerró antes de tiempo')
        resto += decoder.decode(value, { stream: true })
      }
    }

    const esperar = <T>(promesa: Promise<T>): Promise<T> =>
      Promise.race([
        promesa,
        new Promise<T>((_, rechazar) =>
          setTimeout(() => rechazar(new Error('el SSE no llegó a tiempo')), 2_000),
        ),
      ])

    try {
      const bienvenida = await esperar(siguiente())
      expect(bienvenida.type).toBe('welcome')
      if (bienvenida.type === 'welcome') {
        expect(bienvenida.roomId).toBe(sala.roomId)
        expect(bienvenida.state).toBeNull()
        expect(bienvenida.roster).toHaveLength(1)
      }

      const publicado = await target.request(`${BASE}/api/party/rooms/${sala.roomId}/state`, {
        method: 'POST',
        headers: HOST,
        body: JSON.stringify({
          media: { kind: 'episode', title: 'Aurora', episode: 1 },
          positionS: 9,
          paused: true,
          rate: 1,
        }),
      })
      expect(publicado.status).toBe(204)

      const estadoEvento = await esperar(siguiente())
      expect(estadoEvento.type).toBe('state')
      if (estadoEvento.type === 'state') {
        expect(estadoEvento.state.positionS).toBe(9)
        expect(estadoEvento.state.paused).toBe(true)
      }
    } finally {
      controlador.abort()
      await reader.cancel().catch(() => undefined)
    }
  })
})
