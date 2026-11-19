import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@rona/catalog-store'
import { castSessionResponseSchema, streamResolveResponseSchema } from '@rona/core'
import { createFixtureProvider } from '@rona/providers-fixture'
import { type AppOptions, createApp } from '../app'
import type { ServerContainer } from '../container'
import { createContainer } from '../container'
import { SESSION_COOKIE, type Session } from '../session'

const PORT = 7717
const BASE = `http://127.0.0.1:${PORT}`
const SESSION_VALUE = 'sesion-de-cast'
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }
const JSON_HEADERS = { ...GOOD, 'content-type': 'application/json' }
const PETICION = {
  episodeRef: { providerId: 'fixture', value: 'aurora-nocturna#1' },
  mode: 'sub' as const,
  title: 'Aurora nocturna',
}

function fakeSession(): Session {
  return {
    cookieName: SESSION_COOKIE,
    value: SESSION_VALUE,
    matches: (candidate) => candidate === SESSION_VALUE,
  }
}

interface Contexto {
  readonly pedir: (ruta: string, init?: RequestInit) => Promise<Response>
  readonly pedirSinSesion: (ruta: string, init?: RequestInit) => Promise<Response>
  readonly container: ServerContainer
}

interface Opciones {
  readonly cast?: AppOptions['cast']
}

async function conApp<T>(
  body: (contexto: Contexto) => Promise<T>,
  opciones: Opciones = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'rona-cast-'))
  const db = openDb(join(dir, 'rona.db'))
  runMigrations(db)
  const container = createContainer({ db })
  const proveedor = createFixtureProvider()

  try {
    const servidor = createApp({
      port: PORT,
      session: fakeSession(),
      bootToken: 'token',
      version: '0.1.0',
      plugins: { active: [{ provider: proveedor, file: '/plugins/fixture.ts' }], rejected: [] },
      container,
      streamFetchImpl: async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        }),
      streamResolver: async () => ['93.184.216.34'],
      cast: opciones.cast ?? {
        enabled: true,
        host: '0.0.0.0',
        token: true,
        urls: () => [`http://192.168.1.10:${PORT}`],
      },
    })

    return await body({
      pedir: async (ruta, init) =>
        await Promise.resolve(
          servidor.request(`${BASE}${ruta}`, {
            ...init,
            headers: { ...GOOD, ...(init?.headers ?? {}) },
          }),
        ),
      pedirSinSesion: async (ruta, init) =>
        await Promise.resolve(servidor.request(`${BASE}${ruta}`, init ?? {})),
      container,
    })
  } finally {
    await container.close()
    await rm(dir, { recursive: true, force: true })
  }
}

describe('POST /api/cast/session', () => {
  test('resuelve el stream, emite el ticket y lo revoca', async () => {
    await conApp(async ({ pedir, pedirSinSesion, container }) => {
      const alta = await pedir('/api/cast/session', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(PETICION),
      })

      expect(alta.status).toBe(200)
      expect(alta.headers.get('cache-control')).toBe('no-store')

      const emision = castSessionResponseSchema.parse(await alta.json())
      expect(emision.title).toBe('Aurora nocturna')
      expect(emision.urls).toHaveLength(1)
      expect(emision.urls[0]).toStartWith(`http://192.168.1.10:${PORT}/stream/`)

      const ruta = new URL(emision.urls[0] ?? '').pathname
      const ticket = ruta.split('/')[2] ?? ''
      expect(container.castTickets.resolve(ticket).ok).toBe(true)

      // La TV no lleva cookie: el ticket es la credencial.
      const bytes = await pedirSinSesion(ruta)
      expect(bytes.status).toBe(200)
      expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))

      const fuera = await pedir(`/api/cast/session/${emision.id}`, { method: 'DELETE' })
      expect(fuera.status).toBe(204)
      expect(container.castTickets.resolve(ticket).ok).toBe(false)

      // Sin cookie ya no pasa el guard; con cookie la ruta dice que no existe.
      expect((await pedirSinSesion(ruta)).status).toBe(401)
      expect((await pedir(ruta)).status).toBe(404)
    })
  })

  test('acepta el ticket que ya usa el reproductor, no una URL', async () => {
    await conApp(async ({ pedir }) => {
      const resolucion = await pedir('/api/stream/resolve', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ episodeRef: PETICION.episodeRef, mode: PETICION.mode }),
      })
      const texto = await resolucion.text()
      expect(resolucion.status, texto).toBe(200)
      const fuente = streamResolveResponseSchema.parse(JSON.parse(texto)).sources[0]

      expect(fuente).toBeDefined()

      const alta = await pedir('/api/cast/session', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          url: fuente?.url,
          kind: fuente?.kind,
          title: 'Aurora nocturna',
        }),
      })

      expect(alta.status).toBe(200)
      expect(castSessionResponseSchema.parse(await alta.json()).urls[0]).toContain('/stream/')

      const arbitraria = await pedir('/api/cast/session', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ url: 'https://evil.example/x', kind: 'file' }),
      })
      expect(arbitraria.status).toBe(400)
    })
  })

  test('sin RONA_CAST, sin LAN o sin token no emite nada', async () => {    const casos = [
      { enabled: false, host: '0.0.0.0', token: true },
      { enabled: true, host: '127.0.0.1', token: true },
      { enabled: true, host: '0.0.0.0', token: false },
      { enabled: true, host: '0.0.0.0', token: true, urls: () => [] },
    ]

    for (const cast of casos) {
      await conApp(
        async ({ pedir }) => {
          const respuesta = await pedir('/api/cast/session', {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify(PETICION),
          })

          expect(respuesta.status, JSON.stringify(cast)).toBe(409)
        },
        { cast },
      )
    }
  })

  test('un cuerpo inválido es 400 y un proveedor desconocido, 404', async () => {
    await conApp(async ({ pedir }) => {
      expect(
        (
          await pedir('/api/cast/session', {
            method: 'POST',
            headers: JSON_HEADERS,
            body: 'no es json',
          })
        ).status,
      ).toBe(400)

      expect(
        (
          await pedir('/api/cast/session', {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({
              ...PETICION,
              episodeRef: { providerId: 'no-existe', value: 'x' },
            }),
          })
        ).status,
      ).toBe(404)
    })
  })
})
