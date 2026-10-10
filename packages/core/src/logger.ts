/**
 * Logger estructurado con salida JSON en una línea por entrada.
 *
 * Dos reglas que no se negocian:
 *
 * 1. Es el único lugar del proyecto que escribe en la salida estándar.
 * 2. Redacta los datos sensibles antes de que salgan, en cualquier nivel y a
 *    cualquier profundidad. La redacción es por nombre de clave: si un token
 *    viaja dentro de una cadena, este módulo no puede detectarlo y la
 *    responsabilidad es de quien llama.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const

export type LogLevel = (typeof LOG_LEVELS)[number]

/** Marcador que sustituye a todo valor considerado sensible. */
export const REDACTED = '[redacted]'

/** Claves cuyo valor se sustituye por completo, sin importar su forma. */
export const SENSITIVE_KEYS: readonly string[] = [
  'authorization',
  'cookie',
  'referer',
  'token',
  'headers',
]

/** Fragmentos que, presentes en el nombre de una clave, la vuelven sensible. */
const SENSITIVE_FRAGMENTS: readonly string[] = ['token', 'cookie', 'secret', 'password']

const MAX_DEPTH = 6

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase()

  return (
    SENSITIVE_KEYS.includes(normalized) ||
    SENSITIVE_FRAGMENTS.some((fragment) => normalized.includes(fragment))
  )
}

export interface LogEntry {
  /** Marca de tiempo en ISO 8601, siempre en UTC. */
  readonly ts: string
  readonly level: LogLevel
  readonly msg: string
  readonly fields: Readonly<Record<string, unknown>>
}

export interface LoggerOptions {
  /** Umbral. Todo lo que quede por debajo se descarta. Por defecto `info`. */
  readonly level?: LogLevel
  /** Destino de las entradas ya redactadas. Por defecto, JSON a la salida estándar. */
  readonly sink?: (entry: LogEntry) => void
  /** Reloj inyectable, para que los tests sean deterministas. */
  readonly now?: () => Date
  /** Campos que se añaden a toda entrada emitida por este logger. */
  readonly base?: Readonly<Record<string, unknown>>
}

export interface Logger {
  readonly level: LogLevel
  debug(msg: string, fields?: Readonly<Record<string, unknown>>): void
  info(msg: string, fields?: Readonly<Record<string, unknown>>): void
  warn(msg: string, fields?: Readonly<Record<string, unknown>>): void
  error(msg: string, fields?: Readonly<Record<string, unknown>>): void
  /** Devuelve un logger que añade campos base a cada entrada. Hereda umbral y destino. */
  child(base: Readonly<Record<string, unknown>>): Logger
}

/** Serializa una entrada a una sola línea JSON, sin salto final. */
export function toJsonLine(entry: LogEntry): string {
  return JSON.stringify({ ts: entry.ts, level: entry.level, msg: entry.msg, ...entry.fields })
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined') return undefined
  if (typeof value === 'function') return '[function]'
  if (typeof value === 'symbol') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) return { name: value.name, message: value.message }
  if (depth >= MAX_DEPTH) return '[truncated]'
  if (seen.has(value)) return '[circular]'

  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1, seen))
  }

  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? REDACTED : sanitizeValue(item, depth + 1, seen)
  }
  return out
}

/** Redacta y normaliza un conjunto de campos, sin tocar el objeto original. */
function sanitizeFields(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(fields)) {
    out[key] = isSensitiveKey(key) ? REDACTED : sanitizeValue(value, 1, new WeakSet())
  }

  return out
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info'
  const threshold = LOG_LEVELS.indexOf(level)
  const base = options.base ?? {}
  const now = options.now ?? (() => new Date())
  const sink =
    options.sink ??
    ((entry: LogEntry): void => {
      process.stdout.write(`${toJsonLine(entry)}\n`)
    })

  const emit = (
    entryLevel: LogLevel,
    msg: string,
    fields?: Readonly<Record<string, unknown>>,
  ): void => {
    if (LOG_LEVELS.indexOf(entryLevel) < threshold) return

    sink({
      ts: now().toISOString(),
      level: entryLevel,
      msg,
      fields: sanitizeFields({ ...base, ...fields }),
    })
  }

  return {
    level,
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (childBase) => createLogger({ level, sink, now, base: { ...base, ...childBase } }),
  }
}
