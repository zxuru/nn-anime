import { describe, expect, test } from 'bun:test'
import { createLogger, type LogEntry } from '@nn-anime/core'
import { createSession } from '@nn-anime/server'
import { parseArgs } from './args'
import type { BootDeps, BootResult, Listen } from './boot'
import { createLifecycle, type TerminatingSignal } from './lifecycle'
import { createStarter, type StartDeps } from './start'

const BOOT_URL = 'http://127.0.0.1:7717/?boot=token-de-arranque'

function options(argv: readonly string[] = []) {
  const parsed = parseArgs(argv)
  if (!parsed.ok) throw new Error('se esperaban argumentos válidos')
  return parsed.value
}

interface Harness {
  readonly order: string[]
  readonly logged: LogEntry[]
  readonly deps: StartDeps
  shutdowns: number
}

function harness(
  outcome: { code?: number; signal?: TerminatingSignal; onError?: unknown } = {},
  overrides: Partial<StartDeps> = {},
): Harness {
  const order: string[] = []
  const logged: LogEntry[] = []
  const state = { shutdowns: 0 }

  return {
    order,
    logged,
    get shutdowns(): number {
      return state.shutdowns
    },
    set shutdowns(value: number) {
      state.shutdowns = value
    },
    deps: {
      io: { out: () => {}, err: () => {} },
      version: '0.1.0',
      envLang: undefined,
      env: { HOME: '/tmp/prueba' },
      publicOrigin: undefined,
      webRoot: undefined,
      listen: (() => ({ ok: false, kind: 'other', detail: 'no usado' })) as Listen,
      migrate: async () => ({ ok: true }),
      readSettings: async () => ({ ok: true, value: undefined }),
      loadProviders: async () => ({ active: [], rejected: [] }),
      openUrl: async () => true,
      createSession,
      createBootToken: () => 'token-de-arranque',
      createLogger: () =>
        createLogger({
          sink: (entry) => logged.push(entry),
        }),
      createLifecycle: (onError) =>
        createLifecycle({
          onError: (error) => {
            onError(error)
            if (outcome.onError !== undefined) throw outcome.onError
          },
        }),
      boot: async (_options, _deps: BootDeps): Promise<BootResult> => {
        order.push('boot')
        return { code: outcome.code ?? 0, url: BOOT_URL, port: 7717 }
      },
      waitForSignal: async (): Promise<TerminatingSignal> => {
        order.push('señal')
        return outcome.signal ?? 'SIGINT'
      },
      // Al final: una sustitución de fuera gana sobre el comportamiento base.
      ...overrides,
    },
  }
}

describe('orden del arranque', () => {
  test('la espera de señal se registra antes de arrancar el servidor', async () => {
    const target = harness()

    await createStarter(target.deps)(options())

    // Es la propiedad que protege del Ctrl+C en la ventana entre el arranque y
    // el registro del manejador. Con el orden inverso esto sería
    // ['boot', 'señal'] y nadie se enteraría.
    expect(target.order).toEqual(['señal', 'boot'])
  })

  test('no espera ninguna señal si el arranque falla', async () => {
    const target = harness({ code: 3 })

    expect(await createStarter(target.deps)(options())).toBe(3)
    expect(target.order).toEqual(['señal', 'boot'])
  })

  test('el código de salida de un arranque fallido es el del arranque', async () => {
    const target = harness({ code: 1 })

    expect(await createStarter(target.deps)(options())).toBe(1)
  })
})

describe('cierre', () => {
  test('cierra el ciclo de vida al recibir la señal', async () => {
    const target = harness()

    expect(await createStarter(target.deps)(options())).toBe(130)
    expect(target.logged.map((entry) => entry.msg)).toContain('cerrando')
  })

  test('SIGTERM sale con 143', async () => {
    const target = harness({ signal: 'SIGTERM' })

    expect(await createStarter(target.deps)(options())).toBe(143)
  })

  test('registra qué señal llegó', async () => {
    const target = harness({ signal: 'SIGTERM' })

    await createStarter(target.deps)(options())

    const closing = target.logged.find((entry) => entry.msg === 'cerrando')
    expect(closing?.fields.signal).toBe('SIGTERM')
  })
})

describe('lo que se registra en el log', () => {
  test('el puerto sí', async () => {
    const target = harness()

    await createStarter(target.deps)(options())

    const started = target.logged.find((entry) => entry.msg === 'servidor en marcha')
    expect(started?.fields.port).toBe(7717)
  })

  test('la URL de arranque no, porque lleva el token', async () => {
    const target = harness()

    await createStarter(target.deps)(options())

    const serialized = JSON.stringify(target.logged)
    expect(serialized).not.toContain('token-de-arranque')
    expect(serialized).not.toContain('boot=')
  })
})

describe('modo desarrollo', () => {
  test('sin origen público, se permite cambiar de puerto', async () => {
    let seen: BootDeps | undefined
    const target = harness(
      {},
      {
        boot: async (_options, deps) => {
          seen = deps
          return { code: 0, url: BOOT_URL, port: 7717 }
        },
      },
    )

    await createStarter(target.deps)(options())

    expect(seen?.allowPortFallback).toBe(true)
  })

  test('con origen público, no: el proxy apunta a un puerto fijo', async () => {
    let seen: BootDeps | undefined
    const target = harness(
      {},
      {
        publicOrigin: 'http://127.0.0.1:5173',
        boot: async (_options, deps) => {
          seen = deps
          return { code: 0, url: BOOT_URL, port: 7717 }
        },
      },
    )

    await createStarter(target.deps)(options())

    expect(seen?.allowPortFallback).toBe(false)
    expect(seen?.publicOrigin).toBe('http://127.0.0.1:5173')
  })
})

describe('idioma', () => {
  test('se resuelve el idioma antes de arrancar', async () => {
    let seen: BootDeps | undefined
    const target = harness(
      {},
      {
        envLang: 'en',
        boot: async (_options, deps) => {
          seen = deps
          return { code: 0, url: BOOT_URL, port: 7717 }
        },
      },
    )

    await createStarter(target.deps)(options(['--lang', 'es']))

    expect(seen?.locale).toBe('es')
  })
})
