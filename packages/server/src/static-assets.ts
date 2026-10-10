/**
 * Servido de la interfaz construida.
 *
 * En producción hay un solo proceso: el server Bun sirve la interfaz y la API
 * en el mismo origen. Eso es lo que hace que la cookie de sesión valga y que no
 * haya CORS en juego.
 *
 * Cualquier ruta que no sea un archivo devuelve el `index.html`, porque el
 * enrutado es del lado del cliente: la ruta `/settings` no existe en disco y
 * aun así tiene que cargar la aplicación.
 *
 * Dos reglas de confinamiento, y las dos son obligatorias:
 *
 * 1. El nombre pedido no puede contener un segmento `..`. Se rechaza en lugar de
 *    normalizarse, porque pedir `../../etc/passwd` no es un descuido.
 * 2. Sólo se sirven archivos regulares, comprobados con `lstat`. Un enlace
 *    simbólico no es un archivo del build: si apunta fuera de la raíz, servirlo
 *    sería una lectura arbitraria del sistema de archivos.
 */

import { lstat } from 'node:fs/promises'
import { normalize, resolve, sep } from 'node:path'
import type { MiddlewareHandler } from 'hono'
import { isProtectedPath } from './paths'

export interface StaticAssetsOptions {
  /** Directorio del build de la interfaz. Suele ser `packages/web/dist`. */
  readonly root: string
  /** Archivo que se sirve para cualquier ruta de la interfaz. */
  readonly index?: string
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.')
  if (dot === -1) return 'application/octet-stream'

  return CONTENT_TYPES[path.slice(dot).toLowerCase()] ?? 'application/octet-stream'
}

/** Devuelve la ruta absoluta si está dentro de la raíz, o `undefined` si no lo está. */
export function confine(root: string, requested: string): string | undefined {
  if (requested.includes('\0')) return undefined
  if (requested.split('/').includes('..')) return undefined

  const base = resolve(root)
  const candidate = resolve(base, `.${normalize(`/${requested}`)}`)

  if (candidate !== base && !candidate.startsWith(base + sep)) return undefined

  return candidate
}

/** Ruta de un archivo regular dentro de la raíz. Ni directorios ni enlaces. */
async function regularFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile()
  } catch {
    return false
  }
}

export function staticAssets(options: StaticAssetsOptions): MiddlewareHandler {
  const base = resolve(options.root)
  const index = resolve(base, options.index ?? 'index.html')

  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next()

    // La interfaz no responde por la API. Sin esta salida, una ruta de la API
    // con sesión válida no encontraría archivo, caería al `index.html` y el
    // cliente recibiría HTML donde espera JSON.
    if (isProtectedPath(new URL(c.req.url).pathname)) return next()

    const raw = new URL(c.req.url).pathname
    let requested: string
    try {
      // El ataque real llega escapado: `%2e%2e` sobrevive al análisis de la URL,
      // así que hay que descodificar antes de confinar. Una secuencia inválida
      // no es un error del servidor, es una petición que no existe.
      requested = decodeURIComponent(raw)
    } catch {
      return c.text('', 404)
    }

    const confined = confine(base, requested)
    if (confined === undefined) return c.text('', 404)

    if (confined !== base && (await regularFile(confined))) {
      const immutable = !confined.endsWith('.html')

      return new Response(Bun.file(confined), {
        headers: {
          'content-type': contentTypeFor(confined),
          // Los recursos llevan hash en el nombre; el HTML no se cachea.
          'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
        },
      })
    }

    // Enrutado del lado del cliente: lo que no es un archivo es una ruta de la
    // interfaz, y la interfaz decide qué hacer con ella.
    if (!(await regularFile(index))) return next()

    return new Response(Bun.file(index), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}
