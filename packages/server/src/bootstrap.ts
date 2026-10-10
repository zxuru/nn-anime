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

export interface BootstrapOptions {
  readonly bootToken: string
  readonly session: Session
  readonly redirectTo?: string
}

export function bootstrapHandler(options: BootstrapOptions): MiddlewareHandler {
  let redeemed = false

  return async (c, next) => {
    const presented = c.req.query(BOOT_PARAM)
    if (presented === undefined) return next()

    if (redeemed || !safeEqual(presented, options.bootToken)) {
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
