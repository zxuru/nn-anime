/**
 * Clasificación de los fallos de un proveedor.
 *
 * Un plugin es código de terceros: puede lanzar, colgarse o devolver una forma
 * que no es la prometida. Todo eso se convierte aquí en un `ProviderError` con
 * proveedor, método y causa, para que quien llame decida con un dato y no con
 * una excepción de forma desconocida.
 *
 * La distinción que importa es entre «se canceló» y «se colgó». Las dos llegan
 * como una excepción de aborto, y confundirlas convierte un timeout en una
 * cancelación del usuario: una búsqueda que el usuario no canceló aparecería
 * como cancelada y nadie miraría el reloj.
 */

import { ProviderError } from '@nn-anime/core'
import { PROVIDER_API_VERSION, type ProviderMethod } from './types'

export type ProviderFailureKind =
  | 'threw'
  | 'aborted'
  | 'timeout'
  | 'invalid-shape'
  | 'api-version'
  | 'duplicate-id'
  | 'unsupported'

/** Nombre de la excepción, sin conversiones de tipo. */
function causeName(cause: unknown): string {
  if (cause instanceof Error) return cause.name
  if (cause instanceof DOMException) return cause.name

  return ''
}

function causeMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string') return cause

  return 'sin causa'
}

/**
 * `AbortSignal.timeout` produce `TimeoutError`; `AbortController.abort()`,
 * `AbortError`. El nombre es lo único que los distingue.
 */
export function classifyThrow(cause: unknown): ProviderFailureKind {
  const name = causeName(cause)

  if (name === 'TimeoutError') return 'timeout'
  if (name === 'AbortError') return 'aborted'

  return 'threw'
}

function describe(kind: ProviderFailureKind, cause: unknown): string {
  switch (kind) {
    case 'threw':
      return `lanzó una excepción: ${causeMessage(cause)}`
    case 'aborted':
      return 'la llamada se canceló'
    case 'timeout':
      return 'la llamada superó el tiempo límite'
    case 'invalid-shape':
      return 'la respuesta no cumple el contrato'
    case 'api-version':
      return `la versión del contrato no es '${PROVIDER_API_VERSION}'`
    case 'duplicate-id':
      return 'ya hay un proveedor con este id'
    case 'unsupported':
      return 'la capacidad pedida no está declarada en `capabilities`'
  }
}

export interface ProviderFailureOptions {
  readonly providerId: string
  /** Ausente cuando el fallo es de la forma del plugin, no de una llamada. */
  readonly method?: ProviderMethod
  readonly kind: ProviderFailureKind
  readonly cause?: unknown
  /** Sustituye al texto por defecto del tipo de fallo. */
  readonly detail?: string
}

export function providerFailure(options: ProviderFailureOptions): ProviderError {
  const detail = options.detail ?? describe(options.kind, options.cause)
  const where =
    options.method === undefined
      ? `el proveedor '${options.providerId}' no cumple el contrato`
      : `el proveedor '${options.providerId}' falló en ${options.method}`

  return new ProviderError({
    message: `${where}: ${detail}`,
    scope: options.providerId,
    ...(options.method === undefined ? {} : { op: options.method }),
    cause: options.cause,
    context: { kind: options.kind },
  })
}

/**
 * Versión del contrato distinta de la esperada.
 *
 * El mensaje nombra la esperada y la encontrada: «no es compatible» obliga a
 * buscar en el código cuál es la buena.
 */
export function apiVersionMismatch(providerId: string, found: string): ProviderError {
  return providerFailure({
    providerId,
    kind: 'api-version',
    detail: `declara apiVersion '${found}' y este SDK implementa la '${PROVIDER_API_VERSION}'`,
  })
}

/** Un `id` ya registrado. Gana el primero, que es la regla del spec. */
export function duplicateId(providerId: string): ProviderError {
  return providerFailure({
    providerId,
    kind: 'duplicate-id',
    detail: `ya hay un proveedor con el id '${providerId}'; gana el primero`,
  })
}

/**
 * Forma inválida, con el motivo exacto.
 *
 * Los problemas llegan de Zod con su ruta, así que el mensaje dice qué campo
 * —y qué header, cuando es un header— incumple el contrato.
 */
export function invalidShape(
  providerId: string,
  problems: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[],
): ProviderError {
  return providerFailure({
    providerId,
    kind: 'invalid-shape',
    detail: describeProblems(problems),
  })
}

/**
 * El mismo fallo, con el archivo delante.
 *
 * En un directorio con veinte plugins, «ya hay un proveedor con el id `bueno`»
 * no dice qué borrar. El archivo es parte del motivo, y el motivo es lo que se
 * imprime: quien lee tiene que poder actuar sin buscar.
 */
export function namedByFile(reason: ProviderError, file: string): ProviderError {
  return new ProviderError({
    message: `${file}: ${reason.message}`,
    scope: reason.scope,
    op: reason.op,
    cause: reason,
    context: { ...reason.context },
  })
}

/** Una línea por problema, nombrando el campo. Compartido con la respuesta. */
export function describeProblems(
  problems: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[],
): string {
  const text = problems
    .map((problem) => {
      const where = problem.path.map(String).join('.')
      return where === '' ? problem.message : `${where}: ${problem.message}`
    })
    .join('; ')

  return text === '' ? describe('invalid-shape', undefined) : text
}
