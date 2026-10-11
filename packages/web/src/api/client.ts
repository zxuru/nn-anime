/**
 * Cliente HTTP de la interfaz.
 *
 * **No maneja ningún token.** La sesión viaja en una cookie `HttpOnly` que
 * JavaScript no puede leer, así que aquí no hay nada que adjuntar a mano y nada
 * que un XSS pueda robar. `credentials: 'same-origin'` lo dice de forma
 * explícita, aunque sea el valor por defecto.
 *
 * **No hay conversiones de tipo.** La respuesta se valida con un schema Zod
 * antes de devolverla. Un `as T` sobre `response.json()` haría que un campo
 * renombrado en el servidor apareciera como `undefined` en mitad de un
 * componente; con el schema falla en la frontera, que es donde se puede
 * entender. El bundle de la interfaz paga unos kilobytes por ello y los vale.
 */

import type { z } from 'zod'

/** La sesión no vale o la petición no está permitida. */
export class ApiError extends Error {
  readonly status: number
  /**
   * Lo que el servidor contó del fallo, si lo contó.
   *
   * El mensaje de arriba es el mínimo —«POST /api/providers respondió 409»— y
   * sirve para el registro. Esto es lo que se le puede enseñar a una persona:
   * «ya hay un proveedor con ese identificador». Cuando el cuerpo no trae nada
   * legible, se queda sin definir y quien lo muestre usa el mensaje.
   */
  readonly detail: string | undefined

  constructor(status: number, message: string, detail?: string | undefined) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }

  /** Hay que volver a entrar por la dirección de arranque. */
  get isSessionLost(): boolean {
    return this.status === 401
  }
}

/** La respuesta llegó, pero no tiene la forma prometida. */
export class ApiShapeError extends Error {
  readonly path: string
  readonly issues: string

  constructor(path: string, issues: string) {
    super(`la respuesta de ${path} no cumple el schema: ${issues}`)
    this.name = 'ApiShapeError'
    this.path = path
    this.issues = issues
  }
}

export interface RequestDeps {
  /** Se llama siempre con una ruta relativa, nunca con una URL absoluta. */
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  readonly body?: unknown
  readonly signal?: AbortSignal
  /**
   * Tiempo límite en milisegundos. Por defecto, 8 segundos; `0` lo desactiva.
   *
   * Existe la salida porque hay peticiones legítimamente lentas. Un límite que
   * no se puede levantar es una trampa para la tarea siguiente que necesite una
   * respuesta larga.
   */
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 8000

function signalFor(options: RequestOptions): AbortSignal | undefined {
  if (options.signal !== undefined) return options.signal

  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // Se valida aquí y no se deja a `AbortSignal.timeout`, que lanza un
  // `TypeError` de la plataforma sin decir qué opción lo causó.
  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new RangeError(`timeoutMs no puede ser negativo ni infinito: ${timeout}`)
  }

  return timeout === 0 ? undefined : AbortSignal.timeout(timeout)
}

function realDeps(): RequestDeps {
  return { fetch: (input, init) => globalThis.fetch(input, init) }
}

/**
 * El `error` del cuerpo de una respuesta que falló, si lo trae.
 *
 * Se lee con cuidado porque aquí no se puede exigir nada: la respuesta puede no
 * ser JSON, ser un 502 de un proxy, o no tener cuerpo. Cualquiera de las tres
 * cosas es un no, y en las tres el mensaje genérico es lo único honesto. El
 * cuerpo se consume, pero esta rama ya no lo va a usar: lanza.
 */
async function errorDetail(response: Response): Promise<string | undefined> {
  try {
    const payload: unknown = await response.json()
    if (typeof payload !== 'object' || payload === null) return undefined

    const error = Reflect.get(payload, 'error')

    return typeof error === 'string' && error !== '' ? error : undefined
  } catch {
    return undefined
  }
}

async function dispatch(
  path: string,
  options: RequestOptions,
  deps: RequestDeps,
): Promise<Response> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = { accept: 'application/json' }

  if (options.body !== undefined) headers['content-type'] = 'application/json'

  const response = await deps.fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: signalFor(options),
  })

  if (!response.ok) {
    throw new ApiError(
      response.status,
      `${method} ${path} respondió ${response.status}`,
      await errorDetail(response),
    )
  }

  return response
}

/**
 * Lecturas en vuelo, por clave.
 *
 * Dos componentes que piden lo mismo a la vez comparten una sola petición. La
 * clave incluye el método porque sólo se deduplican las lecturas: una mutación
 * repetida sí tiene que llegar dos veces.
 *
 * La clave incluye **la ruta y el tiempo límite**. La petición compartida usa
 * las opciones de quien la creó, así que dos llamadores con límites distintos
 * no pueden compartir la carrera: el que pidió un límite corto esperaría al
 * largo del otro sin saberlo.
 *
 * Una lectura con señal propia **no se deduplica**. Quien pasa una señal quiere
 * decidir cuándo muere su petición, y una compartida muere con el primero que
 * cancela: el segundo llamador quedaría arrastrado por una cancelación ajena, o
 * creería haber cancelado algo que sigue vivo.
 *
 * Se guarda el cuerpo ya analizado y no la respuesta: un `Response` sólo se
 * puede leer una vez, así que compartirlo entre dos llamadores haría fallar al
 * segundo. Y se guarda como `unknown` a propósito, para que cada llamador lo
 * valide con su schema sin ninguna conversión de tipo por el medio.
 *
 * Las dependencias no entran en la clave. En producción hay un solo `fetch`,
 * así que no distinguen nada; en un test, dos dependencias distintas sobre la
 * misma ruta no deberían pedirse a la vez, porque la segunda recibiría el
 * cuerpo de la primera. La entrada se borra al terminar, así que no se hereda
 * entre pruebas secuenciales.
 */
const inFlight = new Map<string, Promise<unknown>>()

function dedupeKey(path: string, options: RequestOptions): string | undefined {
  if (options.signal !== undefined) return undefined

  return `${path}\u0000${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}`
}

async function jsonPayload(
  path: string,
  options: RequestOptions,
  deps: RequestDeps,
): Promise<unknown> {
  const response = await dispatch(path, options, deps)

  if (response.status === 204) {
    throw new ApiShapeError(path, 'el servidor respondió 204 donde se esperaba un cuerpo')
  }

  try {
    return await response.json()
  } catch {
    throw new ApiShapeError(path, 'el cuerpo no es JSON válido')
  }
}

function shared(key: string, work: () => Promise<unknown>): Promise<unknown> {
  const existing = inFlight.get(key)
  if (existing !== undefined) return existing

  // La entrada se borra **antes** de que ningún llamador continúe. Con un
  // `finally` suelto, una lectura ya terminada sigue contando como en vuelo
  // durante un par de ciclos del bucle de eventos, y la siguiente petición de
  // la misma ruta —otro componente, otra prueba— puede recibir el cuerpo de la
  // anterior. Es una dependencia de orden: se midió esa contaminación entre dos
  // pruebas de este archivo, así que no se deja abierta.
  const pending = work().then(
    (value) => {
      inFlight.delete(key)
      return value
    },
    (error: unknown) => {
      inFlight.delete(key)
      throw error
    },
  )

  inFlight.set(key, pending)
  // Un fallo que nadie escuche no debe convertirse en un rechazo no gestionado.
  pending.catch(() => {})

  return pending
}

/** Petición cuya respuesta es JSON y tiene que cumplir un schema. */
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
  deps: RequestDeps = realDeps(),
): Promise<T> {
  const isRead = (options.method ?? 'GET') === 'GET'
  const key = isRead ? dedupeKey(path, options) : undefined
  const payload =
    key === undefined
      ? await jsonPayload(path, options, deps)
      : await shared(key, () => jsonPayload(path, options, deps))

  const parsed = schema.safeParse(payload)
  if (!parsed.success) throw new ApiShapeError(path, parsed.error.message)

  return parsed.data
}

/** Petición cuyo cuerpo de respuesta se ignora. Para mutaciones. */
export async function send(
  path: string,
  options: RequestOptions = {},
  deps: RequestDeps = realDeps(),
): Promise<void> {
  await dispatch(path, options, deps)
}

export function apiGet<T>(
  path: string,
  schema: z.ZodType<T>,
  options: Omit<RequestOptions, 'method' | 'body'> = {},
  deps?: RequestDeps,
): Promise<T> {
  return request(path, schema, { ...options, method: 'GET' }, deps)
}

export function apiPost(
  path: string,
  body?: unknown,
  options: Omit<RequestOptions, 'method' | 'body'> = {},
  deps?: RequestDeps,
): Promise<void> {
  return send(path, { ...options, method: 'POST', body }, deps)
}

/** Un `POST` que devuelve el cuerpo, validado con su schema. */
export function apiPostJson<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  options: Omit<RequestOptions, 'method' | 'body'> = {},
  deps?: RequestDeps,
): Promise<T> {
  return request(path, schema, { ...options, method: 'POST', body }, deps)
}

export function apiPatch(
  path: string,
  body?: unknown,
  options: Omit<RequestOptions, 'method' | 'body'> = {},
  deps?: RequestDeps,
): Promise<void> {
  return send(path, { ...options, method: 'PATCH', body }, deps)
}
