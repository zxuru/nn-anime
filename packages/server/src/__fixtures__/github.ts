/**
 * Un GitHub de mentira para las pruebas del servidor.
 *
 * Vive en `__fixtures__` y no en un `*.test.ts` porque lo usan dos: el cliente
 * de descarga y las rutas de repositorios. Un doble escrito dos veces se separa:
 * el segundo acabaría devolviendo un árbol con otra forma y la prueba del otro
 * mediría algo que no es.
 *
 * No sale a la red: devuelve las tres respuestas que la aplicación pide —la ficha
 * del repositorio, el árbol y el texto de cada archivo— y deja apuntadas las URLs
 * que de verdad se pidieron, que es lo que permite comprobar que un host ajeno no
 * llega a pedirse.
 */

import type { FetchLike } from '@nn-anime/media-proxy'
import { GITHUB_API_HOST, GITHUB_RAW_HOST } from '../github'

export interface TreeEntry {
  readonly path: string
  readonly type?: string
  readonly size?: number
}

export interface GithubFixture {
  readonly branch?: string
  readonly tree?: readonly TreeEntry[]
  readonly truncated?: boolean
  readonly blobs?: Readonly<Record<string, string>>
  /** Estado exacto por URL, para los casos de error. */
  readonly status?: Readonly<Record<string, number>>
  /** Redirección exacta por URL. */
  readonly redirect?: Readonly<Record<string, string>>
}

export interface FakeGithub {
  readonly impl: FetchLike
  /** Las URLs que de verdad se pidieron, en orden. */
  readonly calls: readonly string[]
}

export function fakeGithub(fixture: GithubFixture = {}): FakeGithub {
  const calls: string[] = []

  const impl: FetchLike = async (input) => {
    calls.push(input)

    const status = fixture.status?.[input]
    if (status !== undefined) return new Response('no', { status })

    const redirect = fixture.redirect?.[input]
    if (redirect !== undefined) {
      return new Response(null, { status: 302, headers: { location: redirect } })
    }

    const url = new URL(input)

    if (url.host === GITHUB_API_HOST && url.pathname.includes('/git/trees/')) {
      return Response.json({
        truncated: fixture.truncated ?? false,
        tree: (fixture.tree ?? []).map((entry) => ({
          path: entry.path,
          type: entry.type ?? 'blob',
          ...(entry.size === undefined ? {} : { size: entry.size }),
        })),
      })
    }

    if (url.host === GITHUB_API_HOST && /^\/repos\/[^/]+\/[^/]+$/.test(url.pathname)) {
      return Response.json({ default_branch: fixture.branch ?? 'main' })
    }

    if (url.host === GITHUB_RAW_HOST) {
      // `/usuario/repo/referencia/ruta…`: los cuatro primeros segmentos son el
      // sobre, y lo que queda es la ruta dentro del repositorio.
      const path = url.pathname
        .split('/')
        .slice(4)
        .map((segment) => decodeURIComponent(segment))
        .join('/')
      const text = fixture.blobs?.[path]

      return text === undefined ? new Response('no', { status: 404 }) : new Response(text)
    }

    return new Response('no', { status: 404 })
  }

  return { impl, calls }
}
