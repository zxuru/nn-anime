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
 * **El modo local no cambia.** Sin opciones se admite sólo `127.0.0.1:PUERTO`,
 * que es la dirección que el arranque abre. El modo servidor añade los hosts
 * que el despliegue declara y, si no declaró un origen público, acepta
 * cualquiera: en una LAN no se puede saber con qué nombre van a llegar los
 * clientes, y la credencial que protege los datos es la cookie, no el nombre.
 * Esa decisión está en `SECURITY.md`.
 */

import type { MiddlewareHandler } from 'hono'

export interface HostGuardOptions {
  /** Hosts exactos (`nombre:puerto`) que se suman al loopback. */
  readonly extraHosts?: readonly string[] | undefined
  /** Acepta cualquier `Host`; sólo para el modo servidor sin origen público. */
  readonly allowAny?: boolean | undefined
}

/**
 * Los nombres admitidos en modo local: **sólo `127.0.0.1`**.
 *
 * `localhost` se aceptaba y ya no. No es lo mismo, porque **las cookies ignoran
 * el puerto**: una página servida por otra aplicación local en
 * `localhost:OTRO_PUERTO` es el mismo sitio para el navegador y podría leer la
 * cookie de sesión. Aceptar sólo la dirección que el arranque abre —que es
 * `127.0.0.1`— cierra ese caso.
 */
function allowedHosts(port: number, extraHosts: readonly string[] = []): ReadonlySet<string> {
  return new Set([`127.0.0.1:${port}`, ...extraHosts.map((host) => host.toLowerCase())])
}

export function hostGuard(
  getPort: () => number,
  options: HostGuardOptions = {},
): MiddlewareHandler {
  return async (c, next) => {
    const fromHeader = c.req.header('host')
    const fromUrl = new URL(c.req.url).host

    if (options.allowAny === true) {
      // Incluso aceptando cualquier nombre se sigue rechazando la discrepancia
      // entre cabecera y URL: en una petición real son el mismo valor, y una
      // diferencia es una petición fabricada.
      if (fromHeader !== undefined && fromHeader.toLowerCase() !== fromUrl.toLowerCase()) {
        return c.text('', 403)
      }

      await next()

      return
    }

    const allowed = allowedHosts(getPort(), options.extraHosts)

    if (fromHeader !== undefined && !allowed.has(fromHeader.toLowerCase())) {
      return c.text('', 403)
    }

    if (!allowed.has(fromUrl.toLowerCase())) {
      return c.text('', 403)
    }

    await next()
  }
}
