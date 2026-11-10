import { describe, expect, test } from 'bun:test'
import {
  formatRoomCode,
  isRoomCode,
  normalizeRoomCode,
  PARTY_DRIFT_OK_S,
  PARTY_DRIFT_RATE_S,
  PARTY_DRIFT_SEEK_S,
  PARTY_MAX_NAME_LENGTH,
  partyClockOffset,
  partyCorrection,
  partyEventSchema,
  partyJoinRequestSchema,
  partyMediaSchema,
  partyStateSchema,
  partyTargetPositionS,
  roomCodeFromBytes,
} from './party'

const MEDIA = { kind: 'episode', title: 'Aurora Nocturna', episode: 3, season: 1 } as const

const STATE = {
  media: MEDIA,
  positionS: 100,
  paused: false,
  rate: 1,
  seq: 4,
  atMs: 1_000,
} as const

describe('partyMediaSchema', () => {
  test('un episodio se identifica sin referencia de proveedor', () => {
    expect(partyMediaSchema.parse(MEDIA)).toEqual(MEDIA)
  })

  test('un episodio sin número no es un episodio', () => {
    const sinNumero = { kind: 'episode', title: 'Aurora Nocturna' }

    expect(partyMediaSchema.safeParse(sinNumero).success).toBe(false)
  })

  test('una película no lleva número de episodio', () => {
    const pelicula = { kind: 'movie', title: 'El jardín de hierro', episode: 1 }

    expect(partyMediaSchema.safeParse(pelicula).success).toBe(false)
  })

  test('no admite claves que no son del contrato', () => {
    const conUrl = { ...MEDIA, streamUrl: 'http://192.0.2.1/video.m3u8' }

    expect(partyMediaSchema.safeParse(conUrl).success).toBe(false)
  })
})

describe('partyStateSchema', () => {
  test('acepta el estado completo', () => {
    expect(partyStateSchema.parse(STATE)).toEqual(STATE)
  })

  test('un estado no lleva URLs ni tickets', () => {
    const serializado = JSON.stringify(partyStateSchema.parse(STATE))

    expect(serializado).not.toContain('http')
    expect(serializado).not.toContain('/stream/')
    expect(serializado).not.toContain('ticket')
  })

  test('la posición y la velocidad tienen límites', () => {
    expect(partyStateSchema.safeParse({ ...STATE, positionS: -1 }).success).toBe(false)
    expect(partyStateSchema.safeParse({ ...STATE, rate: 0 }).success).toBe(false)
    expect(partyStateSchema.safeParse({ ...STATE, rate: 100 }).success).toBe(false)
  })
})

describe('partyJoinRequestSchema', () => {
  test('el nombre se recorta y tiene tope', () => {
    expect(partyJoinRequestSchema.parse({ code: 'ABC', name: '  Ana  ' }).name).toBe('Ana')
    expect(
      partyJoinRequestSchema.safeParse({
        code: 'ABC',
        name: 'x'.repeat(PARTY_MAX_NAME_LENGTH + 1),
      }).success,
    ).toBe(false)
  })
})

describe('partyEventSchema', () => {
  test('los eventos del coordinador se distinguen por tipo', () => {
    expect(partyEventSchema.parse({ type: 'ping', atMs: 10 })).toEqual({ type: 'ping', atMs: 10 })
    expect(partyEventSchema.parse({ type: 'closed', reason: 'host-left' })).toEqual({
      type: 'closed',
      reason: 'host-left',
    })
    expect(partyEventSchema.safeParse({ type: 'closed', reason: 'otra' }).success).toBe(false)
  })
})

describe('normalizeRoomCode', () => {
  test('acepta un código dictado con espacios, guiones y minúsculas', () => {
    expect(normalizeRoomCode('abcd-efgh-jkmn-pqrs')).toBe('ABCDEFGHJKMNPQRS')
  })

  test('las letras que Crockford prohíbe se corrigen, no se rechazan', () => {
    expect(normalizeRoomCode('ABCD-EFGH-JKMN-PQRS')).toBe('ABCDEFGHJKMNPQRS')
    expect(normalizeRoomCode('IL0O-EFGH-JKMN-PQRS')).toBe('1100EFGHJKMNPQRS')
  })

  test('la longitud es la que es', () => {
    expect(normalizeRoomCode('ABCD')).toBeUndefined()
    expect(normalizeRoomCode('ABCDEFGHJKMNPQRSX')).toBeUndefined()
  })

  test('una letra fuera del alfabeto no entra', () => {
    // La U no se usa en Crockford: si aparece, el código está mal copiado.
    expect(normalizeRoomCode('ABCD-EFGH-JKMN-PQRU')).toBeUndefined()
  })
})

describe('formatRoomCode', () => {
  test('se muestra en grupos de cuatro', () => {
    expect(formatRoomCode('ABCDEFGHJKMNPQRS')).toBe('ABCD-EFGH-JKMN-PQRS')
  })

  test('un código ya formateado no se rompe', () => {
    expect(formatRoomCode('ABCD')).toBe('ABCD')
  })
})

describe('isRoomCode', () => {
  test('sólo acepta la forma canónica', () => {
    expect(isRoomCode('ABCDEFGHJKMNPQRS')).toBe(true)
    expect(isRoomCode('abcdefghjkmnpqrs')).toBe(false)
    expect(isRoomCode('ABCD-EFGH-JKMN-PQRS')).toBe(false)
  })
})

describe('roomCodeFromBytes', () => {
  test('diez bytes dan un código de dieciséis caracteres del alfabeto', () => {
    const bytes = Uint8Array.from({ length: 10 }, (_, index) => index * 25)
    const code = roomCodeFromBytes(bytes)

    expect(code).toHaveLength(16)
    expect(isRoomCode(code)).toBe(true)
  })

  test('bytes distintos dan códigos distintos', () => {
    const uno = roomCodeFromBytes(new Uint8Array(10).fill(0))
    const otro = roomCodeFromBytes(new Uint8Array(10).fill(1))

    expect(uno).not.toBe(otro)
  })

  test('con menos de diez bytes no hay entropía suficiente', () => {
    expect(() => roomCodeFromBytes(new Uint8Array(9))).toThrow(RangeError)
  })
})

describe('partyClockOffset', () => {
  test('sin muestras no hay desfase', () => {
    expect(partyClockOffset([])).toBe(0)
  })

  test('la mediana ignora un pico de latencia', () => {
    // Servidor 5 000 ms por delante del cliente; la última muestra tiene 400 ms
    // de ida y vuelta asimétrica y no debe arrastrar la estimación.
    const muestras = [
      { t0: 1_000, t1: 6_010, t2: 6_010, t3: 1_020 },
      { t0: 2_000, t1: 7_010, t2: 7_010, t3: 2_020 },
      { t0: 3_000, t1: 8_400, t2: 8_400, t3: 3_400 },
      { t0: 4_000, t1: 9_010, t2: 9_010, t3: 4_020 },
      { t0: 5_000, t1: 10_010, t2: 10_010, t3: 5_020 },
    ]

    expect(partyClockOffset(muestras)).toBe(5_000)
  })

  test('con un número par de muestras promedia las dos centrales', () => {
    const muestras = [
      { t0: 0, t1: 1_010, t2: 1_010, t3: 20 },
      { t0: 0, t1: 1_030, t2: 1_030, t3: 20 },
    ]

    expect(partyClockOffset(muestras)).toBe(1_010)
  })
})

describe('partyTargetPositionS', () => {
  test('en pausa el objetivo no avanza', () => {
    const pausado = { ...STATE, paused: true }

    expect(partyTargetPositionS(pausado, 9_000, 0)).toBe(100)
  })

  test('reproduciendo extrapola con el reloj y la velocidad', () => {
    // Estado sellado en 1 000 ms; el cliente va 2 000 ms por detrás y pasan 5 s.
    expect(partyTargetPositionS(STATE, 6_000, 2_000)).toBe(107)
  })

  test('la velocidad del anfitrión se respeta', () => {
    expect(partyTargetPositionS({ ...STATE, rate: 1.5 }, 6_000, 2_000)).toBe(110.5)
  })

  test('no devuelve posiciones negativas ni absurdas', () => {
    expect(partyTargetPositionS(STATE, 0, 0)).toBe(100)
    expect(partyTargetPositionS({ ...STATE, positionS: 0, atMs: 0 }, 10, 0)).toBeCloseTo(0.01, 5)
  })
})

describe('partyCorrection', () => {
  const base = {
    currentS: 100,
    paused: false,
    nowMs: 6_000,
    offsetMs: 2_000,
  } as const

  test('sin deriva no se toca nada', () => {
    // Objetivo 107; el cliente va por 106,9: 0,1 s, dentro del umbral de ajuste.
    expect(partyCorrection({ ...base, currentS: 106.9, state: STATE })).toEqual({ kind: 'none' })
  })

  test('una deriva mediana se corrige con la velocidad, no con un salto', () => {
    const correccion = partyCorrection({ ...base, currentS: 106, state: STATE })

    expect(correccion.kind).toBe('rate')
    if (correccion.kind === 'rate') expect(correccion.rate).toBeCloseTo(1.05, 5)
  })

  test('una deriva pequeña hacia atrás baja la velocidad', () => {
    const correccion = partyCorrection({ ...base, currentS: 107.2, state: STATE })

    // 0,2 s por delante del objetivo: se frena un poco, no se salta.
    expect(correccion.kind).toBe('rate')
    if (correccion.kind === 'rate') expect(correccion.rate).toBeCloseTo(0.95, 5)
  })

  test('una deriva grande salta', () => {
    expect(partyCorrection({ ...base, currentS: 90, state: STATE })).toEqual({
      kind: 'seek',
      targetS: 107,
    })
  })

  test('si el anfitrión pausó, el invitado pausa', () => {
    const pausado = { ...STATE, paused: true }

    expect(partyCorrection({ ...base, state: pausado })).toEqual({
      kind: 'pause',
      targetS: 100,
    })
  })

  test('si el anfitrión pausó y el invitado va lejos, salta antes de pausar', () => {
    const pausado = { ...STATE, paused: true }

    expect(partyCorrection({ ...base, currentS: 200, state: pausado })).toEqual({
      kind: 'seek',
      targetS: 100,
    })
  })

  test('si el invitado está pausado y el anfitrión no, el invitado arranca', () => {
    expect(partyCorrection({ ...base, paused: true, currentS: 100, state: STATE })).toEqual({
      kind: 'play',
      targetS: 107,
    })
  })

  test('si el anfitrión pausó y el invitado ya está pausado, no se pausa dos veces', () => {
    expect(
      partyCorrection({ ...base, paused: true, currentS: 100, state: { ...STATE, paused: true } }),
    ).toEqual({ kind: 'none' })
  })

  test('los umbrales y la tasa no son valores sueltos', () => {
    // Corrección fina desde 0,15 s; «sincronizado» se anuncia hasta 0,5 s; y a
    // partir de 1,5 s se salta. Un cambio de orden cambiaría la política.
    expect(PARTY_DRIFT_RATE_S).toBeLessThan(PARTY_DRIFT_OK_S)
    expect(PARTY_DRIFT_OK_S).toBeLessThan(PARTY_DRIFT_SEEK_S)
  })
})
