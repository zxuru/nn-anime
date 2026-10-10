/**
 * Guard de `Origin`.
 *
 * Se aplica sólo a métodos mutantes. Una lectura ya está protegida por la
 * cookie `SameSite=Strict` y por la validación de `Host`; exigir `Origin` en
 * una lectura rompería la navegación normal, que no lo envía.
 *
 * `Origin: null` se rechaza igual que un origen ausente: es lo que envían los
 * iframes en sandbox y los documentos `file:`, y no es un origen de confianza.
 */

import type { MiddlewareHandler } from 'hono'

const MUTATING_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function allowedOrigins(port: number): ReadonlySet<string> {
  return new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`])
}

export function originGuard(getPort: () => number): MiddlewareHandler {
  return async (c, next) => {
    if (MUTATING_METHODS.has(c.req.method.toUpperCase())) {
      const origin = c.req.header('origin')

      if (origin === undefined || !allowedOrigins(getPort()).has(origin.toLowerCase())) {
        return c.text('', 403)
      }
    }

    await next()
  }
}
