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
  // Declaradas aunque `default-src` ya las cubra: el día que alguien relaje
  // `default-src`, éstas no se abren sin que nadie lo note.
  "frame-src 'none'",
  "worker-src 'none'",
  "manifest-src 'self'",
  // Sin esto `default-src` no la cubre, y un formulario inyectado enviaría datos
  // a un origen ajeno.
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ')

/**
 * La política del cast: los hosts exactos que el SDK necesita.
 *
 * No es una lista abierta: `script-src` sigue admitiendo sólo el origen propio y
 * `gstatic`; `connect-src` añade los dos hosts de Google que el SDK consulta. El
 * resto de la política es la misma. T379 puede quitarlos o añadir `frame-src`
 * si el dispositivo real lo exige; hasta entonces no se abre nada más.
 */
export const CAST_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self'",
  "media-src 'self' blob:",
  "script-src 'self' https://www.gstatic.com",
  "connect-src 'self' https://www.gstatic.com https://clients3.google.com",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "manifest-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ')

/**
 * Lo que la aplicación no usa, y por tanto un guion inyectado no tiene por qué
 * poder pedir. No hay cámara, ni micrófono, ni geolocalización, ni pagos, ni USB
 * en ninguna parte de `packages/web/src`: medido con una búsqueda sobre el árbol.
 */
export const PERMISSIONS_POLICY = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'serial=()',
].join(', ')

export interface SecurityHeadersOptions {
  /** Permite relajar la política en desarrollo. Por defecto, la del spec. */
  readonly contentSecurityPolicy?: string
  /** El cast está encendido: añade los hosts del SDK, y sólo esos. */
  readonly cast?: boolean
}

export function securityHeaders(options: SecurityHeadersOptions = {}): MiddlewareHandler {
  const policy =
    options.contentSecurityPolicy ??
    (options.cast === true ? CAST_CONTENT_SECURITY_POLICY : CONTENT_SECURITY_POLICY)

  return async (c, next) => {
    await next()

    c.header('Content-Security-Policy', policy)
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Frame-Options', 'DENY')
    c.header('Permissions-Policy', PERMISSIONS_POLICY)
    // Aíslan el contexto del navegador y evitan que otro origen incruste estas
    // respuestas. En una aplicación local, «otro origen» es cualquier página que
    // el usuario tenga abierta.
    c.header('Cross-Origin-Opener-Policy', 'same-origin')
    c.header('Cross-Origin-Resource-Policy', 'same-origin')
    c.header('X-Permitted-Cross-Domain-Policies', 'none')
  }
}
