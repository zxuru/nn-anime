/**
 * Guard de sesión.
 *
 * La sesión vive en una cookie `HttpOnly`, así que un XSS en la propia interfaz
 * no puede leerla. No existe ninguna vía de autenticación por query string: si
 * existiera, el token acabaría en el historial del navegador y en los `Referer`.
 *
 * El rechazo no lleva cuerpo. Un 401 vacío no le dice a quien prueba nada sobre
 * por qué falló.
 */

import type { MiddlewareHandler } from 'hono'
import { readCookie } from '../cookies'
import type { SessionStore } from '../session'

export function sessionGuard(session: SessionStore): MiddlewareHandler {
  return async (c, next) => {
    const candidate = readCookie(c.req.header('cookie'), session.cookieName)

    if (!session.matches(candidate)) {
      return c.text('', 401)
    }

    await next()
  }
}
