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

/**
 * El único origen admitido: el mismo que admite el guard de `Host`.
 *
 * `localhost` se aceptaba y ya no. No es lo mismo: las cookies ignoran el
 * puerto, así que una página servida por otra aplicación local en
 * `localhost:OTRO_PUERTO` comparte sitio con ésta. El guard de `Host` ya rechaza
 * ese nombre, así que aceptarlo aquí era código muerto que decía lo contrario de
 * lo que el proyecto hace. El proxy de desarrollo reescribe `Origin` al origen
 * real, así que el camino de desarrollo sigue pasando por esta misma puerta.
 */
function allowedOrigins(port: number): ReadonlySet<string> {
  return new Set([`http://127.0.0.1:${port}`])
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
