import { describe, expect, test } from 'bun:test'
import { type AppOptions, createApp } from './app'
import { BOOT_TTL_MS } from './bootstrap'
import { createBootToken, createSession, SESSION_COOKIE, type Session, safeEqual } from './session'

const PORT = 7717
const BASE = `http://127.0.0.1:${PORT}`

function makeSession(): Session {
  return createSession()
}

function app(session: Session, bootToken: string, overrides: Partial<AppOptions> = {}) {
  return createApp({ port: PORT, session, bootToken, version: '0.1.0', ...overrides })
}

describe('createSession', () => {
  test('cada llamada produce un valor distinto', () => {
    expect(createSession().value).not.toBe(createSession().value)
  })

  test('el valor tiene al menos 32 bytes de entropía en base64url', () => {
    const value = createSession().value

    expect(value.length).toBeGreaterThanOrEqual(43)
    expect(value).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  test('reconoce su propio valor y rechaza cualquier otro', () => {
    const session = createSession()

    expect(session.matches(session.value)).toBe(true)
    expect(session.matches('otra-cosa')).toBe(false)
  })

  test('rechaza undefined y la cadena vacía', () => {
    const session = createSession()

    expect(session.matches(undefined)).toBe(false)
    expect(session.matches('')).toBe(false)
  })

  test('el nombre de la cookie es el del spec', () => {
    expect(createSession().cookieName).toBe(SESSION_COOKIE)
  })
})

describe('createBootToken', () => {
  test('cada llamada produce un token distinto', () => {
    expect(createBootToken()).not.toBe(createBootToken())
  })

  test('el token es largo y seguro para una URL', () => {
    const token = createBootToken()

    expect(token.length).toBeGreaterThanOrEqual(43)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('safeEqual', () => {
  test('acepta dos cadenas iguales', () => {
    expect(safeEqual('secreto', 'secreto')).toBe(true)
  })

  test('rechaza dos cadenas distintas', () => {
    expect(safeEqual('secreto', 'secreta')).toBe(false)
  })

  test('rechaza longitudes distintas sin lanzar', () => {
    expect(() => safeEqual('a', 'aaaaaaaa')).not.toThrow()
    expect(safeEqual('a', 'aaaaaaaa')).toBe(false)
  })

  test('rechaza undefined sin lanzar', () => {
    expect(safeEqual(undefined, 'secreto')).toBe(false)
    expect(safeEqual('secreto', undefined)).toBe(false)
    expect(safeEqual(undefined, undefined)).toBe(false)
  })

  test('rechaza la cadena vacía contra un secreto', () => {
    expect(safeEqual('', 'secreto')).toBe(false)
  })
})

describe('canje del token de arranque', () => {
  test('con el token correcto redirige a la raíz', async () => {
    const bootToken = createBootToken()
    const response = await app(makeSession(), bootToken).request(`${BASE}/?boot=${bootToken}`)

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/')
  })

  test('emite la cookie de sesión con HttpOnly, SameSite=Strict y Path=/', async () => {
    const bootToken = createBootToken()
    const session = makeSession()
    const response = await app(session, bootToken).request(`${BASE}/?boot=${bootToken}`)

    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${SESSION_COOKIE}=${session.value}`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie.toLowerCase()).toContain('samesite=strict')
    expect(cookie).toContain('Path=/')
  })

  test('no marca la cookie como Secure, porque se sirve por http en loopback', async () => {
    const bootToken = createBootToken()
    const response = await app(makeSession(), bootToken).request(`${BASE}/?boot=${bootToken}`)

    expect(response.headers.get('set-cookie') ?? '').not.toContain('Secure')
  })

  test('el token de arranque no aparece en la respuesta', async () => {
    const bootToken = createBootToken()
    const response = await app(makeSession(), bootToken).request(`${BASE}/?boot=${bootToken}`)

    expect(await response.text()).not.toContain(bootToken)
    expect(response.headers.get('set-cookie') ?? '').not.toContain(bootToken)
  })

  test('un segundo uso del mismo token devuelve 401', async () => {
    const bootToken = createBootToken()
    const target = app(makeSession(), bootToken)

    const first = await target.request(`${BASE}/?boot=${bootToken}`)
    const second = await target.request(`${BASE}/?boot=${bootToken}`)

    expect(first.status).toBe(302)
    expect(second.status).toBe(401)
  })

  test('un token distinto devuelve 401 y no emite cookie', async () => {
    const response = await app(makeSession(), createBootToken()).request(`${BASE}/?boot=otro`)

    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  test('un token de otra longitud devuelve 401 sin lanzar', async () => {
    const response = await app(makeSession(), createBootToken()).request(`${BASE}/?boot=a`)

    expect(response.status).toBe(401)
  })

  test('el token vacío devuelve 401', async () => {
    const response = await app(makeSession(), createBootToken()).request(`${BASE}/?boot=`)

    expect(response.status).toBe(401)
  })

  test('sin el parámetro boot no intercepta la raíz', async () => {
    const bootToken = createBootToken()
    const response = await app(makeSession(), bootToken).request(`${BASE}/`)

    expect(response.status).not.toBe(401)
    expect(response.status).not.toBe(302)
  })

  test('dos arranques producen tokens y sesiones distintos', async () => {
    const firstBoot = createBootToken()
    const secondBoot = createBootToken()
    const firstSession = makeSession()
    const secondSession = makeSession()

    const firstResponse = await app(firstSession, firstBoot).request(`${BASE}/?boot=${firstBoot}`)
    const secondResponse = await app(secondSession, secondBoot).request(
      `${BASE}/?boot=${secondBoot}`,
    )

    expect(firstBoot).not.toBe(secondBoot)
    expect(firstSession.value).not.toBe(secondSession.value)
    expect(firstResponse.headers.get('set-cookie')).not.toBe(
      secondResponse.headers.get('set-cookie'),
    )
  })
})

describe('caducidad del token de arranque', () => {
  test('dentro del plazo se puede canjear', async () => {
    const bootToken = createBootToken()
    let clock = 1_000_000
    const target = createApp({
      port: PORT,
      session: makeSession(),
      bootToken,
      version: '0.1.0',
      bootstrapClock: () => clock,
    })

    clock += 60_000
    const response = await target.request(`${BASE}/?boot=${bootToken}`)

    expect(response.status).toBe(302)
  })

  test('pasado el plazo devuelve 401 y no emite cookie', async () => {
    const bootToken = createBootToken()
    let clock = 1_000_000
    const target = createApp({
      port: PORT,
      session: makeSession(),
      bootToken,
      version: '0.1.0',
      bootstrapClock: () => clock,
    })

    clock += 10 * 60 * 1000
    const response = await target.request(`${BASE}/?boot=${bootToken}`)

    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  test('justo en el límite todavía vale', async () => {
    const bootToken = createBootToken()
    let clock = 1_000_000
    const target = createApp({
      port: PORT,
      session: makeSession(),
      bootToken,
      version: '0.1.0',
      bootstrapClock: () => clock,
    })

    clock += BOOT_TTL_MS
    const response = await target.request(`${BASE}/?boot=${bootToken}`)

    expect(response.status).toBe(302)
  })

  test('un token caducado no se puede canjear ni aunque nadie lo haya usado', async () => {
    const bootToken = createBootToken()
    let clock = 5_000_000
    const target = createApp({
      port: PORT,
      session: makeSession(),
      bootToken,
      version: '0.1.0',
      bootstrapClock: () => clock,
    })

    clock += BOOT_TTL_MS + 1
    expect((await target.request(`${BASE}/?boot=${bootToken}`)).status).toBe(401)
    expect((await target.request(`${BASE}/?boot=${bootToken}`)).status).toBe(401)
  })
})

describe('sesión emitida por el canje', () => {
  test('la cookie emitida sirve para entrar en la API', async () => {
    const bootToken = createBootToken()
    const session = makeSession()
    const target = app(session, bootToken)

    const response = await target.request(`${BASE}/api/health`, {
      headers: { cookie: `${SESSION_COOKIE}=${session.value}` },
    })

    expect(response.status).toBe(200)
  })

  test('una cookie distinta no sirve', async () => {
    const target = app(makeSession(), createBootToken())

    const response = await target.request(`${BASE}/api/health`, {
      headers: { cookie: `${SESSION_COOKIE}=inventada` },
    })

    expect(response.status).toBe(401)
  })
})
