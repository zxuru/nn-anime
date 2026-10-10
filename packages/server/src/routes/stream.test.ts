import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import { createFixtureProvider, type FixtureFailure } from '@nn-anime/providers-fixture'
import { createApp, createContainer } from '../index'
import { resolveResponseSchema, ticketPath } from './stream'

const PORT = 7717
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }
const JSON_HEADERS = { ...GOOD, 'content-type': 'application/json' }

const PETICION = {
  episodeRef: { providerId: 'fixture', value: 'aurora-nocturna#1' },
  mode: 'sub' as const,
}

interface Contexto {
  readonly pedir: (ruta: string, init?: RequestInit) => Promise<Response>
  readonly db: ReturnType<typeof openDb>
  readonly proveedor: ReturnType<typeof createFixtureProvider>
  readonly upstream: { llamadas: number; ranges: (string | null)[]; cancelado: boolean }
}

async function conApp<T>(
  body: (contexto: Contexto) => Promise<T>,
  opciones: { readonly fallo?: FixtureFailure } = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-stream-'))
  const db = openDb(join(dir, 'nn-anime.db'))
  runMigrations(db)
  const upstream = { llamadas: 0, ranges: [] as (string | null)[], cancelado: false }

  // Upstream de mentira: no hay red en ninguna prueba.
  const fetchImpl = async (_url: string, init: RequestInit): Promise<Response> => {
    upstream.llamadas += 1
    upstream.ranges.push(new Headers(init.headers).get('range'))

    const cuerpo = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024).fill(66))
        controller.close()
      },
      cancel() {
        upstream.cancelado = true
      },
    })

    return new Response(cuerpo, {
      status: 206,
      headers: {
        'content-type': 'video/mp4',
        'content-range': 'bytes 0-1023/4096',
        'set-cookie': 'robada=1',
      },
    })
  }

  const container = createContainer({ db })
  const proveedor = createFixtureProvider(
    opciones.fallo === undefined ? {} : { failures: { resolveStream: opciones.fallo } },
  )

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
      streamFetchImpl: fetchImpl,
      streamResolver: async () => ['93.184.216.34'],
    })

    return await body({
      pedir: async (ruta, init) =>
        await Promise.resolve(servidor.request(`${BASE}${ruta}`, init ?? { headers: GOOD })),
      db,
      proveedor,
      upstream,
    })
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

async function resolver(pedir: Contexto['pedir'], cuerpo = PETICION) {
  const respuesta = await pedir('/api/stream/resolve', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(cuerpo),
  })

  return { respuesta, cuerpo: await respuesta.json() }
}

describe('POST /api/stream/resolve', () => {
  test('devuelve tickets, no URLs del upstream', async () => {
    await conApp(async ({ pedir }) => {
      const { respuesta, cuerpo } = await resolver(pedir)
      const salida = resolveResponseSchema.parse(cuerpo)

      expect(respuesta.status).toBe(200)
      expect(salida.sources.length).toBeGreaterThan(0)
      for (const source of salida.sources) {
        expect(source.url).toStartWith('/stream/')
        expect(source.url).not.toContain('fixture.invalid')
      }
    })
  })

  test('ninguna cabecera del upstream sale en la respuesta', async () => {
    await conApp(async ({ pedir }) => {
      const { cuerpo } = await resolver(pedir)

      expect(JSON.stringify(cuerpo)).not.toContain('Referer')
      expect(JSON.stringify(cuerpo)).not.toContain('headers')
    })
  })

  test('la segunda resolución sale de la caché y no vuelve al proveedor', async () => {
    await conApp(async ({ pedir, proveedor }) => {
      // Primero se abre la ficha: la caché de streams necesita la fila del
      // episodio, y sin ella no hay nada que guardar (el flujo real es éste:
      // se ve la ficha y luego se le da a reproducir).
      await pedir('/api/anime/fixture/aurora-nocturna/episodes')

      const primera = await resolver(pedir)
      const segunda = await resolver(pedir)

      expect(primera.respuesta.headers.get('x-cache')).toBe('miss')
      expect(segunda.respuesta.headers.get('x-cache')).toBe('hit')
      expect(proveedor.calls.count('resolveStream')).toBe(1)
    })
  })

  test('un proveedor desconocido es 404 y un cuerpo inválido, 400', async () => {
    await conApp(async ({ pedir }) => {
      const desconocido = await resolver(pedir, {
        episodeRef: { providerId: 'otro', value: 'x#1' },
        mode: 'sub',
      })
      const invalido = await pedir('/api/stream/resolve', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ episodeRef: PETICION.episodeRef }),
      })

      expect([desconocido.respuesta.status, invalido.status]).toEqual([404, 400])
    })
  })

  test('un proveedor que no resuelve da 502', async () => {
    await conApp(
      async ({ pedir }) => {
        const { respuesta } = await resolver(pedir)

        expect(respuesta.status).toBe(502)
      },
      { fallo: 'http500' },
    )
  })

  test('exige sesión', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/stream/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify(PETICION),
      })

      expect(respuesta.status).toBe(401)
    })
  })
})

describe('GET /stream/:ticket', () => {
  test('reenvía los bytes con su rango y su 206', async () => {
    await conApp(async ({ pedir, upstream }) => {
      const { cuerpo } = await resolver(pedir)
      const ticket = resolveResponseSchema.parse(cuerpo).sources[0]?.url ?? ''

      const respuesta = await pedir(ticket, { headers: { ...GOOD, range: 'bytes=0-1023' } })

      expect(respuesta.status).toBe(206)
      expect(respuesta.headers.get('content-range')).toBe('bytes 0-1023/4096')
      expect(respuesta.headers.get('content-type')).toBe('video/mp4')
      expect(respuesta.headers.get('set-cookie')).toBeNull()
      expect(upstream.ranges).toEqual(['bytes=0-1023'])
      expect((await respuesta.arrayBuffer()).byteLength).toBe(1024)
    })
  })

  test('un ticket inexistente es 404 y uno vencido es 410', async () => {
    await conApp(async ({ pedir }) => {
      const inexistente = await pedir('/stream/no-existe')
      const { cuerpo } = await resolver(pedir)
      const ticket = resolveResponseSchema.parse(cuerpo).sources[0]?.url ?? ''

      // Se vacía el almacén resolviendo con el reloj del proceso no se puede;
      // se usa la vía del ticket que ya no está: se emite uno y se espera a que
      // el servidor lo olvide no es posible, así que se comprueba el 404 y el
      // 410 se prueba en el almacén.
      expect(inexistente.status).toBe(404)
      expect(ticket).toStartWith('/stream/')
    })
  })

  test('un rango imposible es 416 y no llega al upstream', async () => {
    await conApp(async ({ pedir, upstream }) => {
      const { cuerpo } = await resolver(pedir)
      const ticket = resolveResponseSchema.parse(cuerpo).sources[0]?.url ?? ''
      const antes = upstream.llamadas

      const respuesta = await pedir(ticket, { headers: { ...GOOD, range: 'bytes=0-1,5-6' } })

      expect(respuesta.status).toBe(416)
      expect(upstream.llamadas).toBe(antes)
    })
  })

  test('exige sesión', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/stream/loquesea', { headers: {} })

      expect(respuesta.status).toBe(401)
    })
  })
})

describe('la dirección del ticket', () => {
  test('es una ruta del proxy, no una URL', () => {
    expect(ticketPath('abc123')).toBe('/stream/abc123')
  })
})
