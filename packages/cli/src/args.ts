/**
 * Análisis de la línea de comandos.
 *
 * Sin dependencias: la tabla de banderas del spec es corta y un parser propio
 * evita una dependencia más en el camino de arranque.
 *
 * El parser no conoce ningún idioma. Devuelve claves del catálogo i18n y sus
 * parámetros, y quien arranca traduce. Así `--lang` afecta también a los
 * mensajes de error de uso, y no hace falta tocar este archivo para traducir.
 *
 * Dos reglas que el spec fija y que se cumplen aquí:
 *
 * 1. `--help` y `--version` tienen prioridad. Se resuelven antes que cualquier
 *    otra cosa, así que `nn-anime --port abc --help` muestra la ayuda en lugar
 *    de quejarse del puerto. La búsqueda se detiene en `--`, para que una
 *    consulta que empiece por guion no dispare la ayuda.
 * 2. Todo error de uso sale con código 2.
 */

import { err, type MessageParams, ok, type Result } from '@nn-anime/core'

export const MIN_PORT = 1
export const MAX_PORT = 65535

export interface CliOptions {
  /** Consulta posicional. Varios argumentos sueltos se unen con espacios. */
  readonly query: string | undefined
  readonly port: number | undefined
  /** Falso con `--no-open`. Por defecto se abre el navegador. */
  readonly open: boolean
  /**
   * Si `--no-open` se indicó.
   *
   * Hace falta para poder aplicar `config.json`: la ausencia de la bandera y su
   * valor por defecto son indistinguibles, y sin esto un ajuste `"open": false`
   * no se podría respetar.
   */
  readonly openSpecified: boolean
  readonly dataDir: string | undefined
  readonly configDir: string | undefined
  /** Identificadores de proveedor, en el orden en que se escribieron. */
  readonly providers: readonly string[]
  readonly lang: string | undefined
  readonly verbose: boolean
  readonly help: boolean
  readonly version: boolean
}

export type UsageErrorKey =
  | 'cli.usage.unknownFlag'
  | 'cli.usage.missingValue'
  | 'cli.usage.invalidPort'

export interface UsageError {
  /** Clave del catálogo i18n. El parser nunca devuelve texto para mostrar. */
  readonly key: UsageErrorKey
  readonly params: MessageParams
  readonly exitCode: 2
}

type ParseResult = Result<CliOptions, UsageError>

type ValueField = 'port' | 'dataDir' | 'configDir' | 'provider' | 'lang'

const VALUE_FLAGS: ReadonlyMap<string, ValueField> = new Map([
  ['--port', 'port'],
  ['--data-dir', 'dataDir'],
  ['--config-dir', 'configDir'],
  ['--provider', 'provider'],
  ['--lang', 'lang'],
])

const SHORT_VALUE_FLAGS: ReadonlyMap<string, string> = new Map([['-p', '--port']])

interface MutableState {
  query: string[]
  port: number | undefined
  open: boolean
  openSpecified: boolean
  dataDir: string | undefined
  configDir: string | undefined
  providers: string[]
  lang: string | undefined
  verbose: boolean
}

function blank(overrides: Partial<CliOptions> = {}): CliOptions {
  return {
    query: undefined,
    port: undefined,
    open: true,
    openSpecified: false,
    dataDir: undefined,
    configDir: undefined,
    providers: [],
    lang: undefined,
    verbose: false,
    help: false,
    version: false,
    ...overrides,
  }
}

function usage(key: UsageErrorKey, params: MessageParams = {}): ParseResult {
  return err({ key, params, exitCode: 2 })
}

function parsePort(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined

  const port = Number(value)
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) return undefined

  return port
}

/** Asigna un valor. Devuelve el error de uso, o `undefined` si salió bien. */
function assign(state: MutableState, field: ValueField, value: string): UsageError | undefined {
  switch (field) {
    case 'port': {
      const port = parsePort(value)
      if (port === undefined) {
        return {
          key: 'cli.usage.invalidPort',
          params: { value, min: MIN_PORT, max: MAX_PORT },
          exitCode: 2,
        }
      }
      state.port = port
      return undefined
    }
    case 'dataDir':
      state.dataDir = value
      return undefined
    case 'configDir':
      state.configDir = value
      return undefined
    case 'provider': {
      const provider = value.trim()
      if (provider === '') {
        return { key: 'cli.usage.missingValue', params: { flag: '--provider' }, exitCode: 2 }
      }
      state.providers.push(provider)
      return undefined
    }
    case 'lang': {
      const lang = value.trim()
      if (lang === '') {
        return { key: 'cli.usage.missingValue', params: { flag: '--lang' }, exitCode: 2 }
      }
      state.lang = lang
      return undefined
    }
  }
}

export function parseArgs(argv: readonly string[]): ParseResult {
  const terminator = argv.indexOf('--')
  const beforeTerminator = terminator === -1 ? argv : argv.slice(0, terminator)

  if (beforeTerminator.includes('--help') || beforeTerminator.includes('-h')) {
    return ok(blank({ help: true }))
  }
  if (beforeTerminator.includes('--version')) {
    return ok(blank({ version: true }))
  }

  const state: MutableState = {
    query: [],
    port: undefined,
    open: true,
    openSpecified: false,
    dataDir: undefined,
    configDir: undefined,
    providers: [],
    lang: undefined,
    verbose: false,
  }

  let positionalOnly = false
  let index = 0

  while (index < argv.length) {
    const arg = argv[index]
    if (arg === undefined) break
    index++

    if (positionalOnly) {
      state.query.push(arg)
      continue
    }

    if (arg === '--') {
      positionalOnly = true
      continue
    }

    if (arg === '--no-open') {
      state.open = false
      state.openSpecified = true
      continue
    }

    if (arg === '-v' || arg === '--verbose') {
      state.verbose = true
      continue
    }

    const equals = arg.startsWith('-') ? arg.indexOf('=') : -1
    const name = equals === -1 ? arg : arg.slice(0, equals)
    const inline = equals === -1 ? undefined : arg.slice(equals + 1)

    const canonical = SHORT_VALUE_FLAGS.get(name) ?? name
    const field = VALUE_FLAGS.get(canonical)

    if (field !== undefined) {
      const value = inline ?? argv[index]
      if (inline === undefined) index++
      if (value === undefined || value === '') {
        return usage('cli.usage.missingValue', { flag: canonical })
      }

      const problem = assign(state, field, value)
      if (problem !== undefined) return err(problem)
      continue
    }

    if (arg.startsWith('-') && arg !== '-') {
      return usage('cli.usage.unknownFlag', { flag: arg })
    }

    state.query.push(arg)
  }

  const query = state.query.join(' ').trim()

  return ok(
    blank({
      query: query === '' ? undefined : query,
      port: state.port,
      open: state.open,
      openSpecified: state.openSpecified,
      dataDir: state.dataDir,
      configDir: state.configDir,
      providers: state.providers,
      lang: state.lang,
      verbose: state.verbose,
    }),
  )
}
