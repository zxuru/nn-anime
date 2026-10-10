import { describe, expect, test } from 'bun:test'
import {
  createLifecycle,
  type SignalTarget,
  signalExitCode,
  type TerminatingSignal,
  waitForSignal,
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

describe('waitForSignal', () => {
  test('resuelve con SIGINT cuando llega la interrupción', async () => {
    const target = fakeTarget()
    const waiting = waitForSignal(target)

    target.emit('SIGINT')

    expect(await waiting).toBe('SIGINT')
  })

  test('resuelve con SIGTERM cuando llega la terminación', async () => {
    const target = fakeTarget()
    const waiting = waitForSignal(target)

    target.emit('SIGTERM')

    expect(await waiting).toBe('SIGTERM')
  })

  test('quita las dos escuchas al resolverse', async () => {
    const target = fakeTarget()
    const waiting = waitForSignal(target)

    expect(target.listeners('SIGINT')).toBe(1)
    expect(target.listeners('SIGTERM')).toBe(1)

    target.emit('SIGINT')
    await waiting

    expect(target.listeners('SIGINT')).toBe(0)
    expect(target.listeners('SIGTERM')).toBe(0)
  })

  test('una segunda señal no vuelve a resolver ni rompe nada', async () => {
    const target = fakeTarget()
    const waiting = waitForSignal(target)

    target.emit('SIGTERM')
    target.emit('SIGTERM')

    expect(await waiting).toBe('SIGTERM')
  })
})
