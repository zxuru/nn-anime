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

export interface BootstrapOptions {
  readonly bootToken: string
  readonly session: Session
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

    redeemed = true

    setCookie(c, options.session.cookieName, options.session.value, {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
      // Sin `Secure` a propósito: la aplicación se sirve por http en loopback.
      // Marcarla obligaría al navegador a descartarla y no habría sesión.
      secure: false,
    })

    return c.redirect(options.redirectTo ?? DEFAULT_REDIRECT, 302)
  }
}
