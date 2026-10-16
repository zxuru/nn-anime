import { describe, expect, test } from 'bun:test'
import {
  type Chunk,
  type ClosingReason,
  createLifecycle,
  exitCodeFor,
  SHUTDOWN_LINE,
  type SignalTarget,
  type StdinTarget,
  signalExitCode,
  type TerminatingSignal,
  waitForClose,
} from './lifecycle'

interface FakeTarget extends SignalTarget {
  emit(event: TerminatingSignal): void
  listeners(event: TerminatingSignal): number
}

function fakeTarget(): FakeTarget {
  const handlers = new Map<TerminatingSignal, Set<() => void>>()

  return {
    on(event, handler) {
      const set = handlers.get(event) ?? new Set()
      set.add(handler)
      handlers.set(event, set)
      return undefined
    },
    off(event, handler) {
      handlers.get(event)?.delete(handler)
      return undefined
    },
    emit(event) {
      for (const handler of [...(handlers.get(event) ?? [])]) handler()
    },
    listeners(event) {
      return handlers.get(event)?.size ?? 0
    },
  }
}

/**
 * La entrada estándar de mentira.
 *
 * Anota a qué eventos se suscribe, que es lo que permite afirmar que el fin de la
 * entrada **no** cierra: si alguien añade la escucha de `end`, la prueba lo dice.
 */
interface FakeStdin extends StdinTarget {
  write(text: string): void
  listeners(): number
  events(): readonly string[]
}

function fakeStdin(): FakeStdin {
  const handlers = new Set<(chunk: Chunk) => void>()
  const events: string[] = []

  return {
    on(event, handler) {
      events.push(event)
      handlers.add(handler)
      return undefined
    },
    off(_event, handler) {
      handlers.delete(handler)
      return undefined
    },
    write(text) {
      for (const handler of [...handlers]) handler(text)
    },
    listeners() {
      return handlers.size
    },
    events() {
      return events
    },
  }
}

describe('createLifecycle', () => {
  test('ejecuta los cierres en orden de registro', async () => {
    const lifecycle = createLifecycle()
    const order: string[] = []

    lifecycle.onShutdown(() => {
      order.push('primero')
    })
    lifecycle.onShutdown(() => {
      order.push('segundo')
    })

    await lifecycle.shutdown()

    expect(order).toEqual(['primero', 'segundo'])
  })

  test('espera a los cierres asíncronos', async () => {
    const lifecycle = createLifecycle()
    let finished = false

    lifecycle.onShutdown(async () => {
      await Bun.sleep(5)
      finished = true
    })

    await lifecycle.shutdown()

    expect(finished).toBe(true)
  })

  test('un cierre que falla no impide los siguientes', async () => {
    const lifecycle = createLifecycle()
    const ran: string[] = []

    lifecycle.onShutdown(() => {
      throw new Error('cerró mal')
    })
    lifecycle.onShutdown(() => {
      ran.push('segundo')
    })

    await lifecycle.shutdown()

    expect(ran).toEqual(['segundo'])
  })

  test('informa del cierre que falló en lugar de tragárselo', async () => {
    const errors: unknown[] = []
    const lifecycle = createLifecycle({ onError: (error) => errors.push(error) })

    lifecycle.onShutdown(() => {
      throw new Error('cerró mal')
    })

    await lifecycle.shutdown()

    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('cerró mal')
  })

  test('el desregistro quita el cierre', async () => {
    const lifecycle = createLifecycle()
    let ran = false

    const unregister = lifecycle.onShutdown(() => {
      ran = true
    })
    expect(lifecycle.size).toBe(1)

    unregister()
    expect(lifecycle.size).toBe(0)

    await lifecycle.shutdown()
    expect(ran).toBe(false)
  })

  test('es idempotente: el segundo cierre no repite el trabajo', async () => {
    const lifecycle = createLifecycle()
    let count = 0

    lifecycle.onShutdown(() => {
      count += 1
    })

    const first = lifecycle.shutdown()
    const second = lifecycle.shutdown()

    await Promise.all([first, second])

    expect(count).toBe(1)
    expect(first).toBe(second)
  })

  test('sin cierres registrados, cerrar no falla', async () => {
    await createLifecycle().shutdown()
    expect(true).toBe(true)
  })
})

describe('signalExitCode', () => {
  test('Ctrl+C sale con 130', () => {
    expect(signalExitCode('SIGINT')).toBe(130)
  })

  test('SIGTERM sale con 143', () => {
    expect(signalExitCode('SIGTERM')).toBe(143)
  })
})

describe('exitCodeFor', () => {
  test('las señales conservan su convención de shell', () => {
    expect(exitCodeFor('SIGINT')).toBe(130)
    expect(exitCodeFor('SIGTERM')).toBe(143)
  })

  test('un cierre pedido por la entrada estándar sale con 0', () => {
    expect(exitCodeFor('stdin')).toBe(0)
  })
})

describe('waitForClose', () => {
  test('resuelve con SIGINT cuando llega la interrupción', async () => {
    const target = fakeTarget()
    const waiting = waitForClose(target, fakeStdin())

    target.emit('SIGINT')

    expect(await waiting).toBe('SIGINT')
  })

  test('resuelve con SIGTERM cuando llega la terminación', async () => {
    const target = fakeTarget()
    const waiting = waitForClose(target, fakeStdin())

    target.emit('SIGTERM')

    expect(await waiting).toBe('SIGTERM')
  })

  test('resuelve con `stdin` cuando llega la línea de cierre', async () => {
    const stdin = fakeStdin()
    const waiting = waitForClose(fakeTarget(), stdin)

    stdin.write(`${SHUTDOWN_LINE}\n`)

    expect(await waiting).toBe('stdin')
  })

  test('una línea que no es la de cierre no cierra nada', async () => {
    const stdin = fakeStdin()
    const waiting = waitForClose(fakeTarget(), stdin)
    let resuelto: ClosingReason | undefined
    void waiting.then((reason) => {
      resuelto = reason
    })

    stdin.write('otra cosa\n')
    stdin.write(`${SHUTDOWN_LINE} pero con más\n`)
    await Bun.sleep(5)

    expect(resuelto).toBeUndefined()
  })

  test('una línea partida en dos trozos también cierra', async () => {
    const stdin = fakeStdin()
    const waiting = waitForClose(fakeTarget(), stdin)

    stdin.write('shut')
    stdin.write('down\n')

    expect(await waiting).toBe('stdin')
  })

  test('no se suscribe al fin de la entrada: cerrar con la entrada cerrada mataría el servidor al nacer', () => {
    const stdin = fakeStdin()

    void waitForClose(fakeTarget(), stdin)

    expect(stdin.events()).toEqual(['data'])
  })

  test('quita las tres escuchas al resolverse', async () => {
    const target = fakeTarget()
    const stdin = fakeStdin()
    const waiting = waitForClose(target, stdin)

    expect(target.listeners('SIGINT')).toBe(1)
    expect(target.listeners('SIGTERM')).toBe(1)
    expect(stdin.listeners()).toBe(1)

    target.emit('SIGINT')
    await waiting

    expect(target.listeners('SIGINT')).toBe(0)
    expect(target.listeners('SIGTERM')).toBe(0)
    expect(stdin.listeners()).toBe(0)
  })

  test('una segunda señal no vuelve a resolver ni rompe nada', async () => {
    const target = fakeTarget()
    const waiting = waitForClose(target, fakeStdin())

    target.emit('SIGTERM')
    target.emit('SIGTERM')

    expect(await waiting).toBe('SIGTERM')
  })

  test('lo que llegue después de la primera orden no cambia el motivo', async () => {
    const target = fakeTarget()
    const stdin = fakeStdin()
    const waiting = waitForClose(target, stdin)

    target.emit('SIGINT')
    stdin.write(`${SHUTDOWN_LINE}\n`)

    expect(await waiting).toBe('SIGINT')
  })
})
