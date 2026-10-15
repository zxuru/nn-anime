import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import { MAX_SUBTITLE_BYTES } from '@nn-anime/media-proxy'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { createApp, createContainer } from '../index'
import { subtitlesPath } from './subtitles'

const PORT = 7717
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }
const FIXTURES = fileURLToPath(new URL('../../../media-proxy/fixtures/', import.meta.url))

interface Contexto {
  readonly pedir: (ruta: string, init?: RequestInit) => Promise<Response>
  readonly ticket: (url: string) => string
}

async function conApp<T>(
  body: (contexto: Contexto) => Promise<T>,
  opciones: { readonly cuerpo?: Uint8Array; readonly tipo?: string } = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-subs-'))
  const db = openDb(join(dir, 'nn-anime.db'))
  runMigrations(db)
  const container = createContainer({ db })
  const proveedor = createFixtureProvider()
  const cuerpo = opciones.cuerpo ?? new Uint8Array(await readFile(`${FIXTURES}sample.srt`))

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
      streamFetchImpl: async () =>
        // `Uint8Array` como cuerpo de `Response` necesita su buffer explícito:
        // el tipo de `BodyInit` no lo admite tal cual.
        new Response(cuerpo.buffer as ArrayBuffer, {
          status: 200,
          headers: { 'content-type': opciones.tipo ?? 'application/x-subrip' },
        }),
      streamResolver: async () => ['93.184.216.34'],
    })

    return await body({
      pedir: async (ruta, init) =>
        await Promise.resolve(servidor.request(`${BASE}${ruta}`, init ?? { headers: GOOD })),
      ticket: (url) => container.tickets.issue({ url, headers: {} }),
    })
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

describe('GET /api/subtitles/:ticket', () => {
  test('convierte el `srt` del fixture a `vtt`', async () => {
    await conApp(async ({ pedir, ticket }) => {
      const respuesta = await pedir(`/api/subtitles/${ticket('https://fixture.invalid/es.srt')}`)

      expect(respuesta.status).toBe(200)
      expect(respuesta.headers.get('content-type')).toBe('text/vtt; charset=utf-8')
      expect(respuesta.headers.get('x-content-type-options')).toBe('nosniff')

      const texto = await respuesta.text()
      const esperado = await readFile(`${FIXTURES}sample.expected.vtt`, 'utf8')

      expect(texto).toBe(esperado)
    })
  })

  test('un `vtt` se sirve tal cual', async () => {
    await conApp(
      async ({ pedir, ticket }) => {
        const respuesta = await pedir(`/api/subtitles/${ticket('https://fixture.invalid/es.vtt')}`)

        expect(respuesta.headers.get('content-type')).toBe('text/vtt; charset=utf-8')
        expect(await respuesta.text()).toContain('WEBVTT')
      },
      { cuerpo: new TextEncoder().encode('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHola\n') },
    )
  })

  test('un `ass` se reenvía sin convertir', async () => {
    await conApp(
      async ({ pedir, ticket }) => {
        const respuesta = await pedir(`/api/subtitles/${ticket('https://fixture.invalid/es.ass')}`)

        expect(respuesta.status).toBe(200)
        expect(await respuesta.text()).toContain('[Script Info]')
      },
      { cuerpo: new TextEncoder().encode('[Script Info]\nTitle: prueba\n') },
    )
  })

  test('un `srt` en UTF-16 con BOM llega convertido y legible', async () => {
    const texto = '1\r\n00:00:01,000 --> 00:00:02,000\r\nñandú\r\n'
    // UTF-16LE de verdad: un BOM seguido de UTF-8 no es UTF-16, y el decodificador
    // haría bien en convertirlo en basura. Lo encontró esta prueba.
    const utf16 = new Uint8Array(2 + texto.length * 2)
    utf16[0] = 0xff
    utf16[1] = 0xfe
    for (const [indice, caracter] of [...texto].entries()) {
      const codigo = caracter.charCodeAt(0)
      utf16[2 + indice * 2] = codigo & 0xff
      utf16[3 + indice * 2] = codigo >> 8
    }
    const bytes = utf16

    await conApp(
      async ({ pedir, ticket }) => {
        const respuesta = await pedir(`/api/subtitles/${ticket('https://fixture.invalid/es.srt')}`)
        const salida = await respuesta.text()

        expect(salida).toContain('ñandú')
        expect(salida).toContain('00:00:01.000')
      },
      { cuerpo: bytes },
    )
  })

  test('una pista que pasa del tope es 413', async () => {
    await conApp(
      async ({ pedir, ticket }) => {
        const respuesta = await pedir(`/api/subtitles/${ticket('https://fixture.invalid/es.srt')}`)

        expect(respuesta.status).toBe(413)
        expect(JSON.stringify(await respuesta.json())).toContain(String(MAX_SUBTITLE_BYTES))
      },
      { cuerpo: new Uint8Array(MAX_SUBTITLE_BYTES + 1) },
    )
  })

  test('un ticket que no existe es 404', async () => {
    await conApp(async ({ pedir }) => {
      expect((await pedir('/api/subtitles/no-existe')).status).toBe(404)
    })
  })

  test('exige sesión', async () => {
    await conApp(async ({ pedir, ticket }) => {
      const respuesta = await pedir(`/api/subtitles/${ticket('https://fixture.invalid/es.srt')}`, {
        headers: {},
      })

      expect(respuesta.status).toBe(401)
    })
  })
})

/**
 * La dirección que se escribe en un solo sitio y se atiende en otro.
 *
 * Si las dos se separan, el cliente pide una ruta que nadie contesta y el
 * reproductor se queda sin pistas con un 404 en la consola. La prueba no compara
 * la cadena consigo misma: pide el recurso.
 */
describe('la dirección de la pista', () => {
  test('es una ruta del proxy, no una URL', () => {
    expect(subtitlesPath('abc123')).toBe('/api/subtitles/abc123')
  })

  test('la ruta registrada es la que escribe esa dirección', async () => {
    await conApp(async ({ pedir, ticket }) => {
      const ruta = subtitlesPath(ticket('https://fixture.invalid/es.srt'))
      const respuesta = await pedir(ruta)

      expect(respuesta.status).toBe(200)
      expect(respuesta.headers.get('content-type')).toBe('text/vtt; charset=utf-8')
    })
  })
})
