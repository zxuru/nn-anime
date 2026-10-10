/**
 * Cliente HTTP de la interfaz.
 *
 * **No maneja ningún token.** La sesión viaja en una cookie `HttpOnly` que
 * JavaScript no puede leer, así que aquí no hay nada que adjuntar a mano y nada
 * que un XSS pueda robar. `credentials: 'same-origin'` lo dice de forma
 * explícita, aunque sea el valor por defecto.
 */

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }

  /** La sesión no vale: hay que volver a entrar por la dirección de arranque. */
  get isSessionLost(): boolean {
    return this.status === 401
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
}

const TIMEOUT_MS = 8000

function realDeps(): RequestDeps {
  return { fetch: (input, init) => globalThis.fetch(input, init) }
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
  deps: RequestDeps = realDeps(),
): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = { accept: 'application/json' }

  if (options.body !== undefined) headers['content-type'] = 'application/json'

  const response = await deps.fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal ?? AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new ApiError(response.status, `${method} ${path} respondió ${response.status}`)
  }

  if (response.status === 204) return undefined as T

  return (await response.json()) as T
}

export function apiGet<T>(
  path: string,
  options: Omit<RequestOptions, 'method' | 'body'> = {},
  deps?: RequestDeps,
): Promise<T> {
  return request<T>(path, { ...options, method: 'GET' }, deps)
}

export function apiPost<T>(
  path: string,
  body?: unknown,
  options: Omit<RequestOptions, 'method' | 'body'> = {},
  deps?: RequestDeps,
): Promise<T> {
  return request<T>(path, { ...options, method: 'POST', body }, deps)
}

export function apiPatch<T>(
  path: string,
  body?: unknown,
  options: Omit<RequestOptions, 'method' | 'body'> = {},
  deps?: RequestDeps,
): Promise<T> {
  return request<T>(path, { ...options, method: 'PATCH', body }, deps)
}
