import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import type { Hono } from 'hono'
import { type AppOptions, createApp } from './app'
import { createContainer } from './container'
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

  test('cubre también lo que no cuelga de /api ni de /stream, empezando por `/`', async () => {
    // El guard no lee cookies ni estado: montarlo sobre `*` no cuesta nada, y un
    // guard que se salta una ruta deja de ser un guard. Antes se saltaba `/`, que
    // es donde vive el canje de arranque.
    for (const ruta of ['/', '/otra/cosa', `/?boot=${BOOT_TOKEN}`]) {
      const response = await app().request(`http://evil.example${ruta}`)

      expect(response.status, ruta).toBe(403)
    }
  })

  test('el canje de arranque con el Host correcto sigue entrando', async () => {
    const response = await app().request(`${BASE}/?boot=${BOOT_TOKEN}`)

    expect(response.status).toBe(302)
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

  test('**rechaza el Origin de `localhost`**, el mismo nombre que rechaza el guard de Host', async () => {
    // Las cookies ignoran el puerto: una página servida por otra aplicación
    // local en `localhost:OTRO_PUERTO` comparte sitio con ésta. Aceptarlo aquí
    // era código muerto que decía lo contrario de lo que hace el proyecto.
    const response = await app().request(`${BASE}/api/health`, {
      method: 'POST',
      headers: { ...GOOD_COOKIE, origin: `http://localhost:${PORT}` },
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

describe('modo servidor: Host y Origin declarados', () => {
  const NETWORK = {
    extraHosts: ['nas.local:7717'],
    allowAnyHost: false,
    extraOrigins: ['https://nas.local'],
    sameOrigin: true,
  } as const

  test('acepta el host declarado además del loopback', async () => {
    const response = await app({ network: NETWORK }).request('http://nas.local:7717/api/health', {
      headers: GOOD_COOKIE,
    })

    expect(response.status).toBe(200)
  })

  test('sigue rechazando un host que no está en la lista', async () => {
    const response = await app({ network: NETWORK }).request(
      'http://evil.example:7717/api/health',
      { headers: GOOD_COOKIE },
    )

    expect(response.status).toBe(403)
  })

  test('sin origen público se acepta cualquier Host, pero la cabecera y la URL tienen que coincidir', async () => {
    const target = app({
      network: { extraHosts: [], allowAnyHost: true, extraOrigins: [], sameOrigin: true },
    })

    expect(
      (await target.request('http://cualquiera.example:7717/api/health', { headers: GOOD_COOKIE }))
        .status,
    ).toBe(200)

    // Mismo escenario con una cabecera fabricada que no coincide con la URL.
    expect(
      (
        await target.request(`${BASE}/api/health`, {
          headers: { ...GOOD_COOKIE, host: 'otro.example' },
        })
      ).status,
    ).toBe(403)
  })

  test('un origen exacto declarado pasa el guard aunque el Host sea loopback', async () => {
    const response = await app({ network: NETWORK }).request(`${BASE}/api/health`, {
      method: 'POST',
      headers: { ...GOOD_COOKIE, origin: 'https://nas.local' },
    })

    expect(response.status).not.toBe(403)
  })

  test('un origen con el mismo host de la petición pasa', async () => {
    const response = await app({ network: NETWORK }).request('http://nas.local:7717/api/health', {
      method: 'POST',
      headers: { ...GOOD_COOKIE, host: 'nas.local:7717', origin: 'http://nas.local:7717' },
    })

    expect(response.status).not.toBe(403)
  })

  test('un origen ajeno sigue siendo 403', async () => {
    const response = await app({ network: NETWORK }).request(`${BASE}/api/health`, {
      method: 'POST',
      headers: { ...GOOD_COOKIE, origin: 'https://evil.example' },
    })

    expect(response.status).toBe(403)
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
  /**
   * La aplicación **con todo montado**.
   *
   * La tabla tiene que recorrer las rutas de verdad, no las que quedan cuando no
   * hay base ni carpeta de datos: con la aplicación a medias, las rutas que
   * dependen del contenedor —las de metadatos y las de repositorios— no existirían
   * y la tabla diría que todo está cubierto sin haberlas mirado.
   */
  async function conRutas<T>(
    body: (target: Hono) => Promise<T>,
    options: { readonly locked?: boolean } = {},
  ): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'nn-anime-rutas-'))
    const db = openDb(join(dir, 'nn-anime.db'))
    runMigrations(db)
    const container = createContainer({ db })

    try {
      return await body(
        app({
          container,
          providersDir: join(dir, 'providers'),
          locked: options.locked ?? false,
          paths: {
            dataDir: dir,
            configDir: dir,
            cacheDir: join(dir, 'cache'),
            providersDir: join(dir, 'providers'),
            dbPath: join(dir, 'nn-anime.db'),
            configFile: join(dir, 'nn-anime.json'),
          },
        }),
      )
    } finally {
      await container.close().catch(() => {})
      await rm(dir, { recursive: true, force: true })
    }
  }

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

  test('hay al menos una ruta protegida que comprobar', async () => {
    await conRutas(async (target) => {
      expect(protectedRoutes(target).length).toBeGreaterThan(0)
    })
  })

  test('las rutas de repositorios están en la tabla', async () => {
    await conRutas(async (target) => {
      const rutas = protectedRoutes(target).filter((route) => route.path === '/api/provider-repos')

      // Las cuatro, y por prefijo protegido: si alguna se registrara fuera de
      // `/api/`, esta prueba es la que lo dice.
      expect(rutas.map((route) => route.method).sort()).toEqual(['DELETE', 'GET', 'PATCH', 'POST'])
    })
  })

  test('en modo restringido no se registran las mutaciones de plugins', async () => {
    await conRutas(
      async (target) => {
        const rutas = protectedRoutes(target)

        expect(
          rutas
            .filter((route) => route.path === '/api/provider-repos')
            .map((route) => route.method)
            .sort(),
        ).toEqual(['GET'])
        expect(
          rutas.some((route) => route.path === '/api/providers' && route.method !== 'GET'),
        ).toBe(false)
        expect(rutas.some((route) => route.path.startsWith('/api/play/mpv'))).toBe(false)
      },
      { locked: true },
    )
  })

  test('en modo restringido la salud y la lista de repositorios siguen accesibles', async () => {
    await conRutas(
      async (target) => {
        expect(
          (await target.request(`${BASE}/api/provider-repos`, { headers: GOOD_COOKIE })).status,
        ).toBe(200)

        const settings = await target.request(`${BASE}/api/settings`, { headers: GOOD_COOKIE })
        expect(((await settings.json()) as { locked: boolean }).locked).toBe(true)
      },
      { locked: true },
    )
  })

  test('toda ruta protegida exige sesión', async () => {
    await conRutas(async (target) => {
      for (const route of protectedRoutes(target)) {
        // El `Origin` va puesto aunque no haya cookie: sin él, un método mutante
        // lo corta antes el guard de Origin con un 403, y esta prueba estaría
        // midiendo el otro guard.
        const response = await target.request(concrete(route.path), {
          method: route.method,
          headers: { origin: BASE },
        })

        expect(response.status, `${route.method} ${route.path} sin cookie`).toBe(401)
      }
    })
  })

  test('toda ruta protegida rechaza un Host ajeno', async () => {
    await conRutas(async (target) => {
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
})
