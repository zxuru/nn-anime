/**
 * Acceso del modo servidor: un formulario que cambia el token por la cookie.
 *
 * El token fijo no viaja en una URL. Si viajara, acabaría en el historial del
 * navegador, en los `Referer` y en los registros del proxy; el formulario es la
 * forma de pedirlo una vez y quedarse con una cookie `HttpOnly` que un guion de
 * la página no puede leer.
 *
 * La página no lleva JavaScript ni estilos en línea: la política de contenido
 * del proyecto no admite `'unsafe-inline'`, y una pantalla de acceso que
 * necesita relajarla para pintarse sería la peor excusa para relajarla. El
 * formulario funciona con el navegador de fábrica.
 */

import type { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { safeRedirect } from './bootstrap'
import { readCookie } from './cookies'
import { type Session, safeEqual } from './session'

/** La ruta pública del formulario. El guard de token la deja pasar. */
export const LOGIN_PATH = '/login'

const HTML_HEADERS = { 'cache-control': 'no-store' } as const

/**
 * El formulario, con el aviso de error si lo hay.
 *
 * El único texto variable es una constante de este módulo; no se interpola
 * nada que venga de la petición, así que no hay HTML que escapar. Si algún día
 * se acepta un `next`, se validará con `safeRedirect` antes de escribirlo.
 */
export function renderLoginPage(error?: string): string {
  const aviso = error === undefined ? '' : `<p role="alert">${error}</p>`

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>nn-anime</title>
  </head>
  <body>
    <main>
      <h1>nn-anime</h1>
      <p>Este servidor pide el token de <code>NN_ANIME_TOKEN</code> para entrar.</p>
      <form method="post" action="${LOGIN_PATH}">
        <label for="token">Token</label>
        <input id="token" name="token" type="password" autocomplete="current-password" required autofocus />
        <button type="submit">Entrar</button>
      </form>
      ${aviso}
    </main>
  </body>
</html>
`
}

export interface LoginOptions {
  readonly session: Session
  /** `Secure` cuando el origen público es https. */
  readonly secureCookie: boolean
}

export function registerLogin(app: Hono, options: LoginOptions): void {
  app.get(LOGIN_PATH, (c) => {
    const candidate = readCookie(c.req.header('cookie'), options.session.cookieName)

    // Ya autenticado: el formulario no tiene nada que hacer.
    if (options.session.matches(candidate)) return c.redirect('/', 303)

    return c.html(renderLoginPage(), 200, HTML_HEADERS)
  })

  app.post(LOGIN_PATH, async (c) => {
    let body: Record<string, string | File>
    try {
      body = await c.req.parseBody()
    } catch {
      return c.html(renderLoginPage('No se pudo leer el formulario.'), 400, HTML_HEADERS)
    }

    const presented = body.token

    if (typeof presented !== 'string' || !safeEqual(presented, options.session.value)) {
      return c.html(renderLoginPage('Token incorrecto.'), 401, HTML_HEADERS)
    }

    setCookie(c, options.session.cookieName, options.session.value, {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
      secure: options.secureCookie,
    })

    // 303 y no 302: el navegador vuelve a pedir `/` con GET, que es lo que
    // sirve la interfaz; un 302 después de un POST también lo haría, pero 303
    // lo dice sin depender de la heurística del cliente.
    return c.redirect(safeRedirect('/'), 303)
  })
}
