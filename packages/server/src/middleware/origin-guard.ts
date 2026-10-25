/**
 * Guard de `Origin`.
 *
 * Se aplica sólo a métodos mutantes. Una lectura ya está protegida por la
 * cookie `SameSite=Strict` y por la validación de `Host`; exigir `Origin` en
 * una lectura rompería la navegación normal, que no lo envía.
 *
 * `Origin: null` se rechaza igual que un origen ausente: es lo que envían los
 * iframes en sandbox y los documentos `file:`, y no es un origen de confianza.
 *
 * En el modo local sólo hay un origen admitido, el que abre el CLI. En un
 * servidor el origen puede ser el público declarado o el mismo `Host` de la
 * petición —lo que ve el navegador que carga la interfaz, también detrás de un
 * proxy que conserva `Host`—. La comparación por host es lo que hace que el
 * formulario de login y las mutaciones funcionen en una LAN sin enumerar cada
 * nombre posible.
 */

import type { MiddlewareHandler } from 'hono'

const MUTATING_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * El único origen admitido en local: el mismo que admite el guard de `Host`.
 *
 * `localhost` se aceptaba y ya no. No es lo mismo: las cookies ignoran el
 * puerto, así que una página servida por otra aplicación local en
 * `localhost:OTRO_PUERTO` comparte sitio con ésta. El guard de `Host` ya rechaza
 * ese nombre, así que aceptarlo aquí era código muerto que decía lo contrario de
 * lo que el proyecto hace. El proxy de desarrollo reescribe `Origin` al origen
 * real, así que el camino de desarrollo sigue pasando por esta misma puerta.
 */
function allowedOrigins(port: number, extraOrigins: readonly string[] = []): ReadonlySet<string> {
  return new Set([
    `http://127.0.0.1:${port}`,
    ...extraOrigins.map((origin) => origin.toLowerCase()),
  ])
}

/** ¿El origen es el mismo host que la petición, con http o https? */
function sameHost(origin: string, host: string | undefined): boolean {
  if (host === undefined) return false

  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

    return url.host.toLowerCase() === host.toLowerCase()
  } catch {
    return false
  }
}

export interface OriginGuardOptions {
  /** Orígenes exactos que se suman al loopback (el público declarado). */
  readonly extraOrigins?: readonly string[] | undefined
  /** Acepta el origen cuyo host coincide con el `Host` de la petición. */
  readonly sameOrigin?: boolean | undefined
}

export function originGuard(
  getPort: () => number,
  options: OriginGuardOptions = {},
): MiddlewareHandler {
  return async (c, next) => {
    if (MUTATING_METHODS.has(c.req.method.toUpperCase())) {
      const origin = c.req.header('origin')

      if (origin === undefined) return c.text('', 403)

      const allowed = allowedOrigins(getPort(), options.extraOrigins)
      if (allowed.has(origin.toLowerCase())) {
        await next()

        return
      }

      if (options.sameOrigin === true && sameHost(origin, c.req.header('host'))) {
        await next()

        return
      }

      return c.text('', 403)
    }

    await next()
  }
}
