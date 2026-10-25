import { describe, expect, test } from 'bun:test'
import { createLogger, type LogEntry } from '@nn-anime/core'
import { createSession } from '@nn-anime/server'
import { parseArgs } from './args'
import type { BootDeps, BootResult, Listen } from './boot'
import { type ClosingReason, createLifecycle } from './lifecycle'
import { DEFAULT_SERVER_ENV, type ServerEnvResult } from './server-env'
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
  outcome: { code?: number; reason?: ClosingReason; onError?: unknown } = {},
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
      serverEnv: { ok: true, value: DEFAULT_SERVER_ENV } satisfies ServerEnvResult,
      publicOrigin: undefined,
      webRoot: undefined,
      listen: (() => ({ ok: false, kind: 'other', detail: 'no usado' })) as Listen,
      migrate: async () => ({ ok: true }),
      readSettings: async () => ({ ok: true, value: undefined }),
      loadProviders: async () => ({ active: [], rejected: [] }),
      openContainer: () => undefined,
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
      waitForClose: async (): Promise<ClosingReason> => {
        order.push('cierre')
        return outcome.reason ?? 'SIGINT'
      },
      // Al final: una sustitución de fuera gana sobre el comportamiento base.
      ...overrides,
    },
  }
}

describe('orden del arranque', () => {
  test('la espera del cierre se registra antes de arrancar el servidor', async () => {
    const target = harness()

    await createStarter(target.deps)(options())

    // Es la propiedad que protege del Ctrl+C en la ventana entre el arranque y
    // el registro del manejador. Con el orden inverso esto sería
    // ['boot', 'cierre'] y nadie se enteraría.
    expect(target.order).toEqual(['cierre', 'boot'])
  })

  test('no espera ningún cierre si el arranque falla', async () => {
    const target = harness({ code: 3 })

    expect(await createStarter(target.deps)(options())).toBe(3)
    expect(target.order).toEqual(['cierre', 'boot'])
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
    const target = harness({ reason: 'SIGTERM' })

    expect(await createStarter(target.deps)(options())).toBe(143)
  })

  test('un cierre pedido por la entrada estándar sale con 0', async () => {
    const target = harness({ reason: 'stdin' })

    expect(await createStarter(target.deps)(options())).toBe(0)
  })

  test('registra qué lo cerró', async () => {
    const target = harness({ reason: 'SIGTERM' })

    await createStarter(target.deps)(options())

    const closing = target.logged.find((entry) => entry.msg === 'cerrando')
    expect(closing?.fields.reason).toBe('SIGTERM')
  })

  test('un cierre por la entrada también queda registrado', async () => {
    const target = harness({ reason: 'stdin' })

    await createStarter(target.deps)(options())

    const closing = target.logged.find((entry) => entry.msg === 'cerrando')
    expect(closing?.fields.reason).toBe('stdin')
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

describe('entorno del modo servidor', () => {
  test('un entorno inválido sale con 1 y no arranca nada', async () => {
    const errors: string[] = []
    let boots = 0
    const target = harness(
      {},
      {
        io: { out: () => {}, err: (line) => errors.push(line) },
        serverEnv: {
          ok: false,
          error: { key: 'cli.env.noTokenOnServer', params: { where: '0.0.0.0' } },
        },
        boot: async () => {
          boots += 1
          return { code: 0, url: undefined, port: 7717 }
        },
      },
    )

    expect(await createStarter(target.deps)(options())).toBe(1)
    expect(boots).toBe(0)
    expect(target.order).toEqual([])
    expect(errors[0]).toContain('NN_ANIME_TOKEN')
  })

  test('ALLOW_LOOPBACK no se admite con un host que no es loopback', async () => {
    const errors: string[] = []
    let boots = 0
    const target = harness(
      {},
      {
        io: { out: () => {}, err: (line) => errors.push(line) },
        serverEnv: {
          ok: true,
          value: { ...DEFAULT_SERVER_ENV, host: '0.0.0.0', token: 'token-de-servidor' },
        },
        allowLoopback: true,
        boot: async () => {
          boots += 1
          return { code: 0, url: undefined, port: 7717 }
        },
      },
    )

    expect(await createStarter(target.deps)(options())).toBe(1)
    expect(boots).toBe(0)
    expect(errors[0]).toContain('ALLOW_LOOPBACK')
  })

  test('en loopback ALLOW_LOOPBACK sigue permitido, que es el arnés del e2e', async () => {
    const target = harness({}, { allowLoopback: true })

    expect(await createStarter(target.deps)(options())).toBe(130)
    expect(target.order).toEqual(['cierre', 'boot'])
  })

  test('un puerto fijado por el entorno desactiva la caída a otro puerto', async () => {
    let seen: BootDeps | undefined
    const target = harness(
      {},
      {
        serverEnv: {
          ok: true,
          value: { ...DEFAULT_SERVER_ENV, port: 8080 },
        },
        boot: async (_options, deps) => {
          seen = deps
          return { code: 0, url: BOOT_URL, port: 8080 }
        },
      },
    )

    await createStarter(target.deps)(options())

    expect(seen?.allowPortFallback).toBe(false)
  })

  test('el entorno llega al arranque con su host, token y modo restringido', async () => {
    let seen: BootDeps | undefined
    const server = {
      ...DEFAULT_SERVER_ENV,
      host: '0.0.0.0',
      port: 8080,
      token: 'token-de-servidor',
      secureCookie: true,
      locked: true,
    }
    const target = harness(
      {},
      {
        serverEnv: { ok: true, value: server },
        boot: async (_options, deps) => {
          seen = deps
          return { code: 0, url: 'https://nn.example.com/', port: 8080 }
        },
      },
    )

    await createStarter(target.deps)(options())

    expect(seen?.server).toEqual(server)
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
