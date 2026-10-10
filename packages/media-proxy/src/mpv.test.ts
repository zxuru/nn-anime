import { describe, expect, test } from 'bun:test'
import {
  createMpvPlayer,
  HEADER_FIELD_FLAG,
  hasMpv,
  MAX_STDERR_BYTES,
  type MpvEvent,
  type MpvProcess,
  mpvArgs,
  mpvUnavailable,
  trimStderr,
} from './mpv'

/** Proceso de mentira, que se puede terminar a voluntad. */
function procesoFalso(pid: number, stderr = '') {
  let terminar: (code: number) => void = () => {}
  const exited = new Promise<number>((resolver) => {
    terminar = resolver
  })
  const señales: (string | undefined)[] = []

  return {
    process: {
      pid,
      exited,
      kill: (signal?: string) => {
        señales.push(signal)
        terminar(0)
      },
      stderr: async () => stderr,
    } satisfies MpvProcess,
    señales,
    terminar,
  }
}

async function recoger(flujo: AsyncIterable<MpvEvent>, cuantos: number): Promise<MpvEvent[]> {
  const eventos: MpvEvent[] = []

  for await (const evento of flujo) {
    eventos.push(evento)
    if (eventos.length >= cuantos) break
  }

  return eventos
}

describe('recorte del stderr', () => {
  test('el tope es el del spec', () => {
    expect(MAX_STDERR_BYTES).toBe(2048)
  })

  test('lo corto se deja igual', () => {
    expect(trimStderr('error corto')).toBe('error corto')
  })

  test('lo largo se recorta y lo dice', () => {
    const largo = 'x'.repeat(MAX_STDERR_BYTES + 500)
    const salida = trimStderr(largo)

    expect(salida.length).toBeLessThanOrEqual(MAX_STDERR_BYTES + 20)
    expect(salida).toContain('recortado')
  })
})

describe('disponibilidad', () => {
  test('sin mpv en el PATH no se puede lanzar', () => {
    const player = createMpvPlayer({ spawn: () => procesoFalso(1).process, available: false })

    expect(player.play({ url: 'x' })).toEqual({ ok: false, reason: 'unavailable' })
  })

  test('`hasMpv` responde sí y no', async () => {
    expect(await hasMpv(async () => '/usr/bin/mpv')).toBe(true)
    expect(await hasMpv(async () => undefined)).toBe(false)
  })

  test('si `which` falla, se considera que no está', async () => {
    expect(
      await hasMpv(async () => {
        throw new Error('sin PATH')
      }),
    ).toBe(false)
  })

  test('el error de mpv ausente dice qué hacer', () => {
    const error = mpvUnavailable()

    expect(error.message).toContain('mpv')
    expect(error.message).toContain('navegador')
  })
})

describe('lanzar y seguir', () => {
  test('emite `starting` y después `playing`', async () => {
    const falso = procesoFalso(4242)
    const player = createMpvPlayer({
      spawn: () => falso.process,
      playingDelayMs: 1,
    })

    const eventos = recoger(player.events(), 2)
    const salida = player.play({ url: 'http://127.0.0.1/stream/abc' })

    expect(salida).toEqual({ ok: true, pid: 4242 })
    expect(await eventos).toEqual([
      { type: 'starting', pid: 4242 },
      { type: 'playing', pid: 4242 },
    ])

    await player.close()
  })

  test('una salida distinta de cero es `failed` con el stderr recortado', async () => {
    const falso = procesoFalso(7, 'x'.repeat(MAX_STDERR_BYTES + 100))
    const player = createMpvPlayer({ spawn: () => falso.process, playingDelayMs: 1000 })

    const eventos = recoger(player.events(), 2)
    player.play({ url: 'x' })
    falso.terminar(2)

    const recibidos = await eventos

    expect(recibidos[0]).toEqual({ type: 'starting', pid: 7 })
    expect(recibidos[1]?.type).toBe('failed')
    if (recibidos[1]?.type === 'failed') {
      expect(recibidos[1].code).toBe(2)
      expect(recibidos[1].stderr).toContain('recortado')
    }

    await player.close()
  })

  test('una salida cero es `exited`', async () => {
    const falso = procesoFalso(9)
    const player = createMpvPlayer({ spawn: () => falso.process, playingDelayMs: 1000 })

    const eventos = recoger(player.events(), 2)
    player.play({ url: 'x' })
    falso.terminar(0)

    expect((await eventos)[1]).toEqual({ type: 'exited', pid: 9, code: 0 })

    await player.close()
  })

  test('el contador de vivos sube y baja', async () => {
    const falso = procesoFalso(11)
    const player = createMpvPlayer({ spawn: () => falso.process, playingDelayMs: 1000 })

    expect(player.running).toBe(0)
    player.play({ url: 'x' })
    expect(player.running).toBe(1)

    falso.terminar(0)
    for (let intento = 0; intento < 50 && player.running > 0; intento++) await Bun.sleep(2)

    expect(player.running).toBe(0)

    await player.close()
  })

  test('dos suscriptores reciben lo mismo', async () => {
    const falso = procesoFalso(12)
    const player = createMpvPlayer({ spawn: () => falso.process, playingDelayMs: 1 })

    const uno = recoger(player.events(), 2)
    const dos = recoger(player.events(), 2)
    player.play({ url: 'x' })

    expect(await uno).toEqual(await dos)

    await player.close()
  })
})

describe('parar y cerrar', () => {
  test('`stop` mata el proceso por su pid', async () => {
    const falso = procesoFalso(21)
    const player = createMpvPlayer({ spawn: () => falso.process, playingDelayMs: 1000 })

    const eventos = recoger(player.events(), 2)
    player.play({ url: 'x' })

    expect(player.stop(21)).toBe(true)
    expect(falso.señales).toHaveLength(1)
    expect((await eventos)[1]).toEqual({ type: 'exited', pid: 21, code: 0 })
  })

  test('`stop` de un pid que no existe devuelve falso', () => {
    expect(createMpvPlayer({ spawn: () => procesoFalso(1).process }).stop(999)).toBe(false)
  })

  test('`close` mata todo lo que siga vivo', async () => {
    const uno = procesoFalso(31)
    const dos = procesoFalso(32)
    const player = createMpvPlayer({
      spawn: () => (player.running === 0 ? uno.process : dos.process),
      maxConcurrent: 5,
      playingDelayMs: 1000,
    })

    player.play({ url: 'a' })
    player.play({ url: 'b' })
    expect(player.running).toBe(2)

    await player.close()

    expect(uno.señales).toHaveLength(1)
    expect(dos.señales).toHaveLength(1)
    expect(player.running).toBe(0)
  })
})

describe('tope de procesos', () => {
  test('con el tope en uno, el segundo intento dice que está ocupado', () => {
    const player = createMpvPlayer({ spawn: () => procesoFalso(41).process, maxConcurrent: 1 })

    expect(player.play({ url: 'a' })).toEqual({ ok: true, pid: 41 })
    expect(player.play({ url: 'b' })).toEqual({ ok: false, reason: 'busy' })
  })
})
