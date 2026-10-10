import { describe, expect, test } from 'bun:test'
import { createLogger } from '@nn-anime/core'
import { createTicketStore, DEFAULT_CAPACITY, DEFAULT_TTL_S, ticketError } from './ticket-store'

const URL = 'https://fixture.invalid/aurora/1/sub/master.m3u8'

function conReloj(inicio = 1_000_000) {
  let ahora = inicio
  const store = createTicketStore({ now: () => ahora })

  return {
    store,
    avanzar(ms: number) {
      ahora += ms
    },
  }
}

describe('emisión y resolución', () => {
  test('un ticket resuelve a su URL y sus headers', () => {
    const store = createTicketStore()
    const ticket = store.issue({ url: URL, headers: { Referer: 'https://sitio.example' } })

    const salida = store.resolve(ticket)

    expect(salida.ok).toBe(true)
    if (salida.ok) {
      expect(salida.contents.url).toBe(URL)
      expect(salida.contents.headers).toEqual({ Referer: 'https://sitio.example' })
    }
  })

  test('los tickets son distintos y no llevan la URL dentro', () => {
    const store = createTicketStore()
    const uno = store.issue({ url: URL, headers: {} })
    const dos = store.issue({ url: URL, headers: {} })

    expect(uno).not.toBe(dos)
    expect(uno).not.toContain('fixture')
    expect(uno).not.toContain('m3u8')
    expect(uno.length).toBeGreaterThanOrEqual(30)
  })

  test('un ticket que no existe es `unknown`, no una excepción', () => {
    const store = createTicketStore()

    expect(store.resolve('inventado')).toEqual({ ok: false, kind: 'unknown' })
    expect(store.resolve('')).toEqual({ ok: false, kind: 'unknown' })
  })

  test('el tamaño cuenta lo vivo, y no hay forma de listarlos', () => {
    const store = createTicketStore()
    store.issue({ url: URL, headers: {} })
    store.issue({ url: URL, headers: {} })

    expect(store.size()).toBe(2)
    expect(Object.keys(store).sort()).toEqual(['issue', 'prune', 'resolve', 'size'])
  })
})

describe('caducidad', () => {
  test('el TTL por defecto es el del spec', () => {
    expect(DEFAULT_TTL_S).toBe(600)
    expect(DEFAULT_CAPACITY).toBe(500)
  })

  test('justo antes del TTL se resuelve; al cumplirse, da `expired`', () => {
    const { store, avanzar } = conReloj()
    const ticket = store.issue({ url: URL, headers: {} })

    avanzar(DEFAULT_TTL_S * 1000 - 1)
    expect(store.resolve(ticket).ok).toBe(true)

    avanzar(1)
    expect(store.resolve(ticket)).toEqual({ ok: false, kind: 'expired' })
  })

  test('un ticket vencido se borra al intentar resolverlo', () => {
    const { store, avanzar } = conReloj()
    const ticket = store.issue({ url: URL, headers: {} })

    avanzar(DEFAULT_TTL_S * 1000)
    store.resolve(ticket)

    expect(store.size()).toBe(0)
  })

  test('un TTL propio manda sobre el del almacén', () => {
    const { store, avanzar } = conReloj()
    const ticket = store.issue({ url: URL, headers: {} }, 5)

    avanzar(5_000)
    expect(store.resolve(ticket)).toEqual({ ok: false, kind: 'expired' })
  })

  test('prune quita los vencidos y deja los vivos', () => {
    const { store, avanzar } = conReloj()
    const viejo = store.issue({ url: URL, headers: {} }, 10)
    avanzar(10_000)
    const nuevo = store.issue({ url: URL, headers: {} })

    expect(store.prune()).toBe(1)
    expect(store.size()).toBe(1)
    expect(store.resolve(viejo).ok).toBe(false)
    expect(store.resolve(nuevo).ok).toBe(true)
  })

  test('el error distingue vencido de desconocido', () => {
    const vencido = ticketError('expired', 'abc')
    const desconocido = ticketError('unknown', 'abc')

    expect(vencido.message).toContain('caducó')
    expect(desconocido.message).toContain('no existe')
    expect(vencido.context.kind).toBe('expired')
    // El mensaje no lleva el ticket: un error se registra, y un ticket no.
    expect(vencido.message).not.toContain('abc')
  })
})

describe('tope y desalojo', () => {
  test('600 tickets dejan 500 vivos y los 100 más viejos fuera', () => {
    const store = createTicketStore()
    const emitidos = Array.from({ length: 600 }, () => store.issue({ url: URL, headers: {} }))

    expect(store.size()).toBe(DEFAULT_CAPACITY)

    const vivos = emitidos.filter((ticket) => store.resolve(ticket).ok)
    const fuera = emitidos.filter((ticket) => {
      const salida = store.resolve(ticket)

      return !salida.ok && salida.kind === 'unknown'
    })

    expect(vivos).toHaveLength(500)
    expect(fuera).toHaveLength(100)
    // Los que se fueron son los primeros, no cualesquiera.
    expect(fuera).toEqual(emitidos.slice(0, 100))
  })

  test('resolver un ticket lo rejuvenece: el desalojo se lleva otro', () => {
    const store = createTicketStore({ capacity: 3 })
    const uno = store.issue({ url: URL, headers: {} })
    const dos = store.issue({ url: URL, headers: {} })
    const tres = store.issue({ url: URL, headers: {} })

    // `uno` pasa a ser la última usada.
    expect(store.resolve(uno).ok).toBe(true)

    const cuatro = store.issue({ url: URL, headers: {} })

    const desalojado = store.resolve(dos)
    expect(desalojado.ok).toBe(false)
    if (!desalojado.ok) expect(desalojado.kind).toBe('unknown')
    expect(store.resolve(uno).ok).toBe(true)
    expect(store.resolve(tres).ok).toBe(true)
    expect(store.resolve(cuatro).ok).toBe(true)
  })

  test('un tope de uno deja el último emitido', () => {
    const store = createTicketStore({ capacity: 1 })
    const primero = store.issue({ url: URL, headers: {} })
    const segundo = store.issue({ url: URL, headers: {} })

    const desalojado = store.resolve(primero)
    expect(desalojado.ok).toBe(false)
    if (!desalojado.ok) expect(desalojado.kind).toBe('unknown')
    expect(store.resolve(segundo).ok).toBe(true)
    expect(store.size()).toBe(1)
  })
})

describe('nada de esto se registra', () => {
  test('la representación del almacén no contiene ningún ticket', () => {
    const store = createTicketStore()
    const ticket = store.issue({ url: URL, headers: { Referer: 'https://sitio.example' } })

    expect(JSON.stringify(store)).not.toContain(ticket)
    expect(Bun.inspect(store)).not.toContain(ticket)
    expect(JSON.stringify(store)).not.toContain('fixture.invalid')
  })

  test('un log con el campo `ticket` sale redactado, también en debug', () => {
    const lineas: string[] = []
    const logger = createLogger({
      level: 'debug',
      sink: (linea) => lineas.push(JSON.stringify(linea)),
    })
    const store = createTicketStore()
    const ticket = store.issue({ url: URL, headers: {} })

    logger.debug('resolviendo stream', { ticket, url: URL })
    logger.info('listo', { ticket })

    expect(lineas.length).toBe(2)
    for (const linea of lineas) {
      expect(linea).not.toContain(ticket)
    }
  })
})
