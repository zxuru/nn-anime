/**
 * Canje del token de arranque por la cookie de sesión.
 *
 * El middleware escucha en la raíz pero sólo actúa si viene el parámetro
 * `boot`. Sin él, deja pasar: `/` es también la ruta de la interfaz.
 */

import type { MiddlewareHandler } from 'hono'
import { setCookie } from 'hono/cookie'
import { type Session, safeEqual } from './session'

export const BOOT_PARAM = 'boot'
const DEFAULT_REDIRECT = '/'

/**
 * Vida del token de arranque.
 *
 * La URL con el token queda en el scrollback de la terminal, y quien pueda
 * leerla obtendría una sesión completa. Es de un solo uso, pero eso no basta:
 * si el navegador no llega a abrirse, el token quedaría válido durante horas.
 * Cinco minutos sobran para que el navegador haga su petición.
 */
export const BOOT_TTL_MS = 5 * 60 * 1000

/**
 * Sólo se admiten rutas locales.
 *
 * El destino lo decide el servidor a partir de la consulta del usuario, no el
 * cliente. Aun así se valida: una redirección a `//evil.example` es una URL
 * absoluta disfrazada de ruta, y un open redirect no tiene excusa.
 */
function safeRedirect(target: string | undefined): string {
  if (target === undefined || target === '') return DEFAULT_REDIRECT
  if (!target.startsWith('/')) return DEFAULT_REDIRECT
  if (target.startsWith('//')) return DEFAULT_REDIRECT
  if (target.includes('\\')) return DEFAULT_REDIRECT

  return target
}

export interface BootstrapOptions {
  readonly bootToken: string
  readonly session: Session
  /** Ruta local a la que ir tras el canje. Por defecto, `/`. */
  readonly redirectTo?: string
  /** Vida del token. Por defecto, `BOOT_TTL_MS`. */
  readonly ttlMs?: number
  /** Reloj inyectable, para poder testear la caducidad. */
  readonly now?: () => number
}

export function bootstrapHandler(options: BootstrapOptions): MiddlewareHandler {
  const now = options.now ?? (() => Date.now())
  const expiresAt = now() + (options.ttlMs ?? BOOT_TTL_MS)
  let redeemed = false

  return async (c, next) => {
    const presented = c.req.query(BOOT_PARAM)
    if (presented === undefined) return next()

    if (redeemed || now() > expiresAt || !safeEqual(presented, options.bootToken)) {
      return c.text('', 401)
    }

    setCookie(c, options.session.cookieName, options.session.value, {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
      // Sin `Secure` a propósito: la aplicación se sirve por http en loopback.
      // Marcarla obligaría al navegador a descartarla y no habría sesión.
      secure: false,
    })

    // El token se quema sólo cuando la cookie ya está puesta. Al revés, un
    // fallo al emitirla dejaría el token gastado y al usuario sin sesión.
    redeemed = true

    return c.redirect(safeRedirect(options.redirectTo), 302)
  }
}
