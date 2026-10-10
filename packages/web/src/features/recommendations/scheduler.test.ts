import { describe, expect, test } from 'bun:test'
import { createScheduler } from './scheduler'

/** Temporizadores de mentira, que se disparan a voluntad. */
function relojFalso() {
  const pendientes = new Map<number, () => void>()
  const retardos: number[] = []
  let siguiente = 1
  const cancelados: number[] = []

  return {
    pendientes,
    cancelados,
    retardos,
    setTimeoutFn: (fn: () => void, ms: number): number => {
      const id = siguiente
      siguiente += 1
      retardos.push(ms)
      pendientes.set(id, fn)

      return id
    },
    clearTimeoutFn: (id: unknown): void => {
      cancelados.push(id as number)
      pendientes.delete(id as number)
    },
    disparar(): void {
      for (const [id, fn] of [...pendientes]) {
        pendientes.delete(id)
        fn()
      }
    },
  }
}

describe('el planificador', () => {
  test('el retardo es el que se pidió, no cero', () => {
    // Sin esta comprobación, cambiar el retardo por cero no rompía nada: el reloj
    // de mentira es manual y da igual cuánto se espere.
    const reloj = relojFalso()
    const plan = createScheduler({
      delayMs: 400,
      load: async () => {},
      setTimeoutFn: reloj.setTimeoutFn,
      clearTimeoutFn: reloj.clearTimeoutFn,
    })

    plan.schedule('mecha')

    expect(reloj.retardos).toEqual([400])
  })

  test('varias llamadas seguidas producen una sola carga, con la última clave', async () => {
    const reloj = relojFalso()
    const cargas: string[] = []
    const plan = createScheduler({
      delayMs: 400,
      load: async (clave) => {
        cargas.push(clave)
      },
      setTimeoutFn: reloj.setTimeoutFn,
      clearTimeoutFn: reloj.clearTimeoutFn,
    })

    plan.schedule('m')
    plan.schedule('me')
    plan.schedule('mecha')
    reloj.disparar()
    await Bun.sleep(1)

    expect(cargas).toEqual(['mecha'])
  })

  test('la carga anterior se cancela al llegar una clave nueva', async () => {
    const reloj = relojFalso()
    const señales: AbortSignal[] = []
    const plan = createScheduler({
      delayMs: 400,
      load: async (_clave, signal) => {
        señales.push(signal)
      },
      setTimeoutFn: reloj.setTimeoutFn,
      clearTimeoutFn: reloj.clearTimeoutFn,
    })

    plan.schedule('mecha')
    reloj.disparar()
    await Bun.sleep(1)

    plan.schedule('romance')

    expect(señales[0]?.aborted).toBe(true)
  })

  test('cancelar impide que la carga pendiente ocurra', async () => {
    const reloj = relojFalso()
    let cargas = 0
    const plan = createScheduler({
      delayMs: 400,
      load: async () => {
        cargas += 1
      },
      setTimeoutFn: reloj.setTimeoutFn,
      clearTimeoutFn: reloj.clearTimeoutFn,
    })

    plan.schedule('mecha')
    plan.cancel()
    reloj.disparar()
    await Bun.sleep(1)

    expect(cargas).toBe(0)
    expect(reloj.cancelados).toHaveLength(1)
  })

  test('la señal que recibe la carga no está abortada', async () => {
    const reloj = relojFalso()
    let abortada: boolean | undefined
    const plan = createScheduler({
      delayMs: 400,
      load: async (_clave, signal) => {
        abortada = signal.aborted
      },
      setTimeoutFn: reloj.setTimeoutFn,
      clearTimeoutFn: reloj.clearTimeoutFn,
    })

    plan.schedule('mecha')
    reloj.disparar()
    await Bun.sleep(1)

    expect(abortada).toBe(false)
  })

  test('un fallo de carga no deja una promesa sin dueño', async () => {
    const reloj = relojFalso()
    const plan = createScheduler({
      delayMs: 1,
      load: async () => {
        throw new Error('sin red')
      },
      setTimeoutFn: reloj.setTimeoutFn,
      clearTimeoutFn: reloj.clearTimeoutFn,
    })

    plan.schedule('mecha')
    reloj.disparar()
    await Bun.sleep(1)

    expect(reloj.cancelados).toHaveLength(0)
  })
})
