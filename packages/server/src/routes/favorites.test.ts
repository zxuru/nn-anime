import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import { favoritesResponseSchema } from '@nn-anime/core'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { createApp, createContainer } from '../index'

const PORT = 7717
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }
const JSON_HEADERS = { ...GOOD, 'content-type': 'application/json' }

const AURORA = { providerId: 'fixture', value: 'aurora-nocturna' }

async function conApp<T>(
  body: (contexto: {
    pedir: (ruta: string, init?: RequestInit) => Promise<Response>
    db: ReturnType<typeof openDb>
  }) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-favoritos-'))
  const db = openDb(join(dir, 'nn-anime.db'))
  runMigrations(db)
  const container = createContainer({ db })
  const proveedor = createFixtureProvider()

  try {
    const servidor = createApp({
      port: PORT,
      session: {
        cookieName: SESSION_COOKIE,
        value: SESSION_VALUE,
        matches: (candidate) => candidate === SESSION_VALUE,
      },
      bootToken: 'token',
      version: '0.1.0',
      plugins: { active: [{ provider: proveedor, file: '/plugins/fixture.ts' }], rejected: [] },
      container,
    })

    return await body({
      pedir: async (ruta, init) =>
        await Promise.resolve(servidor.request(`${BASE}${ruta}`, init ?? { headers: GOOD })),
      db,
    })
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

async function conDetalle(pedir: (ruta: string, init?: RequestInit) => Promise<Response>) {
  return pedir(`/api/anime/fixture/aurora-nocturna`, { headers: GOOD })
}

describe('favoritos', () => {
  test('sin nada marcado, la lista está vacía', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/favorites')

      expect(respuesta.status).toBe(200)
      expect(await respuesta.json()).toEqual({ favorites: [] })
    })
  })

  test('marcar y leer: el título sale con su portada y su año', async () => {
    await conApp(async ({ pedir }) => {
      await conDetalle(pedir)
      const alta = await pedir('/api/favorites', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ref: AURORA, value: true }),
      })

      expect(alta.status).toBe(204)

      const lista = favoritesResponseSchema.parse(await (await pedir('/api/favorites')).json())
      expect(lista.favorites).toHaveLength(1)
      expect(lista.favorites[0]?.title).toBe('Aurora Nocturna')
      expect(lista.favorites[0]?.year).toBe(2019)
      expect(lista.favorites[0]?.coverUrl).toContain('fixture.invalid')
    })
  })

  test('marcar dos veces no duplica ni falla', async () => {
    await conApp(async ({ pedir, db }) => {
      await conDetalle(pedir)
      const cuerpo = JSON.stringify({ ref: AURORA, value: true })

      const primera = await pedir('/api/favorites', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: cuerpo,
      })
      const segunda = await pedir('/api/favorites', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: cuerpo,
      })

      expect([primera.status, segunda.status]).toEqual([204, 204])
      const filas = db.query('SELECT COUNT(*) AS total FROM favorite').get() as { total: number }
      expect(filas.total).toBe(1)
    })
  })

  test('desmarcar lo saca de la lista', async () => {
    await conApp(async ({ pedir }) => {
      await conDetalle(pedir)
      await pedir('/api/favorites', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ref: AURORA, value: true }),
      })
      await pedir('/api/favorites', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ref: AURORA, value: false }),
      })

      expect(await (await pedir('/api/favorites')).json()).toEqual({ favorites: [] })
    })
  })

  test('marcar un título que no está es 404, no 500', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/favorites', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ref: { providerId: 'fixture', value: 'no-existe' }, value: true }),
      })

      expect(respuesta.status).toBe(404)
      expect(JSON.stringify(await respuesta.json())).toContain('no está')
    })
  })

  test('un cuerpo inválido es 400', async () => {
    await conApp(async ({ pedir }) => {
      const sinValue = await pedir('/api/favorites', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ref: AURORA }),
      })
      const noJson = await pedir('/api/favorites', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: 'esto no es json',
      })

      expect([sinValue.status, noJson.status]).toEqual([400, 400])
    })
  })

  test('las dos exigen sesión', async () => {
    await conApp(async ({ pedir }) => {
      const lista = await pedir('/api/favorites', { headers: {} })
      // Sin `Origin` y siendo un método que muta, el guard de origen corta antes
      // que el de sesión: 403. Con `Origin` correcto pero sin cookie, 401.
      const sinOrigen = await pedir('/api/favorites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref: AURORA, value: true }),
      })
      const sinSesion = await pedir('/api/favorites', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ ref: AURORA, value: true }),
      })

      expect([lista.status, sinOrigen.status, sinSesion.status]).toEqual([401, 403, 401])
    })
  })
})
