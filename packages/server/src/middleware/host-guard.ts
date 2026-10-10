/**
 * Guard de `Host`.
 *
 * Un server HTTP en `127.0.0.1` es alcanzable por cualquier página web que el
 * usuario visite. El ataque de DNS rebinding hace que `evil.example` resuelva a
 * `127.0.0.1`, pero el header `Host` sigue siendo `evil.example`: por eso se
 * valida, y se falla cerrado cuando no se puede comprobar.
 *
 * Se comprueban dos fuentes, la cabecera y la URL de la petición. En una
 * petición real coinciden, porque el servidor construye la URL a partir de la
 * cabecera. Si discrepan, algo raro está pasando y se rechaza.
 *
 * No se admite IPv6 porque el server no escucha en IPv6.
 */

import type { MiddlewareHandler } from 'hono'

function allowedHosts(port: number): ReadonlySet<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`])
}

export function hostGuard(getPort: () => number): MiddlewareHandler {
  return async (c, next) => {
    const allowed = allowedHosts(getPort())
    const fromHeader = c.req.header('host')
    const fromUrl = new URL(c.req.url).host

    if (fromHeader !== undefined && !allowed.has(fromHeader.toLowerCase())) {
      return c.text('', 403)
    }

    if (!allowed.has(fromUrl.toLowerCase())) {
      return c.text('', 403)
    }

    await next()
  }
}
