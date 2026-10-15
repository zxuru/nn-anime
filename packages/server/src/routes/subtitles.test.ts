import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import { MAX_SUBTITLE_BYTES } from '@nn-anime/media-proxy'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { createApp, createContainer } from '../index'

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

  test('un zip de SubDivX sin extensión se extrae y convierte a `vtt`', async () => {
    const srt = new TextEncoder().encode('1\n00:00:01,000 --> 00:00:04,000\nHola\n')
    const zip = zipDe(entradaZip('pelicula.srt', srt))

    await conApp(
      async ({ pedir, ticket }) => {
        // Sin extensión en la dirección, como un `bajar.php?id=…`: la firma manda.
        const respuesta = await pedir(
          `/api/subtitles/${ticket('https://subdivx.invalid/bajar.php?id=1')}`,
        )

        expect(respuesta.status).toBe(200)
        expect(respuesta.headers.get('content-type')).toBe('text/vtt; charset=utf-8')
        expect(await respuesta.text()).toContain('00:00:01.000')
      },
      { cuerpo: zip, tipo: 'application/zip' },
    )
  })

  test('un rar se rechaza con 415 y su nombre', async () => {
    await conApp(
      async ({ pedir, ticket }) => {
        const respuesta = await pedir(
          `/api/subtitles/${ticket('https://subdivx.invalid/bajar.php?id=1')}`,
        )

        expect(respuesta.status).toBe(415)
        expect(JSON.stringify(await respuesta.json())).toContain('rar')
      },
      { cuerpo: new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00, 0x00]) },
    )
  })

  test('un zip sin subtítulos es 415, no un 502 del origen', async () => {
    const zip = zipDe(entradaZip('leeme.txt', new TextEncoder().encode('hola')))

    await conApp(
      async ({ pedir, ticket }) => {
        const respuesta = await pedir(
          `/api/subtitles/${ticket('https://subdivx.invalid/bajar.php?id=1')}`,
        )

        expect(respuesta.status).toBe(415)
      },
      { cuerpo: zip, tipo: 'application/zip' },
    )
  })
})

/**
 * Un zip mínimo con una entrada `stored`, como el de `media-proxy`: la ruta no
 * sabe de zips, sólo de lo que el proxy extrae, y aquí se comprueba el cableado
 * de punta a punta.
 */
function entradaZip(nombre: string, datos: Uint8Array): Uint8Array {
  const nombreBytes = new TextEncoder().encode(nombre)
  const cabecera = new DataView(new ArrayBuffer(30))

  cabecera.setUint32(0, 0x04034b50, true)
  cabecera.setUint16(8, 0, true)
  cabecera.setUint32(18, datos.byteLength, true)
  cabecera.setUint32(22, datos.byteLength, true)
  cabecera.setUint16(26, nombreBytes.byteLength, true)

  const zip = new Uint8Array(30 + nombreBytes.byteLength + datos.byteLength)
  zip.set(new Uint8Array(cabecera.buffer), 0)
  zip.set(nombreBytes, 30)
  zip.set(datos, 30 + nombreBytes.byteLength)

  return zip
}

function zipDe(...entradas: Uint8Array[]): Uint8Array {
  const total = entradas.reduce((largo, entrada) => largo + entrada.byteLength, 0)
  const zip = new Uint8Array(total)
  let offset = 0

  for (const entrada of entradas) {
    zip.set(entrada, offset)
    offset += entrada.byteLength
  }

  return zip
}
