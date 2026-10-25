import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import {
  AppError,
  type ConfigPaths,
  loadConfig,
  type ProviderError,
  parseBootLine,
  RECOMMENDED_PROVIDER_REPO,
} from '@nn-anime/core'
import { type Provider, providerFailure } from '@nn-anime/provider-sdk'
import { createContainer, type RunningServer, saveRepoRecords } from '@nn-anime/server'
import { type CliOptions, parseArgs } from './args'
import {
  boot,
  DEFAULT_PORT,
  isPortBusy,
  type Listen,
  listenOnFreePort,
  type Migrate,
  type MigrationOutcome,
  type OpenContainer,
  type ReadSettings,
} from './boot'
import { createLifecycle } from './lifecycle'
import type { CliIO } from './run'
import { DEFAULT_SERVER_ENV } from './server-env'

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

  test('imprime además la línea legible por máquina, con el mismo puerto y la misma dirección', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      await boot(options(), depsFor(target, home))

      // Se busca en toda la salida y no en una posición concreta: lo que importa
      // es que esté, no en qué renglón. El formato lo define `core`, que es quien
      // también lo analiza.
      const linea = parseBootLine(target.out.join('\n'))

      expect(linea?.port).toBe(DEFAULT_PORT)
      expect(linea?.url).toBe(`http://127.0.0.1:${DEFAULT_PORT}/?boot=${BOOT_TOKEN}`)
    })
  })

  test('la línea legible por máquina no lleva la traducción por medio', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      await boot(options(['--lang', 'en']), depsFor(target, home))

      // Con `--lang en` la línea humana sigue saliendo en español —el inglés no
      // está traducido—, y es justo el motivo de que exista la otra: el día que
      // se traduzca, un lector que analizara la humana se rompería.
      expect(parseBootLine(target.out.join('\n'))?.url).toContain('?boot=')
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

  test('el puerto del entorno gana sobre el del archivo', async () => {
    await withTempHome(async (home) => {
      const target = harness({ port: 8080 })

      await boot(
        options(),
        depsFor(target, home, {
          server: { ...DEFAULT_SERVER_ENV, port: 8080 },
        }),
      )

      expect(target.requestedPorts).toEqual([8080])
    })
  })

  test('NN_ANIME_NO_OPEN no abre el navegador', async () => {
    await withTempHome(async (home) => {
      const target = harness({})

      await boot(
        options(),
        depsFor(target, home, {
          server: { ...DEFAULT_SERVER_ENV, noOpen: true },
        }),
      )

      expect(target.opened).toEqual([])
    })
  })

  test('en modo token no se imprime el canje y se abre el formulario de login', async () => {
    await withTempHome(async (home) => {
      const target = harness({ port: 8080 })
      const server = {
        ...DEFAULT_SERVER_ENV,
        host: '0.0.0.0',
        port: 8080,
        token: 'token-de-servidor',
        publicOrigin: 'https://nn.example.com',
        secureCookie: true,
      }

      const result = await boot(options(), depsFor(target, home, { server }))

      expect(result.url).toBe('https://nn.example.com/')
      expect(target.out.join('\n')).not.toContain('?boot=')
      expect(target.out.join('\n')).toContain('https://nn.example.com/login')
      expect(target.opened).toEqual(['https://nn.example.com/login'])
      expect(target.seenOptions[0]?.host).toBe('0.0.0.0')
      expect(target.seenOptions[0]?.auth).toEqual({
        token: 'token-de-servidor',
        secureCookie: true,
      })
      expect(target.seenOptions[0]?.network?.extraHosts).toContain('nn.example.com')
    })
  })

  test('el modo restringido se anuncia y llega al servidor', async () => {
    await withTempHome(async (home) => {
      const target = harness({})

      await boot(
        options(),
        depsFor(target, home, {
          server: { ...DEFAULT_SERVER_ENV, locked: true },
        }),
      )

      expect(target.seenOptions[0]?.locked).toBe(true)
      expect(target.out.join('\n')).toContain('Modo restringido')
    })
  })

  test('sin origen público en un host no loopback avisa de la cookie sin Secure', async () => {
    await withTempHome(async (home) => {
      const target = harness({ port: 8080 })

      await boot(
        options(),
        depsFor(target, home, {
          server: {
            ...DEFAULT_SERVER_ENV,
            host: '0.0.0.0',
            port: 8080,
            token: 'token-de-servidor',
          },
        }),
      )

      expect(target.err.join('\n')).toContain('NN_ANIME_PUBLIC_ORIGIN')
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

      // Se compara la posición de las dos líneas y no un índice escrito a mano:
      // lo que la prueba afirma es el orden —los activos después de la URL—, y
      // con un `out[1]` cualquier línea que se añada en medio la rompería sin que
      // el orden dejara de cumplirse.
      const url = target.out.findIndex((line) => line.includes('?boot='))
      const activos = target.out.findIndex((line) => line.includes('uno'))

      expect(url).toBeGreaterThanOrEqual(0)
      expect(activos).toBeGreaterThan(url)
    })
  })

  test('sin plugins lo dice, en vez de callarse', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      await boot(options(), depsFor(target, home))

      expect(target.out.join('\n')).toContain('Sin proveedores')
      // Y nombra el repositorio recomendado, que es lo que la interfaz ofrece en
      // el primer arranque: la consola y la pantalla dicen lo mismo.
      expect(target.out.join('\n')).toContain(RECOMMENDED_PROVIDER_REPO)
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

describe('los proveedores habilitados de los repositorios', () => {
  const FETCHED = '2026-10-13T10:00:00.000Z'
  const STAMP = '2026-10-13T10-00-00-000Z'
  const FUENTE = `const provider = {
  id: 'jkanime',
  name: 'JKanime',
  apiVersion: '1',
  capabilities: { search: true, sub: false, dub: false, trending: false },
  async search() { return [] },
  async getAnime() { return { ref: { providerId: 'jkanime', value: 'a' }, title: 'A', genres: [], studios: [] } },
  async getEpisodes() { return [] },
  async resolveStream() { return [] },
}

export default provider
`

  /**
   * Una migración que además deja la ficha guardada.
   *
   * Es la forma de medir el orden de verdad: la tabla y la ficha las crea
   * `migrate`, así que si el arranque leyera la selección **antes** de migrar se
   * encontraría con una base sin tablas y la consulta fallaría. Con una base
   * preparada de antemano, invertir el orden no se notaría y la prueba no
   * mediría nada.
   */
  async function migrateConFicha(
    config: ConfigPaths,
    enabled: readonly string[],
  ): Promise<MigrationOutcome> {
    const db = openDb(config.dbPath)
    runMigrations(db)
    const container = createContainer({ db })

    try {
      await saveRepoRecords(container.store, [
        {
          url: 'https://github.com/zxuru/nn-anime-plugins',
          owner: 'zxuru',
          repo: 'nn-anime-plugins',
          ref: 'main',
          fetchedAt: FETCHED,
          enabled: [...enabled],
          files: 1,
        },
      ])

      return { ok: true }
    } finally {
      await container.close().catch(() => {})
    }
  }

  const ABRIR: OpenContainer = (config) => createContainer({ db: openDb(config.dbPath) })

  test('los archivos habilitados se le pasan al cargador, y salen en la lista', async () => {
    await withTempHome(async (home) => {
      const dir = await mkdtemp(join(tmpdir(), 'nn-anime-boot-repos-'))
      const file = join(dir, 'repos', 'zxuru__nn-anime-plugins', STAMP, 'jkanime.ts')
      const target = harness({})
      const lifecycle = createLifecycle()
      let recibidos: readonly string[] = []

      try {
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, FUENTE)

        const result = await boot(
          options(['--data-dir', dir, '--config-dir', dir]),
          depsFor(target, home, {
            lifecycle,
            migrate: (config) => migrateConFicha(config, ['jkanime.ts']),
            openContainer: ABRIR,
            loadProviders: async (_directory, files) => {
              recibidos = files

              return {
                active: [{ provider: { ...PROVIDER, id: 'jkanime' }, file }],
                rejected: [],
              }
            },
          }),
        )

        expect(result.code).toBe(0)
        expect(recibidos).toEqual([file])
        // El informe que se le pasa al servidor y el que se imprime son el mismo.
        expect(target.out.join('\n')).toContain('jkanime')
      } finally {
        await lifecycle.shutdown()
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  test('un archivo habilitado que ya no está no impide arrancar', async () => {
    await withTempHome(async (home) => {
      const dir = await mkdtemp(join(tmpdir(), 'nn-anime-boot-repos-'))
      const target = harness({})
      const lifecycle = createLifecycle()
      let recibidos: readonly string[] | undefined

      try {
        const result = await boot(
          options(['--data-dir', dir, '--config-dir', dir]),
          depsFor(target, home, {
            lifecycle,
            migrate: (config) => migrateConFicha(config, ['desaparecido.ts']),
            openContainer: ABRIR,
            loadProviders: async (_directory, files) => {
              recibidos = files

              return { active: [], rejected: [] }
            },
          }),
        )

        expect(result.code).toBe(0)
        expect(recibidos).toEqual([])
      } finally {
        await lifecycle.shutdown()
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  test('sin contenedor el cargador recibe la lista vacía, no `undefined`', async () => {
    await withTempHome(async (home) => {
      const target = harness({})
      let recibidos: readonly string[] | undefined

      await boot(
        options(),
        depsFor(target, home, {
          loadProviders: async (_directory, files) => {
            recibidos = files

            return { active: [], rejected: [] }
          },
        }),
      )

      expect(recibidos).toEqual([])
    })
  })
})
