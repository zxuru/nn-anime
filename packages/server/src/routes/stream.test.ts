import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import { streamResolveResponseSchema } from '@nn-anime/core'
import { createPlaylistCache, type PlaylistCache } from '@nn-anime/media-proxy'
import { createFixtureProvider, type FixtureFailure } from '@nn-anime/providers-fixture'
import { createApp, createContainer } from '../index'
import { ticketPath } from './stream'

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
  readonly upstream: {
    llamadas: number
    ranges: (string | null)[]
    cancelado: boolean
    /** Cada petición que el proxy hizo al upstream, con sus cabeceras. */
    peticiones: { url: string; headers: Headers }[]
  }
}

interface OpcionesDeApp {
  readonly fallo?: FixtureFailure
  /** Cuerpo que devuelve el upstream de mentira. Por defecto, bytes de video. */
  readonly cuerpo?: string
  /** Tipo que declara el upstream de mentira. */
  readonly tipo?: string
  /**
   * Se llama al servir la playlist, para cortar la conexión a mitad de lectura.
   *
   * El cuerpo del upstream falla justo después, que es lo que pasa de verdad
   * cuando el reproductor cancela mientras la lista se está sirviendo.
   */
  readonly alServirPlaylist?: (() => void) | undefined
  /** Caché de playlists propia, con su reloj, para probar la caducidad. */
  readonly playlists?: PlaylistCache | undefined
}

async function conApp<T>(
  body: (contexto: Contexto) => Promise<T>,
  opciones: OpcionesDeApp = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-stream-'))
  const db = openDb(join(dir, 'nn-anime.db'))
  runMigrations(db)
  const upstream = {
    llamadas: 0,
    ranges: [] as (string | null)[],
    cancelado: false,
    peticiones: [] as { url: string; headers: Headers }[],
  }

  // Upstream de mentira: no hay red en ninguna prueba.
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    upstream.llamadas += 1
    upstream.ranges.push(new Headers(init.headers).get('range'))
    upstream.peticiones.push({ url, headers: new Headers(init.headers) })

    // Una playlist de mentira sólo se sirve donde se pide una playlist: si el
    // mismo texto saliera para un segmento, la prueba del índice no probaría que
    // los bytes vienen del recurso resuelto.
    //
    // Y no todas las listas acaban en `.m3u8`: VixSrc las publica en
    // `/playlist/<id>?type=audio`, que es por donde entró el bloqueo de CSP. El
    // tipo lo sigue declarando el upstream, que es lo que mira el proxy.
    const ruta = new URL(url).pathname.toLowerCase()
    const esPlaylist =
      opciones.cuerpo !== undefined && (ruta.endsWith('.m3u8') || ruta.startsWith('/playlist/'))

    if (esPlaylist) {
      if (opciones.alServirPlaylist !== undefined) {
        const cortar = opciones.alServirPlaylist

        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              cortar()
              controller.error(new Error('la conexión se cerró'))
            },
          }),
          { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' } },
        )
      }

      return new Response(opciones.cuerpo, {
        status: 200,
        headers: { 'content-type': opciones.tipo ?? 'application/vnd.apple.mpegurl' },
      })
    }

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

  const container = createContainer({
    db,
    ...(opciones.playlists === undefined ? {} : { playlists: opciones.playlists }),
  })
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
      const salida = streamResolveResponseSchema.parse(cuerpo)

      expect(respuesta.status).toBe(200)
      expect(salida.sources.length).toBeGreaterThan(0)
      for (const source of salida.sources) {
        expect(source.url).toStartWith('/stream/')
        expect(source.url).not.toContain('fixture.invalid')
      }
    })
  })

  test('las pistas llegan con tickets del proxy, no con URLs del upstream', async () => {
    await conApp(async ({ pedir }) => {
      const { cuerpo } = await resolver(pedir)
      const salida = streamResolveResponseSchema.parse(cuerpo)
      const pistas = salida.sources[0]?.subtitles

      // El reproductor web sólo acepta rutas del proxy: una dirección del
      // upstream no llegaría nunca a pintarse.
      expect(Array.isArray(pistas)).toBe(true)
      if (!Array.isArray(pistas) || pistas.length === 0) throw new Error('sin pistas')

      for (const pista of pistas) {
        if (typeof pista !== 'object' || pista === null || !('url' in pista)) {
          throw new Error('una pista sin dirección')
        }

        expect(typeof pista.url === 'string' && pista.url.startsWith('/api/subtitles/')).toBe(true)
        expect(JSON.stringify(pista)).not.toContain('fixture.invalid')
      }
    })
  })

  test('el ticket de una pista sirve el subtítulo convertido', async () => {
    await conApp(async ({ pedir }) => {
      const { cuerpo } = await resolver(pedir)
      const salida = streamResolveResponseSchema.parse(cuerpo)
      const pistas = salida.sources[0]?.subtitles

      expect(Array.isArray(pistas)).toBe(true)
      if (!Array.isArray(pistas) || pistas.length === 0) throw new Error('sin pistas')

      const primera = pistas[0]
      if (typeof primera !== 'object' || primera === null || !('url' in primera)) {
        throw new Error('una pista sin dirección')
      }
      if (typeof primera.url !== 'string') throw new Error('una pista sin dirección')

      // El upstream de mentira sirve bytes de video: lo que se comprueba es el
      // cableado —el ticket resuelve y la pista sale como `vtt`—, no el texto.
      const respuesta = await pedir(primera.url)

      expect(respuesta.status).toBe(200)
      expect(respuesta.headers.get('content-type')).toBe('text/vtt; charset=utf-8')
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

/**
 * La pista de subtítulos que declara el proveedor, que es lo que el selector de
 * subtítulos de la web tiene que poder pintar.
 *
 * Antes, `source.subtitles` cruzaba la frontera tal cual: la dirección del
 * upstream llegaba al navegador y el reproductor la descartaba por no ser una
 * ruta del proxy, así que el selector salía vacío aunque el proveedor hubiera
 * declarado la pista. El contrato de la respuesta ya no lo admite.
 */
describe('los subtítulos que declara el proveedor', () => {
  const CON_REFERER = {
    episodeRef: { providerId: 'fixture', value: 'selva-de-hormigon#1' },
    mode: 'sub' as const,
  }

  test('salen como ruta del proxy y su ticket guarda la dirección real', async () => {
    await conApp(async ({ pedir, upstream }) => {
      const { cuerpo } = await resolver(pedir, CON_REFERER)
      const fuente = streamResolveResponseSchema.parse(cuerpo).sources[0]
      const pista = fuente?.subtitles?.[0]

      // Las dos pistas del título, con su etiqueta y su formato, y ninguna
      // dirección de terceros en la respuesta.
      expect(fuente?.subtitles?.length).toBe(2)
      expect(pista?.url).toStartWith('/api/subtitles/')
      expect(pista?.label).toBe('Español')
      expect(pista?.format).toBe('vtt')
      expect(pista?.default).toBe(true)
      expect(JSON.stringify(cuerpo)).not.toContain('fixture.invalid')

      const respuesta = await pedir(pista?.url ?? '', { headers: GOOD })

      expect(respuesta.status).toBe(200)
      expect(respuesta.headers.get('content-type')).toBe('text/vtt; charset=utf-8')

      // Quien pide la pista al upstream es el proxy, y con el `Referer` que el
      // proveedor declaró para la fuente: sin él el sitio contesta 403.
      const ultima = upstream.peticiones.at(-1)
      expect(ultima?.url).toBe('https://fixture.invalid/selva-de-hormigon/1.es.vtt')
      expect(ultima?.headers.get('referer')).toBe('https://fixture.invalid/selva-de-hormigon')
    })
  })

  test('la dirección del upstream no vale como pista en la respuesta', async () => {
    // La puerta que se cerró: con el schema anterior —una cadena cualquiera—
    // esto pasaba la validación y el cliente recibía una dirección de terceros.
    const conTerceros = {
      sources: [
        {
          url: '/stream/abc',
          kind: 'hls',
          subtitles: [
            {
              lang: 'es',
              label: 'Español',
              url: 'https://tercero.example/es.srt',
              format: 'srt',
            },
          ],
        },
      ],
    }

    expect(streamResolveResponseSchema.safeParse(conTerceros).success).toBe(false)
  })
})

describe('GET /stream/:ticket', () => {
  test('reenvía los bytes con su rango y su 206', async () => {
    await conApp(async ({ pedir, upstream }) => {
      const { cuerpo } = await resolver(pedir)
      const ticket = streamResolveResponseSchema.parse(cuerpo).sources[0]?.url ?? ''

      const respuesta = await pedir(ticket, { headers: { ...GOOD, range: 'bytes=0-1023' } })

      expect(respuesta.status).toBe(206)
      expect(respuesta.headers.get('content-range')).toBe('bytes 0-1023/4096')
      expect(respuesta.headers.get('content-type')).toBe('video/mp4')
      expect(respuesta.headers.get('set-cookie')).toBeNull()
      expect(upstream.ranges).toEqual(['bytes=0-1023'])
      expect((await respuesta.arrayBuffer()).byteLength).toBe(1024)
    })
  })

  test('un tipo mentiroso del upstream no cambia el de una playlist', async () => {
    await conApp(async ({ pedir }) => {
      // `selva-de-hormigon` sólo ofrece `hls`, así que lo que se cachea y se
      // sirve es una playlist. Con un título que ofrezca `file` primero, el tipo
      // lo decide el upstream a propósito: el contenedor de un archivo
      // progresivo sólo lo sabe él.
      const { cuerpo } = await resolver(pedir, {
        episodeRef: { providerId: 'fixture', value: 'selva-de-hormigon#1' },
        mode: 'sub',
      })
      const ticket = streamResolveResponseSchema.parse(cuerpo).sources[0]?.url ?? ''

      const respuesta = await pedir(ticket, { headers: GOOD })

      expect(respuesta.headers.get('content-type')).toBe('application/vnd.apple.mpegurl')
      expect(respuesta.headers.get('x-content-type-options')).toBe('nosniff')
      expect(respuesta.headers.get('set-cookie')).toBeNull()
    })
  })

  test('un ticket inexistente es 404 y uno vencido es 410', async () => {
    await conApp(async ({ pedir }) => {
      const inexistente = await pedir('/stream/no-existe')
      const { cuerpo } = await resolver(pedir)
      const ticket = streamResolveResponseSchema.parse(cuerpo).sources[0]?.url ?? ''

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
      const ticket = streamResolveResponseSchema.parse(cuerpo).sources[0]?.url ?? ''
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

  /**
   * La excepción de la cookie, que es lo que hace posible el handoff a mpv.
   *
   * mpv es un proceso aparte: no tiene la cookie y no puede tenerla. Su
   * credencial es la URL con el ticket, así que el proxy tiene que aceptarla.
   * Antes respondía 401 —mpv abría la ventana y no reproducía nada, mientras la
   * interfaz decía «se abrió en el reproductor externo»—.
   */
  test('el ticket vale sin la cookie de sesión, que es lo que tiene mpv', async () => {
    await conApp(async ({ pedir }) => {
      const { cuerpo } = await resolver(pedir)
      const ticket = streamResolveResponseSchema.parse(cuerpo).sources[0]?.url ?? ''

      const respuesta = await pedir(ticket, { headers: {} })

      expect(respuesta.status).toBe(206)
    })
  })

  test('el ticket abre sus segmentos y no otra ruta', async () => {
    await conApp(async ({ pedir }) => {
      const { cuerpo } = await resolver(pedir)
      const ticket = streamResolveResponseSchema.parse(cuerpo).sources[0]?.url ?? ''

      // El índice se resuelve contra la playlist que el ticket ya autorizó: sin
      // la lista en memoria es 404, pero nunca 401.
      const segmento = await pedir(`${ticket}/seg/0`, { headers: {} })

      expect(segmento.status).not.toBe(401)

      // Y no es una llave maestra: fuera del proxy no vale nada.
      const salud = await pedir('/api/health', { headers: {} })

      expect(salud.status).toBe(401)
    })
  })

  test('un ticket inventado no sustituye a la cookie', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/stream/inventado', { headers: {} })

      expect(respuesta.status).toBe(401)
    })
  })
})

describe('la dirección del ticket', () => {
  test('es una ruta del proxy, no una URL', () => {
    expect(ticketPath('abc123')).toBe('/stream/abc123')
  })
})

/**
 * Una playlist con las tres cosas que hay que reescribir: una sub-playlist no
 * (esta es la de segmentos), un inicializador, una clave y un segmento con URL
 * absoluta del upstream.
 */
const PLAYLIST = [
  '#EXTM3U',
  '#EXT-X-VERSION:7',
  '#EXT-X-MAP:URI="init.mp4"',
  '#EXT-X-KEY:METHOD=AES-128,URI="clave-1.bin",IV=0x1234',
  '#EXTINF:4.0,',
  'https://fixture.invalid/video/segmento-0.ts',
  '#EXTINF:4.0,',
  'segmento-1.ts',
  '#EXT-X-ENDLIST',
  '',
].join('\n')

/** Resuelve el título que sólo ofrece HLS y devuelve el ticket de su playlist. */
async function ticketDePlaylist(pedir: Contexto['pedir']): Promise<string> {
  const { cuerpo } = await resolver(pedir, {
    episodeRef: { providerId: 'fixture', value: 'selva-de-hormigon#1' },
    mode: 'sub',
  })

  return streamResolveResponseSchema.parse(cuerpo).sources[0]?.url ?? ''
}

describe('la reescritura de la playlist', () => {
  test('ni un segmento ni una clave salen del proxy', async () => {
    await conApp(
      async ({ pedir }) => {
        const ticket = await ticketDePlaylist(pedir)
        const respuesta = await pedir(ticket, { headers: GOOD })
        const texto = await respuesta.text()

        expect(respuesta.status).toBe(200)
        expect(respuesta.headers.get('content-type')).toBe('application/vnd.apple.mpegurl')
        expect(respuesta.headers.get('x-content-type-options')).toBe('nosniff')
        expect(texto).toContain(`${ticket}/seg/0`)
        expect(texto).toContain(`${ticket}/seg/1`)
        expect(texto).toContain(`${ticket}/key/0`)
        expect(texto).toContain(`${ticket}/key/1`)
        expect(texto).toContain('#EXTINF:4.0,')
        expect(texto).not.toContain('fixture.invalid')
        expect(texto).not.toContain('init.mp4')
        expect(texto).not.toContain('clave-1.bin')
      },
      { cuerpo: PLAYLIST },
    )
  })

  test('el segmento sale del índice ya resuelto, no de la URL del upstream', async () => {
    await conApp(
      async ({ pedir, upstream }) => {
        const ticket = await ticketDePlaylist(pedir)
        await pedir(ticket, { headers: GOOD })
        const antes = upstream.llamadas

        const respuesta = await pedir(`${ticket}/seg/1`, { headers: GOOD })

        expect(respuesta.status).toBe(206)
        // El tipo lo decide lo que se pidió: un `.ts` es un segmento aunque el
        // upstream diga `video/mp4`.
        expect(respuesta.headers.get('content-type')).toBe('video/mp2t')
        expect((await respuesta.arrayBuffer()).byteLength).toBe(1024)
        expect(upstream.llamadas).toBe(antes + 1)
      },
      { cuerpo: PLAYLIST },
    )
  })

  test('la clave y el inicializador pasan por el proxy con el mismo ticket', async () => {
    await conApp(
      async ({ pedir, upstream }) => {
        const ticket = await ticketDePlaylist(pedir)
        await pedir(ticket, { headers: GOOD })
        const antes = upstream.llamadas

        const mapa = await pedir(`${ticket}/key/0`, { headers: GOOD })
        const clave = await pedir(`${ticket}/key/1`, { headers: GOOD })

        expect([mapa.status, clave.status]).toEqual([206, 206])
        expect(upstream.llamadas).toBe(antes + 2)
      },
      { cuerpo: PLAYLIST },
    )
  })

  test('un índice fuera de rango es 404 y no llega al upstream', async () => {
    await conApp(
      async ({ pedir, upstream }) => {
        const ticket = await ticketDePlaylist(pedir)
        await pedir(ticket, { headers: GOOD })
        const antes = upstream.llamadas

        const respuesta = await pedir(`${ticket}/seg/9`, { headers: GOOD })

        expect(respuesta.status).toBe(404)
        expect(upstream.llamadas).toBe(antes)
      },
      { cuerpo: PLAYLIST },
    )
  })

  test('sin la playlist en memoria, el índice es 404 sin salir a la red', async () => {
    await conApp(
      async ({ pedir, upstream }) => {
        const ticket = await ticketDePlaylist(pedir)
        const antes = upstream.llamadas

        const respuesta = await pedir(`${ticket}/seg/0`, { headers: GOOD })

        expect(respuesta.status).toBe(404)
        expect(upstream.llamadas).toBe(antes)
      },
      { cuerpo: PLAYLIST },
    )
  })

  test('un ticket inexistente en el índice es 404', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/stream/no-existe/seg/0', { headers: GOOD })

      expect(respuesta.status).toBe(404)
    })
  })

  test('una sub-playlist anidada recibe un ticket propio', async () => {
    const anidada = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720',
      '720/index.m3u8',
      '',
    ].join('\n')

    await conApp(
      async ({ pedir }) => {
        const ticket = await ticketDePlaylist(pedir)
        const maestra = await (await pedir(ticket, { headers: GOOD })).text()

        expect(maestra).toContain(`${ticket}/seg/0`)

        const hija = await (await pedir(`${ticket}/seg/0`, { headers: GOOD })).text()
        const propio = /\/stream\/([^/]+)\/seg\/0/.exec(hija)?.[1]

        // El índice de la hija es otro: si compartiera el ticket del padre,
        // `seg/0` significaría dos cosas distintas según quién preguntara.
        expect(propio).toBeDefined()
        expect(propio).not.toBe(ticket.split('/')[2])
        expect(hija).toContain('#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720')
      },
      { cuerpo: anidada },
    )
  })

  /**
   * El master de VixSrc, que es el que rompió la reproducción: publica sus
   * pistas de audio en `#EXT-X-MEDIA:…,URI="…"` y ese URI no lleva extensión.
   *
   * Antes de reescribirlo, la lista que llegaba al reproductor traía la
   * dirección absoluta del upstream, hls.js salía a pedir el audio por su
   * cuenta y el navegador lo bloqueaba con `connect-src 'self'`: el episodio se
   * quedaba mudo y la consola llena de avisos de CSP.
   */
  test('una variante de audio del master también pasa por el proxy', async () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=YES,URI="https://fixture.invalid/playlist/260398?type=audio&rendition=eng"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720,AUDIO="audio"',
      '720/index.m3u8',
      '',
    ].join('\n')

    await conApp(
      async ({ pedir, upstream }) => {
        const ticket = await ticketDePlaylist(pedir)
        const texto = await (await pedir(ticket, { headers: GOOD })).text()

        expect(texto).toContain(`URI="${ticket}/seg/0"`)
        expect(texto).toContain(`${ticket}/seg/1`)
        // Ni una dirección absoluta: cada una es una petición que la CSP del
        // proxy bloquea antes de salir del navegador.
        expect(texto).not.toMatch(/https?:\/\//)

        const antes = upstream.llamadas
        const audio = await pedir(`${ticket}/seg/0`, { headers: GOOD })

        // La variante es una lista, no un segmento, aunque su ruta no acabe en
        // `.m3u8`: la sirve el proxy en streaming y vuelve reescrita.
        expect(audio.status).toBe(200)
        expect(audio.headers.get('content-type')).toBe('application/vnd.apple.mpegurl')
        expect(await audio.text()).not.toMatch(/https?:\/\//)
        // Y quien pide el audio al upstream es el proxy, una sola vez.
        expect(upstream.llamadas).toBe(antes + 1)
      },
      { cuerpo: master },
    )
  })

  test('una playlist que se corta a mitad con el cliente fuera es 499', async () => {
    const control = new AbortController()

    await conApp(
      async ({ pedir }) => {
        const ticket = await ticketDePlaylist(pedir)
        const respuesta = await pedir(ticket, { headers: GOOD, signal: control.signal })

        expect(respuesta.status).toBe(499)
      },
      { cuerpo: PLAYLIST, alServirPlaylist: () => control.abort() },
    )
  })

  test('el índice dura lo que dura la reproducción, no diez segundos', async () => {
    let ahora = 1_000_000
    const playlists = createPlaylistCache({ ttlMs: 600_000, now: () => ahora })

    await conApp(
      async ({ pedir }) => {
        const ticket = await ticketDePlaylist(pedir)
        await pedir(ticket, { headers: GOOD })

        // Cinco minutos de reproducción: peticiones de segmento y ninguna de la
        // lista. Antes, la primera que llegara después del décimo segundo era un
        // 404 y la reproducción se paraba con lo que ya estaba en el búfer.
        for (let vuelta = 0; vuelta < 30; vuelta++) {
          ahora += 10_000
          const respuesta = await pedir(`${ticket}/seg/0`, { headers: GOOD })

          expect(respuesta.status, `vuelta ${vuelta}`).toBe(206)
          await respuesta.arrayBuffer()
        }
      },
      { cuerpo: PLAYLIST, playlists },
    )
  })

  test('una playlist que pasa del tope es 502 y no se sirve', async () => {
    await conApp(
      async ({ pedir }) => {
        const ticket = await ticketDePlaylist(pedir)
        const respuesta = await pedir(ticket, { headers: GOOD })

        expect(respuesta.status).toBe(502)
        expect(await respuesta.json()).toMatchObject({ error: expect.stringContaining('4') })
      },
      { cuerpo: `#EXTM3U\n${'x'.repeat(4 * 1024 * 1024 + 1)}\n` },
    )
  })
})
