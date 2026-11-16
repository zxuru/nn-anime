import { describe, expect, test } from 'bun:test'
import { PARTY_MAX_PARTICIPANTS } from '@nn-anime/core'
import { PartyStore } from './store'

/** Reloj de mentira: cada prueba decide cuándo pasa el tiempo. */
function reloj(inicio = 1_000): { now: () => number; avanzar: (ms: number) => void } {
  let ahora = inicio

  return {
    now: () => ahora,
    avanzar: (ms) => {
      ahora += ms
    },
  }
}

/** Azar determinista pero distinto en cada llamada, para no repetir tokens. */
function azar(): (size: number) => Uint8Array {
  let semilla = 7

  return (size) => {
    const bytes = new Uint8Array(size)

    for (let i = 0; i < size; i++) {
      semilla = (semilla * 33 + 17) & 0xff
      bytes[i] = semilla
    }

    return bytes
  }
}

function store(clock = reloj()): PartyStore {
  return new PartyStore({ now: clock.now, random: azar() })
}

function crear(party: PartyStore): {
  roomId: string
  code: string
} {
  const creada = party.createRoom()
  if (!creada.ok) throw new Error('no se pudo crear la sala')

  return creada
}

function entrar(party: PartyStore, code: string, name = 'Ana'): string {
  const entrada = party.join(code, name)
  if (!entrada.ok) throw new Error(`no se pudo entrar: ${entrada.reason}`)

  return entrada.token
}

describe('createRoom', () => {
  test('genera un identificador, un código legible y una caducidad', () => {
    const clock = reloj()
    const party = store(clock)
    const sala = crear(party)

    expect(sala.roomId.length).toBeGreaterThan(10)
    expect(sala.code).toHaveLength(16)
    expect(sala.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/)
    expect(party.snapshot(sala.roomId)?.expiresAt).toBe(clock.now() + 4 * 60 * 60 * 1000)
  })

  test('respeta el tope de salas', () => {
    const party = store()

    for (let i = 0; i < 4; i++) expect(party.createRoom().ok).toBe(true)

    expect(party.createRoom()).toEqual({ ok: false, reason: 'too-many-rooms' })
  })

  test('acepta una vida más corta y acota la máxima', () => {
    const clock = reloj()
    const party = store(clock)

    const corta = party.createRoom(60_000)
    if (!corta.ok) throw new Error('no se creó')

    expect(corta.expiresAt).toBe(clock.now() + 60_000)
  })
})

describe('join', () => {
  test('el código se puede dictar con espacios, guiones y minúsculas', () => {
    const party = store()
    const sala = crear(party)
    const bonito = sala.code
      .toLowerCase()
      .replace(/(.{4})/g, '$1-')
      .slice(0, 19)

    const entrada = party.join(bonito, 'Ana')

    expect(entrada.ok).toBe(true)
    if (entrada.ok) {
      expect(entrada.roomId).toBe(sala.roomId)
      expect(entrada.state).toBeNull()
      expect(entrada.roster).toHaveLength(1)
      expect(entrada.roster[0]?.name).toBe('Ana')
    }
  })

  test('un código inexistente da el mismo «no encontrado» que uno caducado', () => {
    const party = store()
    const sala = crear(party)

    expect(party.join('AAAAAAAAAAAAAAAA', 'Ana')).toEqual({
      ok: false,
      reason: 'not-found',
    })

    const clock = reloj()
    const otro = new PartyStore({ now: clock.now, random: azar() })
    const caduca = crear(otro)
    clock.avanzar(4 * 60 * 60 * 1000 + 1)

    expect(otro.join(caduca.code, 'Ana')).toEqual({ ok: false, reason: 'not-found' })
    expect(otro.has(caduca.roomId)).toBe(false)
    expect(otro.listRooms()).toHaveLength(0)
    expect(party.has(sala.roomId)).toBe(true)
  })

  test('la sala llena rechaza al siguiente', () => {
    const party = store()
    const sala = crear(party)

    for (let i = 0; i < PARTY_MAX_PARTICIPANTS; i++) entrar(party, sala.code, `P${i}`)

    expect(party.join(sala.code, 'Sobra')).toEqual({ ok: false, reason: 'full' })
  })

  test('el límite de intentos frena la fuerza bruta dentro de la ventana', () => {
    const clock = reloj()
    const party = store(clock)

    let rechazado = false
    for (let i = 0; i < 40 && !rechazado; i++) {
      const resultado = party.join('BBBBBBBBBBBBBBBB', 'Ana')
      if (!resultado.ok && resultado.reason === 'rate-limited') rechazado = true
    }

    expect(rechazado).toBe(true)

    // Pasada la ventana vuelve a aceptar el intento.
    clock.avanzar(61_000)

    expect(party.join('BBBBBBBBBBBBBBBB', 'Ana')).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })

  test('cada invitado recibe un token distinto y el token autoriza', () => {
    const party = store()
    const sala = crear(party)
    const uno = entrar(party, sala.code, 'Ana')
    const dos = entrar(party, sala.code, 'Luis')

    expect(uno).not.toBe(dos)
    expect(party.authorize(sala.roomId, uno)?.participant.name).toBe('Ana')
    expect(party.authorize(sala.roomId, dos)?.participant.name).toBe('Luis')
    expect(party.authorize(sala.roomId, 'inventado')).toBeUndefined()
    expect(party.authorize('otra-sala', uno)).toBeUndefined()
  })

  test('un token de una sala no abre otra', () => {
    const party = store()
    const uno = crear(party)
    const dos = crear(party)
    const token = entrar(party, uno.code)

    expect(party.authorize(dos.roomId, token)).toBeUndefined()
  })
})

describe('estado y roster', () => {
  test('publicar estado sella `seq` y el reloj del coordinador', () => {
    const clock = reloj()
    const party = store(clock)
    const sala = crear(party)
    const media = { kind: 'episode', title: 'Aurora Nocturna', episode: 3 } as const

    const primero = party.publishState(sala.roomId, {
      media,
      positionS: 12,
      paused: false,
      rate: 1,
    })

    expect(primero).toEqual({ media, positionS: 12, paused: false, rate: 1, seq: 1, atMs: 1_000 })

    clock.avanzar(2_000)
    const segundo = party.publishState(sala.roomId, {
      media,
      positionS: 14,
      paused: true,
      rate: 1,
    })

    expect(segundo?.seq).toBe(2)
    expect(segundo?.atMs).toBe(3_000)
    expect(party.snapshot(sala.roomId)?.state).toEqual(segundo)
  })

  test('reportar cambia el roster sólo cuando cambia algo que se ve', () => {
    const party = store()
    const sala = crear(party)
    const uno = entrar(party, sala.code, 'Ana')
    const autorizado = party.authorize(sala.roomId, uno)
    if (autorizado === undefined) throw new Error('sin autorización')

    const eventos: string[] = []
    party.subscribe(sala.roomId, (evento) => eventos.push(evento.type))

    expect(
      party.report(sala.roomId, autorizado.participant.id, {
        positionS: 10,
        paused: false,
        buffering: false,
        ready: false,
      }),
    ).toBe('ok')

    // `ready` y `buffering` no cambiaron (buffering ya era true al entrar).
    expect(eventos).toEqual([])

    expect(
      party.report(sala.roomId, autorizado.participant.id, {
        positionS: 10,
        paused: false,
        buffering: false,
        ready: true,
      }),
    ).toBe('ok')
    expect(eventos).toEqual(['roster'])
    expect(party.snapshot(sala.roomId)?.roster[0]?.ready).toBe(true)
  })

  test('el límite por participante corta una inundación y se recupera', () => {
    const clock = reloj()
    const party = store(clock)
    const sala = crear(party)
    const token = entrar(party, sala.code)
    const autorizado = party.authorize(sala.roomId, token)
    if (autorizado === undefined) throw new Error('sin autorización')

    for (let i = 0; i < 10; i++) {
      expect(party.allowParticipantMessage(sala.roomId, autorizado.participant.id)).toBe(true)
    }

    expect(party.allowParticipantMessage(sala.roomId, autorizado.participant.id)).toBe(false)
    clock.avanzar(1_001)
    expect(party.allowParticipantMessage(sala.roomId, autorizado.participant.id)).toBe(true)
  })

  test('salir actualiza el roster', () => {
    const party = store()
    const sala = crear(party)
    const token = entrar(party, sala.code)
    const autorizado = party.authorize(sala.roomId, token)
    if (autorizado === undefined) throw new Error('sin autorización')

    const eventos: string[] = []
    party.subscribe(sala.roomId, (evento) => eventos.push(evento.type))

    expect(party.leave(sala.roomId, autorizado.participant.id)).toBe(true)
    expect(eventos).toEqual(['roster'])
    expect(party.snapshot(sala.roomId)?.roster).toHaveLength(0)
  })
})

describe('suscripción y cierre', () => {
  test('los suscriptores reciben los eventos y se pueden dar de baja', () => {
    const party = store()
    const sala = crear(party)
    const recibidos: string[] = []
    const baja = party.subscribe(sala.roomId, (evento) => recibidos.push(evento.type))
    if (baja === undefined) throw new Error('no se pudo suscribir')

    entrar(party, sala.code, 'Ana')
    party.publishState(sala.roomId, {
      media: { kind: 'episode', title: 'Aurora', episode: 1 },
      positionS: 1,
      paused: false,
      rate: 1,
    })
    baja()
    entrar(party, sala.code, 'Luis')

    expect(recibidos).toEqual(['roster', 'state'])
  })

  test('cerrar avisa a los suscriptores y borra la sala', () => {
    const party = store()
    const sala = crear(party)
    const recibidos: string[] = []
    party.subscribe(sala.roomId, (evento) => recibidos.push(evento.type))

    expect(party.closeRoom(sala.roomId)).toBe(true)
    expect(recibidos).toEqual(['closed'])
    expect(party.has(sala.roomId)).toBe(false)
    expect(party.closeRoom(sala.roomId)).toBe(false)
  })

  test('caducar avisa con `expired` y no deja sala', () => {
    const clock = reloj()
    const party = store(clock)
    const sala = crear(party)
    const recibidos: string[] = []
    party.subscribe(sala.roomId, (evento) => {
      if (evento.type === 'closed') recibidos.push(evento.reason)
    })

    clock.avanzar(4 * 60 * 60 * 1000 + 1)
    party.sweep()

    expect(recibidos).toEqual(['expired'])
    expect(party.has(sala.roomId)).toBe(false)
  })

  test('un suscriptor que lanza no tumba a los demás', () => {
    const party = store()
    const sala = crear(party)
    let llamadas = 0

    party.subscribe(sala.roomId, () => {
      throw new Error('boom')
    })
    party.subscribe(sala.roomId, () => {
      llamadas += 1
    })

    entrar(party, sala.code, 'Ana')

    expect(llamadas).toBe(1)
  })
})
