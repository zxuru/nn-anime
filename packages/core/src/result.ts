/**
 * Resultado explícito para las fronteras de red y disco.
 *
 * Una llamada que puede fallar por causas externas devuelve `Result` en lugar
 * de lanzar. Las excepciones quedan reservadas para errores de programa.
 */

export interface Ok<T> {
  readonly ok: true
  readonly value: T
}

export interface Err<E> {
  readonly ok: false
  readonly error: E
}

export type Result<T, E> = Ok<T> | Err<E>

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value }
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error }
}

/** Transforma el valor de un resultado exitoso. Un fallo se propaga intacto. */
export function map<T, U, E>(result: Result<T, E>, transform: (value: T) => U): Result<U, E> {
  return result.ok ? ok(transform(result.value)) : result
}

/** Transforma el error de un resultado fallido. Un éxito se propaga intacto. */
export function mapErr<T, E, F>(result: Result<T, E>, transform: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(transform(result.error))
}

/** Devuelve el valor si lo hay. Sólo cae al sustituto cuando el resultado es un fallo. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback
}
