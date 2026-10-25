/**
 * Guard del modo token: todo exige la cookie, salvo la salud y el formulario.
 *
 * El modo local protege `/api/*` y `/stream/*` y deja que los estáticos se
 * sirvan sin sesión: en loopback, el token de arranque es lo que impide que
 * otra página hable con la aplicación. En un servidor eso no basta —cualquiera
 * que llegue al puerto vería la interfaz—, así que este guard se monta sobre
 * `*` y los estáticos también pasan por él.
 *
 * Dos excepciones, y las dos son necesarias:
 *
 * 1. `/healthz`, porque el contenedor se comprueba a sí mismo sin credenciales.
 *    La respuesta no lleva versión, rutas ni proveedores: sólo dice «vivo».
 * 2. `/login`, que es donde se consigue la cookie.
 *
 * La tercera no es una excepción de ruta sino de credencial: `/stream/:ticket`
 * con un ticket vivo, porque `mpv` no tiene cookies. Es la misma regla que el
 * guard de sesión local.
 */

import type { TicketStore } from '@nn-anime/media-proxy'
import type { MiddlewareHandler } from 'hono'
import { LOGIN_PATH, renderLoginPage } from '../auth'
import { readCookie } from '../cookies'
import type { SessionStore } from '../session'
import { ticketFromPath } from './session-guard'

/** Rutas que no piden cookie. La salud sólo dice que el proceso responde. */
const PUBLIC_PATHS: ReadonlySet<string> = new Set(['/healthz', LOGIN_PATH])

export interface TokenGuardOptions {
  /** Sin almacén de tickets no hay excepción para `mpv`: falla cerrado. */
  readonly tickets?: TicketStore | undefined
}

function isApiPath(path: string): boolean {
  return path.startsWith('/api/') || path.startsWith('/stream/')
}

export function tokenGuard(
  session: SessionStore,
  options: TokenGuardOptions = {},
): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path

    if (PUBLIC_PATHS.has(path)) {
      await next()

      return
    }

    const ticket = ticketFromPath(path)
    if (ticket !== undefined && options.tickets?.resolve(ticket).ok === true) {
      await next()

      return
    }

    const candidate = readCookie(c.req.header('cookie'), session.cookieName)
    if (session.matches(candidate)) {
      await next()

      return
    }

    // Una navegación del navegador recibe el formulario con el 401: es lo que
    // convierte «no autorizado» en una pantalla que se puede usar, sin servir
    // una sola pieza de la interfaz. La API y los estáticos reciben un 401
    // vacío, que es el contrato que ya tiene el resto del servidor.
    const wantsHtml = c.req.method === 'GET' && (c.req.header('accept') ?? '').includes('text/html')

    if (wantsHtml && !isApiPath(path)) {
      return c.html(renderLoginPage(), 401, { 'cache-control': 'no-store' })
    }

    return c.text('', 401)
  }
}
