import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import type { SearchResult } from '@nn-anime/core'
import { MAX_COVER_BYTES, RASTER_TYPES } from '@nn-anime/media-proxy'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { createApp, createContainer } from '../index'
import { COVER_MAX_AGE_S, coverEtag } from './cover'

const PORT = 7717
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }
const REF = 'aurora-nocturna'

interface Contexto {
  readonly pedir: (ruta: string, init?: RequestInit) => Promise<Response>
  readonly db: ReturnType<typeof openDb>
  readonly upstream: { llamadas: number }
}

async function conApp<T>(
  body: (contexto: Contexto) => Promise<T>,
  opciones: {
    readonly tipo?: string
    readonly tamano?: number
    readonly sinPortada?: boolean
    /** Un listado cacheado, sin detalle: es el caso de la búsqueda. */
    readonly busqueda?: readonly SearchResult[]
  } = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-portada-'))
  const db = openDb(join(dir, 'nn-anime.db'))
  runMigrations(db)
  const upstream = { llamadas: 0 }
  const tamano = opciones.tamano ?? 1024

  const fetchImpl = async (): Promise<Response> => {
    upstream.llamadas += 1

    const cuerpo = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(tamano).fill(65))
        controller.close()
      },
    })

    return new Response(cuerpo, {
      status: 200,
      headers: {
        'content-type': opciones.tipo ?? 'image/webp',
        'content-length': String(tamano),
      },
    })
  }

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
      streamFetchImpl: fetchImpl,
      streamResolver: async () => ['93.184.216.34'],
    })

    // El detalle cacheado es lo que da la URL de la portada. Sin él, la ruta no
    // tiene nada que servir, que es justo uno de los casos.
    if (opciones.sinPortada !== true) {
      await servidor.request(`${BASE}/api/anime/fixture/${REF}`, { headers: GOOD })
    }

    // Un listado cacheado sin detalle: la búsqueda conoce el título y su
    // portada, pero nadie abrió todavía la ficha.
    if (opciones.busqueda !== undefined) {
      await container.store.writeSearch('fixture', 'aurora', opciones.busqueda)
    }

    return await body({
      pedir: async (ruta, init) =>
        await Promise.resolve(servidor.request(`${BASE}${ruta}`, init ?? { headers: GOOD })),
      db,
      upstream,
    })
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

describe('GET /api/cover/:providerId/:ref', () => {
  test('sirve la portada con su tipo y su caché larga', async () => {
    await conApp(async ({ pedir, upstream }) => {
      const respuesta = await pedir(`/api/cover/fixture/${REF}`)

      expect(respuesta.status).toBe(200)
      expect(respuesta.headers.get('content-type')).toBe('image/webp')
      expect(respuesta.headers.get('cache-control')).toBe(`public, max-age=${COVER_MAX_AGE_S}`)
      expect(respuesta.headers.get('etag')).toBe(coverEtag('fixture', REF))
      expect(upstream.llamadas).toBe(1)
    })
  })

  test('sirve la portada de un título que sólo está en un listado cacheado', async () => {
    // Es el caso de la búsqueda: el resultado trae su portada, pero nadie abrió
    // la ficha todavía. Sin esto, la tarjeta pedía una imagen y recibía 404.
    const busqueda: readonly SearchResult[] = [
      {
        ref: { providerId: 'fixture', value: REF },
        title: 'Aurora Nocturna',
        coverUrl: 'https://fixture.invalid/portada/aurora-nocturna.webp',
      },
    ]

    await conApp(
      async ({ pedir, upstream }) => {
        const respuesta = await pedir(`/api/cover/fixture/${REF}`)

        expect(respuesta.status).toBe(200)
        expect(respuesta.headers.get('content-type')).toBe('image/webp')
        expect(upstream.llamadas).toBe(1)
      },
      { sinPortada: true, busqueda },
    )
  })

  test('con el ETag que ya tiene, responde 304 sin volver al upstream', async () => {
    await conApp(async ({ pedir, upstream }) => {
      const etag = coverEtag('fixture', REF)
      const respuesta = await pedir(`/api/cover/fixture/${REF}`, {
        headers: { ...GOOD, 'if-none-match': etag },
      })

      expect(respuesta.status).toBe(304)
      expect(upstream.llamadas).toBe(0)
    })
  })

  test('sin el título en la caché es 404 y no se pregunta al proveedor', async () => {
    await conApp(
      async ({ pedir, upstream }) => {
        const respuesta = await pedir(`/api/cover/fixture/${REF}`)

        expect(respuesta.status).toBe(404)
        expect(JSON.stringify(await respuesta.json())).toContain('no hay ninguna portada')
        expect(upstream.llamadas).toBe(0)
      },
      { sinPortada: true },
    )
  })

  test('una referencia que no existe es 404', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/cover/fixture/no-existe')

      expect(respuesta.status).toBe(404)
    })
  })

  test('un SVG se rechaza con 415: es un documento con guiones dentro', async () => {
    await conApp(
      async ({ pedir }) => {
        const respuesta = await pedir(`/api/cover/fixture/${REF}`)

        expect(respuesta.status).toBe(415)
      },
      { tipo: 'image/svg+xml' },
    )
  })

  test('una portada de más de 5 MB se rechaza con 413', async () => {
    await conApp(
      async ({ pedir }) => {
        const respuesta = await pedir(`/api/cover/fixture/${REF}`)

        expect(respuesta.status).toBe(413)
      },
      { tamano: MAX_COVER_BYTES + 1 },
    )
  })

  test('los tipos ráster de la lista se sirven', async () => {
    for (const tipo of RASTER_TYPES) {
      await conApp(
        async ({ pedir }) => {
          const respuesta = await pedir(`/api/cover/fixture/${REF}`)

          expect(respuesta.status, tipo).toBe(200)
          expect(respuesta.headers.get('content-type')).toBe(tipo)
        },
        { tipo },
      )
    }
  })

  test('una referencia con barras, escapada, llega entera', async () => {
    await conApp(async ({ pedir }) => {
      // Sin escapar, Hono no captura el valor y la ruta da 404: es parte del
      // contrato, y por eso el cliente usa `encodeURIComponent`.
      const escapada = await pedir('/api/cover/fixture/a%2Fb')
      const sinEscapar = await pedir('/api/cover/fixture/a/b')

      expect([escapada.status, sinEscapar.status]).toEqual([404, 404])
    })
  })

  test('el ETag no se deriva de la referencia en claro', () => {
    const etag = coverEtag('fixture', '../../etc/passwd')

    expect(etag).not.toContain('passwd')
    expect(etag).not.toContain('..')
    expect(etag).toMatch(/^"[0-9a-f]{16}"$/)
  })

  test('exige sesión', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir(`/api/cover/fixture/${REF}`, { headers: {} })

      expect(respuesta.status).toBe(401)
    })
  })
})
