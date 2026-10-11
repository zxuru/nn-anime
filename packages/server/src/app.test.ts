import { describe, expect, test } from 'bun:test'
import type { Hono } from 'hono'
import { type AppOptions, createApp } from './app'
import { SESSION_COOKIE, type Session } from './session'

const PORT = 7717
const BASE = `http://127.0.0.1:${PORT}`
const SESSION_VALUE = 'valor-de-sesion'
const BOOT_TOKEN = 'token-de-prueba'

function fakeSession(value = SESSION_VALUE): Session {
  return {
    cookieName: SESSION_COOKIE,
    value,
    matches: (candidate) => candidate === value,
  }
}

function app(overrides: Partial<AppOptions> = {}): Hono {
  return createApp({
    port: PORT,
    session: fakeSession(),
    bootToken: BOOT_TOKEN,
    version: '0.1.0',
    ...overrides,
  })
}

const GOOD_COOKIE = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}` }
const GOOD_ORIGIN = { origin: BASE, cookie: `${SESSION_COOKIE}=${SESSION_VALUE}` }

describe('host-guard', () => {
  test('acepta 127.0.0.1 con el puerto correcto', async () => {
    const response = await app().request(`${BASE}/api/health`, { headers: GOOD_COOKIE })

    expect(response.status).toBe(200)
  })

  test('**rechaza `localhost`**, aunque sea la misma máquina', async () => {
    // Antes se aceptaba, y no es lo mismo: las cookies ignoran el puerto, así que
    // otra aplicación local en `localhost:OTRO_PUERTO` es el mismo sitio para el
    // navegador. Sólo se admite la dirección que el arranque abre.
    const response = await app().request(`http://localhost:${PORT}/api/health`, {
      headers: GOOD_COOKIE,
    })

    expect(response.status).toBe(403)
  })

  test('rechaza un Host ajeno, que es el caso de DNS rebinding', async () => {
    const response = await app().request(`http://evil.example:${PORT}/api/health`, {
      headers: GOOD_COOKIE,
    })

    expect(response.status).toBe(403)
  })

  test('rechaza un Host con otro puerto', async () => {
    const response = await app().request('http://127.0.0.1:9999/api/health', {
      headers: GOOD_COOKIE,
    })

    expect(response.status).toBe(403)
  })

  test('rechaza un Host sin puerto', async () => {
    const response = await app().request('/api/health', { headers: GOOD_COOKIE })

    expect(response.status).toBe(403)
  })

  test('rechaza cuando el Host de la cabecera discrepa de la URL', async () => {
    const response = await app().request(`${BASE}/api/health`, {
      headers: { ...GOOD_COOKIE, host: 'evil.example' },
    })

    expect(response.status).toBe(403)
  })

  test('acepta cuando las dos fuentes coinciden', async () => {
    const response = await app().request(`${BASE}/api/health`, {
      headers: { ...GOOD_COOKIE, host: `127.0.0.1:${PORT}` },
    })

    expect(response.status).toBe(200)
  })

  test('el rechazo no lleva cuerpo útil', async () => {
    const response = await app().request(`http://evil.example:${PORT}/api/health`, {
      headers: GOOD_COOKIE,
    })

    expect(await response.text()).toBe('')
  })

  test('el guard también cubre /stream', async () => {
    const response = await app().request(`http://evil.example:${PORT}/stream/abc`, {
      headers: GOOD_COOKIE,
    })

    expect(response.status).toBe(403)
  })

  test('no toca las rutas fuera de /api y /stream', async () => {
    const response = await app().request('http://evil.example/otra/cosa')

    expect(response.status).not.toBe(403)
  })
})

describe('session-guard', () => {
  test('sin cookie devuelve 401', async () => {
    const response = await app().request(`${BASE}/api/health`)

    expect(response.status).toBe(401)
  })

  test('con una cookie ajena devuelve 401', async () => {
    const response = await app().request(`${BASE}/api/health`, {
      headers: { cookie: `${SESSION_COOKIE}=otra-cosa` },
    })

    expect(response.status).toBe(401)
  })

  test('con la cookie correcta deja pasar', async () => {
    const response = await app().request(`${BASE}/api/health`, { headers: GOOD_COOKIE })

    expect(response.status).toBe(200)
  })

  test('el cuerpo del 401 está vacío', async () => {
    const response = await app().request(`${BASE}/api/health`)

    expect(await response.text()).toBe('')
  })

  test('no hay ninguna vía de autenticación por query string', async () => {
    const response = await app().request(`${BASE}/api/health?t=${SESSION_VALUE}`)

    expect(response.status).toBe(401)
  })

  test('no acepta la cookie con otro nombre', async () => {
    const response = await app().request(`${BASE}/api/health`, {
      headers: { cookie: `otra_cookie=${SESSION_VALUE}` },
    })

    expect(response.status).toBe(401)
  })

  test('lee la cookie de sesión entre varias', async () => {
    const response = await app().request(`${BASE}/api/health`, {
      headers: { cookie: `otra=1; ${SESSION_COOKIE}=${SESSION_VALUE}; mas=2` },
    })

    expect(response.status).toBe(200)
  })
})

describe('origin-guard', () => {
  test('rechaza un método mutante sin Origin', async () => {
    const response = await app().request(`${BASE}/api/health`, {
      method: 'POST',
      headers: GOOD_COOKIE,
    })

    expect(response.status).toBe(403)
  })

  test('rechaza Origin null', async () => {
    const response = await app().request(`${BASE}/api/health`, {
      method: 'POST',
      headers: { ...GOOD_COOKIE, origin: 'null' },
    })

    expect(response.status).toBe(403)
  })

  test('rechaza un Origin ajeno', async () => {
    const response = await app().request(`${BASE}/api/health`, {
      method: 'POST',
      headers: { ...GOOD_COOKIE, origin: 'https://evil.example' },
    })

    expect(response.status).toBe(403)
  })

  test('deja pasar un método mutante con el Origin propio', async () => {
    const response = await app().request(`${BASE}/api/health`, {
      method: 'POST',
      headers: GOOD_ORIGIN,
    })

    expect(response.status).not.toBe(403)
  })

  test('no exige Origin en una lectura', async () => {
    const response = await app().request(`${BASE}/api/health`, { headers: GOOD_COOKIE })

    expect(response.status).toBe(200)
  })
})

describe('GET /api/health', () => {
  test('informa versión, puerto, mpv y proveedores', async () => {
    const response = await app({ mpvAvailable: true, version: '2.3.4' }).request(
      `${BASE}/api/health`,
      { headers: GOOD_COOKIE },
    )

    expect(await response.json()).toEqual({
      version: '2.3.4',
      port: PORT,
      mpv: true,
      providers: [],
    })
  })

  test('por defecto dice que no hay mpv', async () => {
    const response = await app().request(`${BASE}/api/health`, { headers: GOOD_COOKIE })

    expect(await response.json()).toMatchObject({ mpv: false })
  })

  test('exige sesión', async () => {
    const response = await app().request(`${BASE}/api/health`)

    expect(response.status).toBe(401)
  })
})

describe('tabla de rutas', () => {
  /** Convierte una ruta de Hono en una URL concreta. */
  function concrete(path: string): string {
    return `${BASE}${path.replace(/:[A-Za-z0-9_]+/g, 'x')}`
  }

  function protectedRoutes(target: Hono): readonly { path: string; method: string }[] {
    return target.routes
      .filter((route) => route.method !== 'ALL')
      .filter((route) => !route.path.includes('*'))
      .filter((route) => route.path.startsWith('/api/') || route.path.startsWith('/stream/'))
      .map((route) => ({ path: route.path, method: route.method }))
  }

  test('hay al menos una ruta protegida que comprobar', () => {
    expect(protectedRoutes(app()).length).toBeGreaterThan(0)
  })

  test('toda ruta protegida exige sesión', async () => {
    const target = app()

    for (const route of protectedRoutes(target)) {
      const response = await target.request(concrete(route.path), { method: route.method })

      expect(response.status, `${route.method} ${route.path} sin cookie`).toBe(401)
    }
  })

  test('toda ruta protegida rechaza un Host ajeno', async () => {
    const target = app()

    for (const route of protectedRoutes(target)) {
      const ajeno = concrete(route.path).replace('127.0.0.1', 'evil.example')
      const response = await target.request(ajeno, {
        method: route.method,
        headers: GOOD_COOKIE,
      })

      expect(response.status, `${route.method} ${route.path} con Host ajeno`).toBe(403)
    }
  })
})
