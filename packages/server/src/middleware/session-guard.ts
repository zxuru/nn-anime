/**
 * Guard de sesión.
 *
 * La sesión vive en una cookie `HttpOnly`, así que un XSS en la propia interfaz
 * no puede leerla. No existe ninguna vía de autenticación por query string: si
 * existiera, el token acabaría en el historial del navegador y en los `Referer`.
 *
 * **La única excepción es el ticket del proxy.** `mpv` no tiene cookie y no
 * puede tenerla: es un proceso aparte al que se le entrega una URL. Esa URL —el
 * ticket, CSPRNG de 24 bytes, 600 s de vida y tope de 500 entradas— es la
 * credencial, y sin ella el handoff abría una ventana que no reproducía nada
 * porque el proxy contestaba 401. Vale **sólo** bajo `/stream/:ticket`, que es
 * donde el ticket significa algo; en cualquier otra ruta se sigue exigiendo la
 * cookie, y un ticket inventado no abre nada.
 *
 * El rechazo no lleva cuerpo. Un 401 vacío no le dice a quien prueba nada sobre
 * por qué falló.
 */

import type { TicketStore } from '@nn-anime/media-proxy'
import type { MiddlewareHandler } from 'hono'
import { readCookie } from '../cookies'
import type { SessionStore } from '../session'

/** El prefijo de las rutas que habla el proxy con tickets. */
const STREAM_PREFIX = '/stream/'

/**
 * El ticket que una ruta del proxy lleva delante, si lo lleva.
 *
 * Sólo el primer segmento: `/stream/:ticket`, `/stream/:ticket/seg/:index` y
 * `/stream/:ticket/key/:index` son el mismo recurso por partes, y el índice se
 * resuelve contra la playlist que el ticket ya autorizó.
 */
export function ticketFromPath(path: string): string | undefined {
  if (!path.startsWith(STREAM_PREFIX)) return undefined

  const resto = path.slice(STREAM_PREFIX.length)
  const corte = resto.indexOf('/')
  const ticket = corte === -1 ? resto : resto.slice(0, corte)

  return ticket === '' ? undefined : ticket
}

export interface SessionGuardOptions {
  /**
   * El almacén de tickets.
   *
   * Sin él —una aplicación montada sin contenedor— no hay excepción que valga y
   * el guard se comporta como antes. Falla cerrado a propósito.
   */
  readonly tickets?: TicketStore | undefined
}

export function sessionGuard(
  session: SessionStore,
  options: SessionGuardOptions = {},
): MiddlewareHandler {
  return async (c, next) => {
    const ticket = ticketFromPath(c.req.path)

    if (ticket !== undefined && options.tickets?.resolve(ticket).ok === true) {
      await next()

      return
    }

    const candidate = readCookie(c.req.header('cookie'), session.cookieName)

    if (!session.matches(candidate)) {
      return c.text('', 401)
    }

    await next()
  }
}
