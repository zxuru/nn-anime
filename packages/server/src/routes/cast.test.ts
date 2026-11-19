import { describe, expect, test } from 'bun:test'
import type { Hono } from 'hono'
import { type AppOptions, createApp } from '../app'
import { SESSION_COOKIE, type Session } from '../session'

const PORT = 7717
const BASE = `http://127.0.0.1:${PORT}`
const SESSION_VALUE = 'sesion-de-cast'
const GOOD_COOKIE = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}` }

function fakeSession(): Session {
  return {
    cookieName: SESSION_COOKIE,
    value: SESSION_VALUE,
    matches: (candidate) => candidate === SESSION_VALUE,
  }
}

function app(cast: AppOptions['cast']): Hono {
  return createApp({
    port: PORT,
    session: fakeSession(),
    bootToken: 'token-de-prueba',
    version: '0.1.0',
    cast,
  })
}

async function leer(servidor: Hono, init?: RequestInit): Promise<Response> {
  return await servidor.request(`${BASE}/api/cast/info`, {
    ...init,
    headers: { ...GOOD_COOKIE, ...(init?.headers ?? {}) },
  })
}

describe('GET /api/cast/info', () => {
  test('apagado: dice que no y no enumera direcciones', async () => {
    const respuesta = await leer(app({ enabled: false, host: '0.0.0.0', token: true }))

    expect(respuesta.status).toBe(200)
    expect(respuesta.headers.get('cache-control')).toBe('no-store')
    expect(await respuesta.json()).toEqual({
      available: false,
      urls: [],
      reason: 'disabled',
    })
  })

  test('en loopback no hay nada que una TV pueda alcanzar', async () => {
    const respuesta = await leer(app({ enabled: true, host: '127.0.0.1', token: true }))

    expect(await respuesta.json()).toEqual({
      available: false,
      urls: [],
      reason: 'loopback',
    })
  })

  test('sin token no se abre una LAN', async () => {
    const respuesta = await leer(app({ enabled: true, host: '0.0.0.0', token: false }))

    expect(await respuesta.json()).toEqual({
      available: false,
      urls: [],
      reason: 'no-token',
    })
  })

  test('con LAN y token da las direcciones y no inventa loopback', async () => {
    const respuesta = await leer(
      app({
        enabled: true,
        host: '0.0.0.0',
        token: true,
        urls: (port) => [`http://192.168.1.10:${port}`, `http://127.0.0.1:${port}`],
      }),
    )

    expect(await respuesta.json()).toEqual({
      available: true,
      urls: [`http://192.168.1.10:${PORT}`],
    })
  })

  test('si no hay ninguna dirección útil, lo dice en vez de ofrecer loopback', async () => {
    const respuesta = await leer(
      app({
        enabled: true,
        host: '0.0.0.0',
        token: true,
        urls: (port) => [`http://127.0.0.1:${port}`],
      }),
    )

    expect(await respuesta.json()).toEqual({
      available: false,
      urls: [],
      reason: 'no-address',
    })
  })

  test('la ruta exige la sesión normal', async () => {
    const respuesta = await app({
      enabled: true,
      host: '0.0.0.0',
      token: true,
      urls: () => ['http://192.168.1.10:7717'],
    }).request(`${BASE}/api/cast/info`)

    expect(respuesta.status).toBe(401)
  })
})
