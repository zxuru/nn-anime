/**
 * Las rutas de descargas.
 *
 * La cola hace el trabajo; aquí sólo se valida, se persiste el alta y se sirve
 * el archivo. Dos cosas que no se delegan:
 *
 * - **El cliente no decide qué bajar.** Manda una referencia; el servidor
 *   resuelve el stream y comprueba que la fuente declare `capabilities.download`.
 * - **El archivo se sirve por id.** La ruta que se abre sale de la fila, no de la
 *   petición, y se comprueba que esté dentro de la raíz de descargas.
 */

import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type { CatalogStore, DownloadRecord } from '@nn-anime/catalog-store'
import { downloadStartRequestSchema, downloadStartResponseSchema } from '@nn-anime/core'
import { insideRoot } from '@nn-anime/media-proxy'
import type { Provider } from '@nn-anime/provider-sdk'
import type { Context, Hono } from 'hono'
import type { DownloadQueue } from '../downloads/queue'
import { findProvider } from './anime'

export interface DownloadsRouteOptions {
  readonly queue: DownloadQueue
  readonly store: CatalogStore
  readonly providers: readonly Provider[]
  readonly root: string
}

function item(row: DownloadRecord) {
  return {
    id: row.id,
    providerId: row.providerId,
    animeRef: { providerId: row.providerId, value: row.providerRef },
    episodeRef: { providerId: row.providerId, value: row.episodeRef },
    title: row.title,
    episodeLabel: row.episodeLabel,
    kind: row.kind,
    status: row.status,
    bytes: row.bytes,
    ...(row.totalBytes === undefined ? {} : { totalBytes: row.totalBytes }),
    ...(row.error === undefined ? {} : { error: row.error }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function errorJson(c: Context, status: 400 | 404 | 409 | 416, message: string) {
  return c.json({ error: message }, status)
}

/** Un rango `bytes=inicio-fin`, acotado al tamaño. Nada de rangos múltiples. */
export function parseFileRange(
  header: string | undefined,
  size: number,
): { readonly start: number; readonly end: number } | 'invalido' | undefined {
  if (header === undefined) return undefined
  const coincidencia = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (coincidencia === null) return 'invalido'

  const inicioTexto = coincidencia[1] ?? ''
  const finTexto = coincidencia[2] ?? ''
  if (inicioTexto === '' && finTexto === '') return 'invalido'

  if (inicioTexto === '') {
    const sufijo = Number(finTexto)
    if (!Number.isInteger(sufijo) || sufijo <= 0) return 'invalido'
    return { start: Math.max(size - sufijo, 0), end: size - 1 }
  }

  const inicio = Number(inicioTexto)
  const fin = finTexto === '' ? size - 1 : Number(finTexto)
  if (!Number.isInteger(inicio) || !Number.isInteger(fin) || inicio < 0 || fin < inicio) {
    return 'invalido'
  }
  if (inicio >= size) return 'invalido'

  return { start: inicio, end: Math.min(fin, size - 1) }
}

export function registerDownloadsRoute(app: Hono, options: DownloadsRouteOptions): void {
  const store = options.store

  app.post('/api/downloads', async (c) => {
    let crudo: unknown
    try {
      crudo = await c.req.json()
    } catch {
      return c.json({ error: 'el cuerpo no es JSON válido' }, 400)
    }

    const parsed = downloadStartRequestSchema.safeParse(crudo)
    if (!parsed.success) {
      return c.json({ error: `petición inválida: ${parsed.error.message}` }, 400)
    }

    const provider = findProvider(options.providers, parsed.data.providerId)
    if (provider === undefined) return errorJson(c, 404, 'no hay ningún proveedor con ese id')
    if (provider.capabilities.download !== true) {
      return errorJson(c, 400, `la fuente ${provider.id} no declara que se pueda descargar`)
    }

    const detalle = await options.store.readAnime(parsed.data.animeRef)
    const titulo = detalle?.value.title ?? parsed.data.animeRef.value

    const fila = await store.createDownload({
      providerId: provider.id,
      providerRef: parsed.data.animeRef.value,
      episodeRef: parsed.data.episodeRef.value,
      title: titulo,
      episodeLabel: parsed.data.episodeRef.value,
      kind: 'file',
    })

    if (fila.status === 'queued') options.queue.add(fila.id)

    return c.json(downloadStartResponseSchema.parse({ id: fila.id }), 201)
  })

  app.get('/api/downloads', async (c) => {
    const filas = await store.listDownloads(200)

    return c.json({ items: filas.map(item) })
  })

  app.post('/api/downloads/:id/pause', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) return errorJson(c, 400, 'ese identificador no es válido')

    const fila = await options.queue.pause(id)
    if (fila === undefined) return errorJson(c, 404, 'esa descarga no existe')

    return c.body(null, 204)
  })

  app.post('/api/downloads/:id/resume', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) return errorJson(c, 400, 'ese identificador no es válido')

    const fila = await options.queue.resume(id)
    if (fila === undefined) return errorJson(c, 404, 'esa descarga no existe')

    return c.body(null, 204)
  })

  app.delete('/api/downloads/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) return errorJson(c, 400, 'ese identificador no es válido')

    const fila = await options.queue.remove(id)
    if (fila === undefined) return errorJson(c, 404, 'esa descarga no existe')

    return c.body(null, 204)
  })

  app.get('/api/downloads/:id/file', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) return errorJson(c, 400, 'ese identificador no es válido')

    const fila = await store.getDownload(id)
    if (fila === undefined) return errorJson(c, 404, 'esa descarga no existe')
    if (fila.status !== 'complete') return errorJson(c, 409, 'la descarga todavía no está completa')
    if (fila.kind === 'segments') {
      return errorJson(c, 409, 'esta descarga son segmentos y se reproduce desde la aplicación')
    }
    if (fila.path === undefined) return errorJson(c, 409, 'la descarga no tiene archivo')

    const absoluta = resolve(options.root, fila.path)
    if (isAbsolute(fila.path) || !insideRoot(options.root, absoluta)) {
      return errorJson(c, 409, 'la ruta de la descarga no es válida')
    }

    const info = await stat(absoluta).catch(() => undefined)
    if (info === undefined) return errorJson(c, 404, 'el archivo de la descarga no está')

    const rango = parseFileRange(c.req.header('range'), info.size)
    if (rango === 'invalido') {
      c.header('content-range', `bytes */${info.size}`)
      return errorJson(c, 416, 'el rango pedido no cabe en el archivo')
    }

    const inicio = rango?.start ?? 0
    const fin = rango?.end ?? info.size - 1
    const cuerpo = Bun.file(absoluta).slice(inicio, fin + 1)

    c.header('content-type', 'video/mp4')
    c.header('accept-ranges', 'bytes')
    c.header('content-length', String(fin - inicio + 1))
    if (rango !== undefined) c.header('content-range', `bytes ${inicio}-${fin}/${info.size}`)

    return c.body(cuerpo.stream(), rango === undefined ? 200 : 206)
  })
}
