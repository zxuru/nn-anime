/**
 * La entrada automática del servidor de desarrollo.
 *
 * En producción la cookie de sesión la pone el canje de `?boot=`, y abrir la
 * aplicación en otro navegador exige pegar la dirección con el token. En
 * desarrollo eso frena justo lo que se está probando, así que el middleware de
 * Vite manda a `/__dev/boot` a quien navegue sin una sesión vigente; el server
 * sólo registra esa ruta con `RONA_DEV_ORIGIN` y sigue atado a loopback.
 *
 * La decisión vive aquí y no dentro de `vite.config.ts` para poder medirla sin
 * levantar Vite ni un servidor: son tres funciones puras salvo `sesionVigente`,
 * que recibe su `fetch`.
 */

import { DEV_BOOT_NEXT_PARAM, DEV_BOOT_PATH } from '@rona/core/dev'

export interface DevRequest {
  readonly method?: string | undefined
  readonly url?: string | undefined
  readonly headers: {
    readonly accept?: string | string[] | undefined
    readonly cookie?: string | undefined
  }
}

function rutaDe(url: string): string {
  const index = url.indexOf('?')
  return index === -1 ? url : url.slice(0, index)
}

/** Un archivo con extensión lo sirve Vite; no es una navegación de la SPA. */
function pareceArchivo(ruta: string): boolean {
  return /\.[a-z0-9]+$/i.test(ruta)
}

/**
 * ¿Esta petición es una navegación que debe entrar sola?
 *
 * Sólo HTML: las llamadas a `/api`, los módulos de Vite y los medios no llevan
 * `text/html` en `Accept`, así que no se tocan. Se excluyen además el propio
 * `__dev` —o se redirigiría a sí mismo— y cualquier URL que ya traiga el token,
 * que es la que tiene que llegar al canje.
 */
export function esNavegacion(request: DevRequest): boolean {
  const method = request.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') return false

  const url = request.url ?? '/'
  const ruta = rutaDe(url)
  if (ruta.startsWith(DEV_BOOT_PATH)) return false
  if (ruta.startsWith('/api') || ruta.startsWith('/stream')) return false
  if (url.includes('boot=')) return false
  if (pareceArchivo(ruta)) return false

  const accept = Array.isArray(request.headers.accept)
    ? request.headers.accept.join(',')
    : (request.headers.accept ?? '')

  return accept.includes('text/html')
}

/**
 * La dirección de entrada que corresponde a la página pedida.
 *
 * Se conserva el destino para que un enlace profundo abierto en otro navegador
 * no acabe en la home. `encodeURIComponent` protege el `Location`; las rutas
 * que no son locales caen en la raíz y el server vuelve a validarlas.
 */
export function entradaAutomatica(url: string): string {
  const destino = url.startsWith('/') && !url.startsWith('//') ? url : '/'
  if (destino === '/') return DEV_BOOT_PATH

  return `${DEV_BOOT_PATH}?${DEV_BOOT_NEXT_PARAM}=${encodeURIComponent(destino)}`
}

/**
 * ¿La cookie que trae el navegador sigue valiendo?
 *
 * Se le pregunta a `/api/health`, que está detrás del guard de sesión: 200 es
 * una sesión viva y 401 no. Sin cookie no hay petición. Si el server no
 * contesta se deja pasar a Vite para que enseñe su error en vez de encadenar
 * redirecciones hacia un servidor caído.
 */
export async function sesionVigente(
  cookie: string | undefined,
  healthUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (cookie === undefined || cookie.trim() === '') return false

  try {
    const response = await fetchImpl(healthUrl, { headers: { cookie } })
    return response.status === 200
  } catch {
    return true
  }
}
