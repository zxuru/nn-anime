import { describe, expect, test } from 'bun:test'
import type { SearchEventPayload } from '@nn-anime/core/api'
import {
  createSseParser,
  parseEventText,
  readEventStream,
  searchRequestPath,
} from './stream-events'

function evento(providerId: string, title: string): SearchEventPayload {
  return {
    type: 'results',
    providerId,
    results: [{ ref: { providerId, value: title }, title }],
  }
}

function bloque(evento: SearchEventPayload): string {
  return `event: ${evento.type}\ndata: ${JSON.stringify(evento)}\n\n`
}

/** Respuesta con un cuerpo que llega por trozos, como el de verdad. */
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

describe('ruta de la petición', () => {
  test('sin consulta ni filtro, la ruta a secas', () => {
    expect(searchRequestPath('')).toBe('/api/search')
    expect(searchRequestPath('   ')).toBe('/api/search')
  })

  test('la consulta se recorta y el filtro se repite', () => {
    expect(searchRequestPath('  aurora  ')).toBe('/api/search?q=aurora')
    expect(searchRequestPath('a b', ['uno', 'dos'])).toBe(
      '/api/search?q=a%20b&provider=uno&provider=dos',
    )
  })

  test('los caracteres raros van escapados', () => {
    expect(searchRequestPath('a&b=c')).toBe('/api/search?q=a%26b%3Dc')
  })
})

describe('analizador de eventos', () => {
  test('un evento partido en trozos sale entero cuando llega el final', () => {
    const parser = createSseParser()
    const texto = bloque(evento('mio', 'Uno'))

    expect(parser.push(texto.slice(0, 12))).toEqual([])
    expect(parser.push(texto.slice(12, 20))).toEqual([])
    expect(parser.push(texto.slice(20))).toEqual([evento('mio', 'Uno')])
  })

  test('varios eventos en un solo trozo salen todos', () => {
    const parser = createSseParser()

    expect(parser.push(bloque(evento('uno', 'A')) + bloque(evento('dos', 'B')))).toEqual([
      evento('uno', 'A'),
      evento('dos', 'B'),
    ])
  })

  test('un evento con forma inválida se descarta sin romper el resto', () => {
    const parser = createSseParser()
    const basura = 'event: results\ndata: {"type":"results","providerId":"x"}\n\n'
    const raro = 'event: results\ndata: esto no es json\n\n'

    expect(parser.push(basura + raro + bloque(evento('mio', 'Uno')))).toEqual([
      evento('mio', 'Uno'),
    ])
  })

  test('un evento sin datos no produce nada', () => {
    expect(createSseParser().push('event: done\n\n')).toEqual([])
  })

  test('el texto completo se lee igual que el flujo', () => {
    const texto = bloque(evento('mio', 'Uno')) + bloque({ type: 'done', providers: 1 })

    expect(parseEventText(texto)).toEqual([evento('mio', 'Uno'), { type: 'done', providers: 1 }])
  })
})

describe('lectura del cuerpo', () => {
  test('los eventos salen en orden y sin esperar al final del cuerpo', async () => {
    const primero = evento('uno', 'A')
    const segundo = evento('dos', 'B')
    const response = responseFromChunks([
      bloque(primero),
      bloque(segundo),
      bloque({ type: 'done', providers: 2 }),
    ])

    const recibidos: SearchEventPayload[] = []
    for await (const event of readEventStream(response)) recibidos.push(event)

    expect(recibidos).toEqual([primero, segundo, { type: 'done', providers: 2 }])
  })

  test('un trozo que corta en mitad de un evento no lo pierde', async () => {
    const texto = bloque(evento('mio', 'Uno'))
    const response = responseFromChunks([texto.slice(0, 5), texto.slice(5, 25), texto.slice(25)])

    const recibidos: SearchEventPayload[] = []
    for await (const event of readEventStream(response)) recibidos.push(event)

    expect(recibidos).toEqual([evento('mio', 'Uno')])
  })

  test('un cuerpo vacío no produce ningún evento', async () => {
    const recibidos: SearchEventPayload[] = []
    for await (const event of readEventStream(responseFromChunks([]))) recibidos.push(event)

    expect(recibidos).toEqual([])
  })

  test('un 204 sin cuerpo tampoco rompe', async () => {
    const recibidos: SearchEventPayload[] = []
    for await (const event of readEventStream(new Response(null, { status: 204 }))) {
      recibidos.push(event)
    }

    expect(recibidos).toEqual([])
  })
})
