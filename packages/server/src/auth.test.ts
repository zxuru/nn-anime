import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import type { Hono } from 'hono'
import { type AppOptions, createApp } from './app'
import { LOGIN_PATH } from './auth'
import { createContainer } from './container'
import { createTokenSession, SESSION_COOKIE } from './session'

const PORT = 7717
const BASE = `http://127.0.0.1:${PORT}`
const TOKEN = 'token-de-servidor-suficientemente-largo'
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`

function app(overrides: Partial<AppOptions> = {}): Hono {
  return createApp({
    port: PORT,
    auth: { token: TOKEN, secureCookie: false },
    bootToken: 'token-de-arranque',
    version: '0.1.0',
    ...overrides,
  })
}

describe('la salud es pública y no cuenta nada', () => {
  test('GET /healthz responde sin cookie', async () => {
    const response = await app().request(`${BASE}/healthz`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('la salud no lleva versión, rutas ni proveedores', async () => {
    const body = await (await app().request(`${BASE}/healthz`)).text()

    expect(body).not.toContain('0.1.0')
    expect(body).not.toContain('/data')
    expect(body).not.toContain('providers')
  })
})

describe('sin cookie no se pasa', () => {
  test('la API responde 401 vacío', async () => {
    for (const path of ['/api/health', '/api/settings', '/api/providers']) {
      const response = await app().request(`${BASE}${path}`)

      expect(response.status, path).toBe(401)
      expect(await response.text(), path).toBe('')
    }
  })

  test('los estáticos también, aunque el modo local los deje pasar', async () => {
    for (const path of ['/assets/app.js', '/SECURITY.md']) {
      const response = await app().request(`${BASE}${path}`)

      expect(response.status, path).toBe(401)
      expect(await response.text(), path).toBe('')
    }
  })

  test('una navegación recibe el formulario con el 401, no la interfaz', async () => {
    const response = await app().request(`${BASE}/`, {
      headers: { accept: 'text/html,application/xhtml+xml' },
    })
    const body = await response.text()

    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(body).toContain('name="token"')
    expect(body).not.toContain('id="root"')
  })
})

describe('el formulario de login', () => {
  test('GET /login sirve el formulario sin cookie', async () => {
    const response = await app().request(`${BASE}${LOGIN_PATH}`)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain('type="password"')
    expect(body).toContain('name="token"')
  })

  test('un token incorrecto es 401 y no emite cookie', async () => {
    const response = await app().request(`${BASE}${LOGIN_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'token=no-es-el-token',
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await response.text()).toContain('Token incorrecto')
  })

  test('un token correcto pone la cookie y redirige a la interfaz', async () => {
    const response = await app().request(`${BASE}${LOGIN_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `token=${TOKEN}`,
    })
    const cookie = response.headers.get('set-cookie') ?? ''

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
    expect(cookie).toContain(`${SESSION_COOKIE}=${TOKEN}`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    // Sin origen https declarado no se marca Secure: marcarla obligaría al
    // navegador a descartarla sobre http y no habría sesión.
    expect(cookie).not.toContain('Secure')
  })

  test('con origen https la cookie lleva Secure', async () => {
    const response = await app({
      auth: { token: TOKEN, secureCookie: true },
    }).request(`${BASE}${LOGIN_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `token=${TOKEN}`,
    })

    expect(response.headers.get('set-cookie')).toContain('Secure')
  })

  test('con la cookie puesta, la API y la salud dejan pasar', async () => {
    const target = app()

    expect(
      (await target.request(`${BASE}/api/health`, { headers: { cookie: COOKIE } })).status,
    ).toBe(200)
    expect(
      (await target.request(`${BASE}/api/providers`, { headers: { cookie: COOKIE } })).status,
    ).toBe(200)
  })

  test('GET /login con una sesión válida vuelve a la interfaz', async () => {
    const response = await app().request(`${BASE}${LOGIN_PATH}`, {
      headers: { cookie: COOKIE },
    })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
  })

  test('el `?boot=` del modo local no autentica en modo token', async () => {
    const response = await app().request(`${BASE}/?boot=${TOKEN}`)

    expect(response.status).toBe(401)
  })
})

describe('el ticket del proxy sigue siendo credencial sin cookie', () => {
  test('un ticket vivo pasa el guard; uno inventado no', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nn-anime-auth-'))
    const db = openDb(join(dir, 'nn-anime.db'))
    runMigrations(db)
    const container = createContainer({ db })

    try {
      const target = app({ container })
      const ticket = container.tickets.issue({ url: 'http://127.0.0.1:22/', headers: {} })

      const conTicket = await target.request(`${BASE}/stream/${ticket}`)
      const inventado = await target.request(`${BASE}/stream/inventado`)

      // El guard deja pasar el ticket; el proxy de destinos lo rechaza después.
      // Lo que se mide es que el 401 no aparece para el ticket vivo.
      expect(conTicket.status).not.toBe(401)
      expect(inventado.status).toBe(401)
    } finally {
      await container.close().catch(() => {})
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('createTokenSession', () => {
  test('compara en tiempo constante y sin lanzar por longitudes distintas', () => {
    const session = createTokenSession(TOKEN)

    expect(session.matches(TOKEN)).toBe(true)
    expect(session.matches('otro')).toBe(false)
    expect(session.matches(undefined)).toBe(false)
    expect(session.value).toBe(TOKEN)
  })
})
