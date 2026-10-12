import { describe, expect, test } from 'bun:test'
import type { Hono } from 'hono'
import { type AppOptions, createApp } from './app'
import { CONTENT_SECURITY_POLICY, PERMISSIONS_POLICY } from './middleware/security-headers'
import { SESSION_COOKIE, type Session } from './session'

const PORT = 7717
const BASE = `http://127.0.0.1:${PORT}`
const BOOT_TOKEN = 'token-de-prueba'
const SESSION_VALUE = 'valor-de-sesion'

const REQUIRED_HEADERS: readonly string[] = [
  'content-security-policy',
  'x-content-type-options',
  'referrer-policy',
  'x-frame-options',
  'permissions-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'x-permitted-cross-domain-policies',
]

function fakeSession(value = SESSION_VALUE): Session {
  return { cookieName: SESSION_COOKIE, value, matches: (candidate) => candidate === value }
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

function missingHeaders(response: Response): readonly string[] {
  return REQUIRED_HEADERS.filter((name) => response.headers.get(name) === null)
}

describe('política de seguridad de contenido', () => {
  test('contiene todas las directivas del spec', () => {
    for (const directive of [
      "default-src 'self'",
      "img-src 'self'",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      // Las cuatro que cierran vías que `default-src` no cubre, o que cubriría
      // sin que nadie se enterara el día que se relaje.
      "frame-src 'none'",
      "worker-src 'none'",
      "manifest-src 'self'",
      "form-action 'self'",
      "base-uri 'none'",
      "object-src 'none'",
    ]) {
      expect(CONTENT_SECURITY_POLICY).toContain(directive)
    }
  })

  test('no permite scripts en línea', () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-inline'")
    expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'")
  })

  test('prohíbe enmarcar la aplicación', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'")
  })

  test('`form-action` no queda abierta a un origen ajeno', () => {
    // Sin esta directiva, `default-src` no la cubre y un formulario inyectado
    // puede mandar lo que haya en la página a donde quiera.
    expect(CONTENT_SECURITY_POLICY).toContain("form-action 'self'")
    expect(CONTENT_SECURITY_POLICY).not.toContain('form-action *')
  })

  test('la política de permisos cierra cámara, micrófono y geolocalización', () => {
    for (const permiso of ['camera=()', 'microphone=()', 'geolocation=()']) {
      expect(PERMISSIONS_POLICY).toContain(permiso)
    }
  })
})

describe('cabeceras presentes en toda respuesta', () => {
  test('en una ruta de la API con sesión', async () => {
    const response = await app().request(`${BASE}/api/health`, { headers: GOOD_COOKIE })

    expect(missingHeaders(response)).toEqual([])
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY)
  })

  test('en el canje de arranque, que es una redirección', async () => {
    const response = await app().request(`${BASE}/?boot=${BOOT_TOKEN}`)

    expect(response.status).toBe(302)
    expect(missingHeaders(response)).toEqual([])
  })

  test('en un rechazo por falta de sesión', async () => {
    const response = await app().request(`${BASE}/api/health`)

    expect(response.status).toBe(401)
    expect(missingHeaders(response)).toEqual([])
  })

  test('en un rechazo por Host ajeno', async () => {
    const response = await app().request(`http://evil.example:${PORT}/api/health`, {
      headers: GOOD_COOKIE,
    })

    expect(response.status).toBe(403)
    expect(missingHeaders(response)).toEqual([])
  })

  test('en un rechazo por Origin ajeno', async () => {
    const response = await app().request(`${BASE}/api/health`, {
      method: 'POST',
      headers: { ...GOOD_COOKIE, origin: 'https://evil.example' },
    })

    expect(response.status).toBe(403)
    expect(missingHeaders(response)).toEqual([])
  })

  test('en una ruta que no existe', async () => {
    const response = await app().request(`${BASE}/no-existe`)

    expect(missingHeaders(response)).toEqual([])
  })
})

describe('CORS', () => {
  test('ninguna respuesta abre el acceso a otro origen', async () => {
    const target = app()
    const responses = [
      await target.request(`${BASE}/api/health`, { headers: GOOD_COOKIE }),
      await target.request(`${BASE}/api/health`),
      await target.request(`${BASE}/api/health`, {
        headers: { ...GOOD_COOKIE, origin: 'https://evil.example' },
      }),
      await target.request(`${BASE}/?boot=${BOOT_TOKEN}`),
      await target.request(`${BASE}/no-existe`),
    ]

    for (const response of responses) {
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    }
  })

  test('no se emite la cabecera aunque el origen sea el propio', async () => {
    const response = await app().request(`${BASE}/api/health`, {
      headers: { ...GOOD_COOKIE, origin: BASE },
    })

    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('tabla de rutas', () => {
  function protectedRoutes(target: Hono): readonly { path: string; method: string }[] {
    return target.routes
      .filter((route) => route.method !== 'ALL')
      .filter((route) => !route.path.includes('*'))
      .map((route) => ({ path: route.path, method: route.method }))
  }

  test('toda ruta registrada lleva todas las cabeceras', async () => {
    const target = app()
    const routes = protectedRoutes(target)

    expect(routes.length).toBeGreaterThan(0)

    for (const route of routes) {
      const concrete = `${BASE}${route.path.replace(/:[A-Za-z0-9_]+/g, 'x')}`
      const response = await target.request(concrete, {
        method: route.method,
        headers: GOOD_COOKIE,
      })

      expect(missingHeaders(response), `${route.method} ${route.path}`).toEqual([])
    }
  })
})
