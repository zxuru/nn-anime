/**
 * Cabeceras de seguridad.
 *
 * La interfaz y la API comparten origen, así que un XSS en la interfaz es
 * compromiso total del servidor local: leería el historial, lanzaría mpv y
 * usaría el proxy. Estas cabeceras son la red que convierte ese fallo en un
 * incidente acotado en lugar de una toma de control.
 *
 * Las cabeceras se escriben **después** de `next()`: así llegan también a las
 * respuestas que cortan los guards, como el 401 o el 403.
 *
 * Nota sobre estilos: la política no admite `'unsafe-inline'`. React aplica la
 * propiedad `style` por CSSOM, que la CSP no bloquea, así que los estilos
 * dinámicos siguen funcionando. Lo que sí rompería es un `setAttribute('style')`
 * o una etiqueta `<style>` en línea.
 */

import type { MiddlewareHandler } from 'hono'

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self'",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ')

export interface SecurityHeadersOptions {
  /** Permite relajar la política en desarrollo. Por defecto, la del spec. */
  readonly contentSecurityPolicy?: string
}

export function securityHeaders(options: SecurityHeadersOptions = {}): MiddlewareHandler {
  const policy = options.contentSecurityPolicy ?? CONTENT_SECURITY_POLICY

  return async (c, next) => {
    await next()

    c.header('Content-Security-Policy', policy)
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Frame-Options', 'DENY')
  }
}
