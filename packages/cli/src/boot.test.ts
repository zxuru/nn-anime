import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError, loadConfig, type ProviderError } from '@nn-anime/core'
import { type Provider, providerFailure } from '@nn-anime/provider-sdk'
import type { RunningServer } from '@nn-anime/server'
import { type CliOptions, parseArgs } from './args'
import {
  boot,
  DEFAULT_PORT,
  isPortBusy,
  type Listen,
  listenOnFreePort,
  type Migrate,
  type ReadSettings,
} from './boot'
import { createLifecycle } from './lifecycle'
import type { CliIO } from './run'

const BOOT_TOKEN = 'token-de-arranque'

function options(argv: readonly string[] = []): CliOptions {
  const result = parseArgs(argv)
  if (!result.ok) throw new Error('se esperaban argumentos válidos')
  return result.value
}

interface Harness {
  readonly out: string[]
  readonly err: string[]
  readonly opened: string[]
  readonly requestedPorts: number[]
  readonly seenOptions: Parameters<Listen>[1][]
  readonly stopped: number
  readonly io: CliIO
}

function harness(outcome: {
  port?: number
  fellBackFrom?: number
  listenFails?: boolean
  listenBusy?: boolean
  openFails?: boolean
}): Harness & {
  readonly io: CliIO
  readonly listen: Listen
  readonly openUrl: (url: string) => Promise<boolean>
} {
  const out: string[] = []
  const err: string[] = []
  const opened: string[] = []
  const requestedPorts: number[] = []
  const seenOptions: Parameters<Listen>[1][] = []
  let stopped = 0

  const listen: Listen = (requestedPort, listenOptions) => {
    requestedPorts.push(requestedPort)
    seenOptions.push(listenOptions)

    if (outcome.listenFails === true) {
      return { ok: false, kind: 'other', detail: 'no se pudo montar la aplicación' }
    }
    if (outcome.listenBusy === true) {
      return { ok: false, kind: 'port-busy', detail: 'Failed to start server' }
    }

    const port = outcome.port ?? DEFAULT_PORT
    const server: RunningServer = {
      port,
      url: `http://127.0.0.1:${port}`,
      stop: async () => {
        stopped += 1
      },
    }

    return { ok: true, server, fellBackFrom: outcome.fellBackFrom }
  }

  return {
    out,
    err,
    opened,
    requestedPorts,
    seenOptions,
    get stopped(): number {
      return stopped
    },
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    listen,
    openUrl: async (url) => {
      opened.push(url)
      return outcome.openFails !== true
    },
  }
}

const HEALTHY_MIGRATE: Migrate = async () => ({ ok: true })

async function withTempHome<T>(body: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), 'nn-anime-boot-'))

  try {
    return await body(home)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

function depsFor(
  target: ReturnType<typeof harness>,
  home: string,
  overrides: Partial<Parameters<typeof boot>[1]> = {},
): Parameters<typeof boot>[1] {
  return {
    io: target.io,
    version: '0.1.0',
    locale: 'es',
    lifecycle: createLifecycle(),
    env: { HOME: home },
    migrate: HEALTHY_MIGRATE,
    readSettings: async () => ({ ok: true, value: undefined }),
    loadProviders: async () => ({ active: [], rejected: [] }),
    openContainer: () => undefined,
    listen: target.listen,
    openUrl: target.openUrl,
    createSession: () => ({
      cookieName: 'nn_session',
      value: 'sesion',
      matches: () => true,
    }),
    createBootToken: () => BOOT_TOKEN,
    ...overrides,
  }
}

describe('arranque correcto', () => {
  test('sale con 0', async () => {
    await withTempHome(async (home) => {
      const target = harness({})

      expect((await boot(options(), depsFor(target, home))).code).toBe(0)
    })
  })

  test('imprime la dirección con el token de arranque', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      await boot(options(), depsFor(target, home))

      expect(target.out[0]).toContain(`http://127.0.0.1:${DEFAULT_PORT}/?boot=${BOOT_TOKEN}`)
    })
  })

  test('abre el navegador en la dirección de arranque', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      await boot(options(), depsFor(target, home))

      expect(target.opened).toEqual([`http://127.0.0.1:${DEFAULT_PORT}/?boot=${BOOT_TOKEN}`])
    })
  })

  test('el resultado lleva el puerto, que es lo único registrable', async () => {
    await withTempHome(async (home) => {
      const target = harness({ port: 41234 })
      const result = await boot(options(), depsFor(target, home))

      expect(result.port).toBe(41234)
      expect(result.url).toContain('?boot=')
    })
  })

  test('pide el puerto indicado en la línea de comandos', async () => {
    await withTempHome(async (home) => {
      const target = harness({ port: 8080 })
      await boot(options(['--port', '8080']), depsFor(target, home))

      expect(target.requestedPorts).toEqual([8080])
    })
  })

  test('sin puerto indicado, pide el del spec', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      await boot(options(), depsFor(target, home))

      expect(target.requestedPorts).toEqual([DEFAULT_PORT])
    })
  })
})

describe('la consulta abre la búsqueda', () => {
  test('con consulta, el destino del canje es la búsqueda', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      await boot(options(['naruto']), depsFor(target, home))

      expect(target.seenOptions[0]?.redirectTo).toBe('/search?q=naruto')
    })
  })

  test('sin consulta, no hay destino especial', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      await boot(options(), depsFor(target, home))

      expect(target.seenOptions[0]?.redirectTo).toBeUndefined()
    })
  })

  test('la consulta se codifica para no comerse el resto de la dirección', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      await boot(options(['a b&c=d']), depsFor(target, home))

      expect(target.seenOptions[0]?.redirectTo).toBe('/search?q=a%20b%26c%3Dd')
    })
  })

  test('una consulta con varias palabras se une y se codifica', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      await boot(options(['attack', 'on', 'titan']), depsFor(target, home))

      expect(target.seenOptions[0]?.redirectTo).toBe('/search?q=attack%20on%20titan')
    })
  })

  test('un proveedor sin consulta también abre la búsqueda', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      await boot(options(['--provider', 'uno']), depsFor(target, home))

      expect(target.seenOptions[0]?.redirectTo).toBe('/search?provider=uno')
    })
  })

  test('varios proveedores viajan en orden, repetidos en la dirección', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      await boot(options(['--provider', 'uno', '--provider', 'dos']), depsFor(target, home))

      expect(target.seenOptions[0]?.redirectTo).toBe('/search?provider=uno&provider=dos')
    })
  })

  test('consulta y proveedor juntos', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      await boot(options(['naruto', '--provider', 'uno']), depsFor(target, home))

      expect(target.seenOptions[0]?.redirectTo).toBe('/search?q=naruto&provider=uno')
    })
  })

  test('el proveedor se codifica para no comerse la dirección', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      await boot(options(['--provider', 'a b&c']), depsFor(target, home))

      expect(target.seenOptions[0]?.redirectTo).toBe('/search?provider=a%20b%26c')
    })
  })

  test('una consulta vacía no produce destino', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      await boot(options(['--', '']), depsFor(target, home))

      expect(target.seenOptions[0]?.redirectTo).toBeUndefined()
    })
  })
})

describe('puerto bloqueado', () => {
  test('sale con 1 y explica que el proxy espera ese puerto', async () => {
    await withTempHome(async (home) => {
      const target = harness({ listenBusy: true })
      const result = await boot(options(), depsFor(target, home))

      expect(result.code).toBe(1)
      expect(target.err[0]).toContain(String(DEFAULT_PORT))
    })
  })

  test('no abre el navegador', async () => {
    await withTempHome(async (home) => {
      const target = harness({ listenBusy: true })
      await boot(options(), depsFor(target, home))

      expect(target.opened).toEqual([])
    })
  })
})

describe('ajustes de config.json', () => {
  test('el puerto del archivo se usa cuando no hay bandera', async () => {
    await withTempHome(async (home) => {
      const target = harness({ port: 9999 })
      const readSettings: ReadSettings = async () => ({ ok: true, value: { port: 9999 } })
      await boot(options(), depsFor(target, home, { readSettings }))

      expect(target.requestedPorts).toEqual([9999])
    })
  })

  test('la bandera gana sobre el archivo', async () => {
    await withTempHome(async (home) => {
      const target = harness({ port: 8080 })
      const readSettings: ReadSettings = async () => ({ ok: true, value: { port: 9999 } })
      await boot(options(['--port', '8080']), depsFor(target, home, { readSettings }))

      expect(target.requestedPorts).toEqual([8080])
    })
  })

  test('un open falso del archivo no abre el navegador', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      const readSettings: ReadSettings = async () => ({ ok: true, value: { open: false } })
      await boot(options(), depsFor(target, home, { readSettings }))

      expect(target.opened).toEqual([])
      expect(target.out.join('\n')).toContain('?boot=')
    })
  })

  test('--no-open gana sobre un open verdadero del archivo', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      const readSettings: ReadSettings = async () => ({ ok: true, value: { open: true } })
      await boot(options(['--no-open']), depsFor(target, home, { readSettings }))

      expect(target.opened).toEqual([])
    })
  })

  test('un proveedor del archivo llega a la búsqueda', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      const readSettings: ReadSettings = async () => ({ ok: true, value: { providers: ['uno'] } })
      await boot(options(), depsFor(target, home, { readSettings }))

      // Este test afirmaba `redirectTo === undefined`, que era cierto cuando los
      // proveedores no se usaban para nada. Ahora comprueba lo que importa.
      expect(target.seenOptions[0]?.redirectTo).toBe('/search?provider=uno')
    })
  })

  test('se lee el archivo del directorio de configuración resuelto', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      let path = ''
      const readSettings: ReadSettings = async (received) => {
        path = received
        return { ok: true, value: undefined }
      }
      await boot(options(), depsFor(target, home, { readSettings }))

      expect(path).toBe(loadConfig({ env: { HOME: home } }).configFile)
    })
  })

  test('el archivo se lee después de crear los directorios y antes de migrar', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      const order: string[] = []
      const readSettings: ReadSettings = async () => {
        order.push('ajustes')
        return { ok: true, value: undefined }
      }
      const migrate: Migrate = async () => {
        order.push('migrar')
        return { ok: true }
      }
      await boot(options(), depsFor(target, home, { readSettings, migrate }))

      expect(order).toEqual(['ajustes', 'migrar'])
    })
  })
})

describe('ajustes ilegibles', () => {
  test('sale con 1 antes de migrar y sin arrancar el servidor', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      const readSettings: ReadSettings = async () => ({
        ok: false,
        error: new AppError({ code: 'config', message: '{"puerto": 8080} no cumple el esquema' }),
      })
      const result = await boot(options(), depsFor(target, home, { readSettings }))

      expect(result.code).toBe(1)
      expect(target.requestedPorts).toEqual([])
      expect(target.opened).toEqual([])
    })
  })

  test('informa del motivo', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      const readSettings: ReadSettings = async () => ({
        ok: false,
        error: new AppError({ code: 'config', message: 'la clave puerto sobra' }),
      })
      await boot(options(), depsFor(target, home, { readSettings }))

      expect(target.err[0]).toContain('puerto sobra')
    })
  })
})

describe('--no-open', () => {
  test('no abre el navegador', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      await boot(options(['--no-open']), depsFor(target, home))

      expect(target.opened).toEqual([])
    })
  })

  test('igual imprime la dirección', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      await boot(options(['--no-open']), depsFor(target, home))

      expect(target.out[0]).toContain('?boot=')
    })
  })
})

describe('navegador que no abre', () => {
  test('el arranque sigue saliendo con 0', async () => {
    await withTempHome(async (home) => {
      const target = harness({ openFails: true })

      expect((await boot(options(), depsFor(target, home))).code).toBe(0)
    })
  })

  test('avisa con la dirección para abrirla a mano', async () => {
    await withTempHome(async (home) => {
      const target = harness({ openFails: true })
      await boot(options(), depsFor(target, home))

      expect(target.err[0]).toContain('?boot=')
    })
  })
})

describe('puerto ocupado', () => {
  test('informa del puerto que se acabó usando', async () => {
    await withTempHome(async (home) => {
      const target = harness({ port: 41234, fellBackFrom: DEFAULT_PORT })
      await boot(options(), depsFor(target, home))

      expect(target.out[0]).toContain(String(DEFAULT_PORT))
      expect(target.out[0]).toContain('41234')
    })
  })

  test('la dirección impresa lleva el puerto nuevo', async () => {
    await withTempHome(async (home) => {
      const target = harness({ port: 41234, fellBackFrom: DEFAULT_PORT })
      await boot(options(), depsFor(target, home))

      expect(target.out.join('\n')).toContain('41234')
    })
  })
})

describe('migración fallida', () => {
  test('sale con 3', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      const migrate: Migrate = async () => ({ ok: false, message: 'esquema roto' })

      expect((await boot(options(), depsFor(target, home, { migrate }))).code).toBe(3)
    })
  })

  test('no arranca el servidor', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      const migrate: Migrate = async () => ({ ok: false, message: 'esquema roto' })
      await boot(options(), depsFor(target, home, { migrate }))

      expect(target.requestedPorts).toEqual([])
      expect(target.opened).toEqual([])
    })
  })

  test('informa del motivo', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      const migrate: Migrate = async () => ({ ok: false, message: 'esquema roto' })
      await boot(options(), depsFor(target, home, { migrate }))

      expect(target.err[0]).toContain('esquema roto')
    })
  })
})

describe('servidor que no arranca', () => {
  test('sale con 1 e informa', async () => {
    await withTempHome(async (home) => {
      const target = harness({ listenFails: true })
      const result = await boot(options(), depsFor(target, home))

      expect(result.code).toBe(1)
      expect(target.err).toHaveLength(1)
    })
  })
})

describe('cierre', () => {
  test('registra el cierre del servidor en el ciclo de vida', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      const lifecycle = createLifecycle()
      await boot(options(), depsFor(target, home, { lifecycle }))

      expect(lifecycle.size).toBe(1)

      await lifecycle.shutdown()
      expect(target.stopped).toBe(1)
    })
  })

  test('registra el cierre aunque abrir el navegador falle', async () => {
    await withTempHome(async (home) => {
      const target = harness({ openFails: true })
      const lifecycle = createLifecycle()
      await boot(options(), depsFor(target, home, { lifecycle }))

      expect(lifecycle.size).toBe(1)
    })
  })
})

describe('configuración', () => {
  test('sin HOME y sin rutas indicadas, sale con 1', async () => {
    const target = harness({})
    const result = await boot(options(), depsFor(target, '.', { env: {} }))

    expect(result.code).toBe(1)
    expect(target.err).toHaveLength(1)
  })

  test('crea los directorios de datos antes de migrar', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      let dataDir = ''
      const migrate: Migrate = async (config) => {
        dataDir = config.dataDir
        return { ok: true }
      }
      await boot(options(), depsFor(target, home, { migrate }))

      expect(dataDir).toBe(loadConfig({ env: { HOME: home } }).dataDir)
      expect((await stat(dataDir)).isDirectory()).toBe(true)
    })
  })
})

describe('listenOnFreePort', () => {
  const listenOptions = {
    session: { cookieName: 'nn_session', value: 'sesion', matches: () => true },
    bootToken: BOOT_TOKEN,
    version: '0.1.0',
  }

  test('usa el puerto pedido cuando está libre', async () => {
    const outcome = listenOnFreePort(0, listenOptions)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.fellBackFrom).toBeUndefined()
    expect(outcome.server.port).toBeGreaterThan(0)

    await outcome.server.stop()
  })

  test('cae a un puerto libre cuando el pedido está ocupado', async () => {
    const busy = listenOnFreePort(0, listenOptions)
    expect(busy.ok).toBe(true)
    if (!busy.ok) return
    const busyPort = busy.server.port

    const outcome = listenOnFreePort(busyPort, listenOptions)

    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.fellBackFrom).toBe(busyPort)
      expect(outcome.server.port).not.toBe(busyPort)
      await outcome.server.stop()
    }

    await busy.server.stop()
  })

  test('no reintenta en otro puerto si el fallo no era el puerto', () => {
    const outcome = listenOnFreePort(-1, listenOptions)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.kind).toBe('other')
    expect(outcome.detail).toContain('port')
  })

  test('sin permiso de reserva, un puerto ocupado es un fallo y no una mudanza', async () => {
    const busy = listenOnFreePort(0, listenOptions)
    expect(busy.ok).toBe(true)
    if (!busy.ok) return

    const outcome = listenOnFreePort(busy.server.port, {
      ...listenOptions,
      allowPortFallback: false,
    })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.kind).toBe('port-busy')

    await busy.server.stop()
  })
})

describe('isPortBusy', () => {
  test('reconoce el error de puerto ocupado de Bun', () => {
    const error = Object.assign(new Error('Failed to start server'), { code: 'EADDRINUSE' })

    expect(isPortBusy(error)).toBe(true)
  })

  test('no confunde un puerto fuera de rango con un puerto ocupado', () => {
    const error = Object.assign(new RangeError('out of range'), { code: 'ERR_OUT_OF_RANGE' })

    expect(isPortBusy(error)).toBe(false)
  })

  test('no se rompe con causas que no son objetos', () => {
    expect(isPortBusy('texto')).toBe(false)
    expect(isPortBusy(undefined)).toBe(false)
    expect(isPortBusy(new Error('sin código'))).toBe(false)
  })
})

describe('lo que cuenta la migración', () => {
  test('una nota se imprime; sin nota no se imprime nada de más', async () => {
    await withTempHome(async (home) => {
      const conNota = harness({})
      await boot(
        options(),
        depsFor(conNota, home, {
          migrate: async () => ({ ok: true, note: 'se limpiaron 3 filas de datos viejos' }),
        }),
      )

      expect(conNota.out.join('\n')).toContain('se limpiaron 3 filas')

      const sinNota = harness({})
      await boot(options(), depsFor(sinNota, home))
      expect(sinNota.out.join('\n')).not.toContain('se limpiaron')
    })
  })
})

const PROVIDER: Provider = {
  id: 'uno',
  name: 'Uno',
  apiVersion: '1',
  capabilities: { search: true, sub: true, dub: false, trending: false, feed: false },
  search: async () => [],
  getAnime: async () => ({
    ref: { providerId: 'uno', value: 'a' },
    title: 'A',
    genres: [],
    studios: [],
  }),
  getEpisodes: async () => [],
  resolveStream: async () => [],
}

function pluginError(message: string): ProviderError {
  return providerFailure({ providerId: 'roto', kind: 'invalid-shape', detail: message })
}

describe('proveedores activos', () => {
  test('el directorio que se lee es el de la configuración', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      const seen: string[] = []

      await boot(
        options(),
        depsFor(target, home, {
          loadProviders: async (directory) => {
            seen.push(directory)
            return { active: [], rejected: [] }
          },
        }),
      )

      expect(seen).toHaveLength(1)
      expect(seen[0]?.endsWith(join('nn-anime', 'providers'))).toBe(true)
    })
  })

  test('imprime los activos por su id, después de la URL', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      await boot(
        options(),
        depsFor(target, home, {
          loadProviders: async () => ({
            active: [{ provider: PROVIDER, file: '/plugins/uno.ts' }],
            rejected: [],
          }),
        }),
      )

      expect(target.out[0]).toContain('?boot=')
      expect(target.out[1]).toContain('uno')
    })
  })

  test('sin plugins lo dice, en vez de callarse', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      await boot(options(), depsFor(target, home))

      expect(target.out.join('\n')).toContain('Sin proveedores')
      // Y dice la ruta de verdad, no una escrita a mano: en Windows los plugins
      // viven bajo `%APPDATA%`, y `~/.config/...` no existe.
      expect(target.out.join('\n')).toContain(loadConfig({ env: { HOME: home } }).providersDir)
    })
  })

  test('un plugin rechazado se imprime con su motivo y no impide arrancar', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      const result = await boot(
        options(),
        depsFor(target, home, {
          loadProviders: async () => ({
            active: [{ provider: PROVIDER, file: '/plugins/uno.ts' }],
            rejected: [{ file: '/plugins/roto.ts', reason: pluginError('no es un proveedor') }],
          }),
        }),
      )

      expect(result.code).toBe(0)
      expect(target.err.join('\n')).toContain('no es un proveedor')
      expect(target.out.join('\n')).toContain('uno')
    })
  })

  test('un directorio ilegible se reporta y el arranque sigue', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      const result = await boot(
        options(),
        depsFor(target, home, {
          loadProviders: async () => ({
            active: [],
            rejected: [],
            directoryError: pluginError('no se puede leer /plugins'),
          }),
        }),
      )

      expect(result.code).toBe(0)
      expect(target.err.join('\n')).toContain('no se puede leer /plugins')
    })
  })
})
