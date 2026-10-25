/**
 * Sesión local del proceso.
 *
 * La sesión vive en una cookie `HttpOnly`, así que un XSS en la propia interfaz
 * no puede leerla. El valor es de 32 bytes de entropía y se compara en tiempo
 * constante: comparar con `===` filtra longitud y prefijo por diferencia de
 * tiempo.
 *
 * Nada de esto se persiste. Al morir el proceso, la sesión muere con él.
 */

/** Nombre de la cookie que lleva la sesión. */
export const SESSION_COOKIE = 'nn_session'

/** Bytes de entropía de un secreto. 32 bytes son 43 caracteres en base64url. */
const SECRET_BYTES = 32

function randomToken(): string {
  const bytes = new Uint8Array(SECRET_BYTES)
  crypto.getRandomValues(bytes)

  return Buffer.from(bytes).toString('base64url')
}

/**
 * Compara dos secretos sin filtrar información por el tiempo.
 *
 * La comprobación de longitud es explícita y va antes: `timingSafeEqual` lanza
 * si los buffers miden distinto, y además el prefijo de una longitud equivocada
 * no es información útil para nadie.
 */
export function safeEqual(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) return false
  if (left.length !== right.length) return false

  const encoder = new TextEncoder()
  return crypto.timingSafeEqual(encoder.encode(left), encoder.encode(right))
}

export interface SessionStore {
  readonly cookieName: string
  /** Compara el valor presentado por el cliente contra el vigente. */
  matches(candidate: string | undefined): boolean
}

export interface Session extends SessionStore {
  /**
   * Valor de la cookie. Lo leen el canje de arranque y el formulario de login
   * del modo servidor, que son los dos sitios que la emiten.
   */
  readonly value: string
}

export function createSession(): Session {
  const value = randomToken()

  return {
    cookieName: SESSION_COOKIE,
    value,
    matches: (candidate) => safeEqual(candidate, value),
  }
}

/**
 * La sesión del modo servidor: el token fijo que eligió quien despliega.
 *
 * No es un token de un solo uso ni uno efímero: es la credencial de la
 * instalación y vive hasta que cambie la variable y se reinicie. Se guarda en
 * una cookie `HttpOnly` igual que la sesión local, y se compara con la misma
 * primitiva de tiempo constante.
 */
export function createTokenSession(token: string): Session {
  return {
    cookieName: SESSION_COOKIE,
    value: token,
    matches: (candidate) => safeEqual(candidate, token),
  }
}

/**
 * Token de un solo uso que viaja en la URL de arranque.
 *
 * El CLI abre el navegador en `/?boot=<token>`. El server lo canjea por la
 * cookie de sesión y lo quema, así que no queda en el historial del navegador
 * con valor reutilizable.
 */
export function createBootToken(): string {
  return randomToken()
}
