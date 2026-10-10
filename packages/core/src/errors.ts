/**
 * Jerarquía de errores de la aplicación.
 *
 * Todo fallo que cruce una frontera se envuelve en un `AppError` con código,
 * alcance y operación, para que un log diga dónde falló sin necesidad de pila.
 */

export type ErrorCode = 'provider' | 'upstream' | 'store' | 'config' | 'internal'

export type ErrorContext = Readonly<Record<string, string | number | boolean>>

export interface AppErrorOptions {
  readonly code: ErrorCode
  readonly message: string
  readonly cause?: unknown
  readonly context?: ErrorContext
  readonly scope?: string
  readonly op?: string
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly context: ErrorContext
  readonly scope: string | undefined
  readonly op: string | undefined

  constructor(options: AppErrorOptions) {
    super(options.message, { cause: options.cause })
    this.name = 'AppError'
    this.code = options.code
    this.context = options.context ?? {}
    this.scope = options.scope
    this.op = options.op
  }
}

/** Extrae un texto legible de una causa de cualquier forma. */
function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string') return cause
  if (cause === undefined || cause === null) return 'sin causa'

  if (typeof cause === 'object') {
    try {
      return JSON.stringify(cause)
    } catch {
      return 'causa no serializable'
    }
  }

  return String(cause)
}

function describe(scope: string, op: string, cause: unknown): string {
  return `${scope}.${op} falló: ${describeCause(cause)}`
}

type FactoryOptions = Omit<AppErrorOptions, 'code'>

/** Fallo de un proveedor de contenido: búsqueda, detalle, resolución de stream. */
export class ProviderError extends AppError {
  constructor(options: FactoryOptions) {
    super({ ...options, code: 'provider' })
    this.name = 'ProviderError'
  }

  static from(scope: string, op: string, cause: unknown): ProviderError {
    return new ProviderError({ message: describe(scope, op, cause), scope, op, cause })
  }
}

/** Fallo al hablar con un origen remoto desde el proxy. */
export class UpstreamError extends AppError {
  constructor(options: FactoryOptions) {
    super({ ...options, code: 'upstream' })
    this.name = 'UpstreamError'
  }

  static from(scope: string, op: string, cause: unknown): UpstreamError {
    return new UpstreamError({ message: describe(scope, op, cause), scope, op, cause })
  }
}

/** Fallo de persistencia local. */
export class StoreError extends AppError {
  constructor(options: FactoryOptions) {
    super({ ...options, code: 'store' })
    this.name = 'StoreError'
  }

  static from(scope: string, op: string, cause: unknown): StoreError {
    return new StoreError({ message: describe(scope, op, cause), scope, op, cause })
  }
}
