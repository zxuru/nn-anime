import { describe, expect, test } from 'bun:test'
import { PARTY_PROTOCOL_VERSION, type PartyEvent } from '@nn-anime/core/party'
import { ApiError, ApiShapeError } from '../../api/client'
import {
  createPartyEventParser,
  joinRemoteRoom,
  measureRemoteClock,
  normalizeHostAddress,
  type PartyFetch,
  readRemotePartyEvents,
  reportRemotePosition,
} from './client'

/**
 * El cliente de la sala, medido con un `fetch` falso.
 *
 * Lo que se comprueba aquí no necesita navegador ni servidor: que la dirección
 * del anfitrión se normalice a un origen, que el invitado hable **sólo** con su
 * instancia, que ninguna credencial viaje en una URL y que el analizador de SSE
 * no pierda un evento cuando el trozo corta por donde no debe.
 */

interface Llamada {
  readonly url: string
  readonly init: RequestInit
}

function espia(respuesta: () => Response): {
  readonly llamadas: Llamada[]
  readonly fetch: PartyFetch
} {
  const llamadas: Llamada[] = []

  return {
    llamadas,
    fetch: (url, init) => {
      llamadas.push({ url, init })

      return Promise.resolve(respuesta())
    },
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Un cuerpo que llega por trozos, como el de una respuesta de verdad. */
function responseFromChunks(chunks: readonly string[]): Response {
  const encoder = new TextEncoder()

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
  )
}

const ESTADO: PartyEvent = {
  type: 'state',
  state: {
    media: { kind: 'episode', title: 'Aurora nocturna', episode: 3 },
    positionS: 12,
    paused: false,
    rate: 1,
    seq: 4,
    atMs: 90,
  },
}

const PING: PartyEvent = { type: 'ping', atMs: 120 }

function bloque(evento: PartyEvent): string {
  return `data: ${JSON.stringify(evento)}\n\n`
}

describe('la dirección del anfitrión', () => {
  test('acepta lo que se dicta y lo deja como un origen', () => {
    expect(normalizeHostAddress('192.168.1.5:7717')).toBe('http://192.168.1.5:7717')
    expect(normalizeHostAddress('  192.168.1.5:7717/  ')).toBe('http://192.168.1.5:7717')
    expect(normalizeHostAddress('http://192.168.1.5:7717/')).toBe('http://192.168.1.5:7717')
    expect(normalizeHostAddress('https://anime.local:9000///')).toBe('https://anime.local:9000')
    expect(normalizeHostAddress('localhost:7717')).toBe('http://localhost:7717')
  })

  test('rechaza esquemas raros, rutas y credenciales', () => {
    for (const mala of [
      '',
      '   ',
      'ftp://192.168.1.5:21',
      'javascript:alert(1)',
      'http://192.168.1.5:7717/sala',
      'http://usuario:clave@192.168.1.5:7717',
      'http://192.168.1.5:7717?code=1',
      'http://192.168.1.5:7717#sala',
    ]) {
      expect(normalizeHostAddress(mala), mala).toBeUndefined()
    }
  })
})

describe('el invitado habla con su instancia', () => {
  test('el join va al mismo origen, con la dirección en el cuerpo y sin token', async () => {
    const { llamadas, fetch } = espia(() =>
      jsonResponse({ roomId: 'sala-1', expiresAt: 1000, state: null, roster: [] }),
    )

    const entrada = await joinRemoteRoom(
      { baseUrl: 'http://192.168.1.5:7717', code: 'ABCDEFGHIJKLMNOP', name: 'Ana' },
      { fetch },
    )

    expect(entrada).toEqual({ roomId: 'sala-1', expiresAt: 1000, state: null, roster: [] })

    const llamada = llamadas[0]
    expect(llamada?.url).toBe('/api/party/remote/join')
    expect(llamada?.init.method).toBe('POST')
    expect(llamada?.init.credentials).toBe('same-origin')
    // Ni cabecera de autorización ni la dirección convertida en URL: el token lo
    // guarda el servidor local, no el navegador.
    expect(String(JSON.stringify(llamada?.init.headers))).not.toContain('authorization')
    expect(llamada?.url).not.toContain('192.168.1.5')

    expect(JSON.parse(String(llamada?.init.body))).toEqual({
      baseUrl: 'http://192.168.1.5:7717',
      code: 'ABCDEFGHIJKLMNOP',
      name: 'Ana',
    })
  })

  test('una respuesta con otra forma no se pinta a medias', async () => {
    const { fetch } = espia(() => jsonResponse({ roomId: 'sala-1' }))

    const fallo = await joinRemoteRoom(
      { baseUrl: 'http://host:1', code: 'A', name: 'Ana' },
      { fetch },
    ).catch((causa: unknown) => causa)

    expect(fallo).toBeInstanceOf(ApiShapeError)
  })

  test('un 404 se convierte en ApiError para que la interfaz elija la frase', async () => {
    const { fetch } = espia(() => new Response(null, { status: 404 }))

    const fallo = await joinRemoteRoom(
      { baseUrl: 'http://host:1', code: 'A', name: 'Ana' },
      { fetch },
    ).catch((causa: unknown) => causa)

    expect(fallo).toBeInstanceOf(ApiError)
    expect(fallo instanceof ApiError ? fallo.status : undefined).toBe(404)
  })

  test('el reporte va al mismo origen y no lleva la posición a la URL', async () => {
    const { llamadas, fetch } = espia(() => new Response(null, { status: 204 }))

    await reportRemotePosition(
      { positionS: 12.5, paused: false, buffering: false, ready: true },
      { fetch },
    )

    expect(llamadas[0]?.url).toBe('/api/party/remote/report')
    expect(llamadas[0]?.init.method).toBe('POST')
    expect(JSON.parse(String(llamadas[0]?.init.body))).toEqual({
      positionS: 12.5,
      paused: false,
      buffering: false,
      ready: true,
    })
  })

  test('la muestra del reloj mide t0 y t3 en el cliente', async () => {
    const { llamadas, fetch } = espia(() => jsonResponse({ t0: 100, t1: 250, t2: 252 }))
    const instantes = [1000, 1120]
    let siguiente = 0

    const muestra = await measureRemoteClock({
      fetch,
      now: () => instantes[siguiente++] ?? 0,
    })

    expect(muestra).toEqual({ t0: 100, t1: 250, t2: 252, t3: 1120 })
    expect(JSON.parse(String(llamadas[0]?.init.body))).toEqual({ t0: 1000 })
  })
})

describe('el flujo de la sala', () => {
  test('los eventos salen en orden, aunque el cuerpo llegue por trozos', async () => {
    const texto = bloque(ESTADO) + bloque(PING)
    const { fetch } = espia(() =>
      responseFromChunks([texto.slice(0, 7), texto.slice(7, 30), texto.slice(30)]),
    )

    const recibidos: PartyEvent[] = []
    for await (const evento of readRemotePartyEvents({ fetch })) recibidos.push(evento)

    expect(recibidos).toEqual([ESTADO, PING])
  })

  test('el flujo no pide ni manda credenciales', async () => {
    const { llamadas, fetch } = espia(() => responseFromChunks([bloque(PING)]))

    const recibidos: PartyEvent[] = []
    for await (const evento of readRemotePartyEvents({ fetch })) recibidos.push(evento)

    expect(recibidos).toEqual([PING])
    expect(llamadas[0]?.url).toBe('/api/party/remote/events')
    expect(String(JSON.stringify(llamadas[0]?.init.headers))).not.toContain('authorization')
  })
})

describe('el analizador de SSE', () => {
  test('un evento partido en tres trozos sale al final, entero', () => {
    const parser = createPartyEventParser()
    const texto = bloque(ESTADO)

    expect(parser.push(texto.slice(0, 12))).toEqual([])
    expect(parser.push(texto.slice(12, 24))).toEqual([])
    expect(parser.push(texto.slice(24))).toEqual([ESTADO])
  })

  test('dos eventos en el mismo trozo salen los dos', () => {
    const parser = createPartyEventParser()

    expect(parser.push(bloque(ESTADO) + bloque(PING))).toEqual([ESTADO, PING])
  })

  test('un `data:` multilínea se une antes de analizarlo', () => {
    const parser = createPartyEventParser()
    const partido = `data: {"type":"ping",\ndata: "atMs":120}\n\n`

    expect(parser.push(partido)).toEqual([PING])
  })

  test('los comentarios y los campos que no son `data:` no producen nada', () => {
    const parser = createPartyEventParser()

    expect(parser.push(': keepalive\n\nevent: ping\n\n')).toEqual([])
    expect(parser.push(`: keepalive\nevent: ping\n${bloque(PING)}`)).toEqual([PING])
  })

  test('un evento inválido se descarta sin llevarse el siguiente', () => {
    const parser = createPartyEventParser()
    const basura = 'data: {"type":"state"}\n\ndata: esto no es json\n\n'

    expect(parser.push(basura + bloque(PING))).toEqual([PING])
  })

  test('los saltos `\\r\\n` también separan eventos', () => {
    const parser = createPartyEventParser()

    expect(parser.push(`data: ${JSON.stringify(PING)}\r\n\r\n`)).toEqual([PING])
  })

  test('un evento a medias no se entrega hasta que llega su línea en blanco', () => {
    const parser = createPartyEventParser()

    expect(parser.push(`data: ${JSON.stringify(PING)}\n`)).toEqual([])
    expect(parser.push('\n')).toEqual([PING])
  })

  test('el `welcome` se valida con el protocolo', () => {
    const parser = createPartyEventParser()
    const welcome: PartyEvent = {
      type: 'welcome',
      protocol: PARTY_PROTOCOL_VERSION,
      roomId: 'sala-1',
      expiresAt: 1000,
      state: null,
      roster: [],
    }

    expect(parser.push(bloque(welcome))).toEqual([welcome])
    expect(parser.push(`data: ${JSON.stringify({ ...welcome, protocol: 99 })}\n\n`)).toEqual([])
  })
})
