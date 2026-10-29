/**
 * Las rutas de descargas.
 *
 * La cola hace el trabajo; aquí sólo se valida, se persiste el alta y se sirve
 * el archivo. Dos cosas que no se delegan:
 *
 * - **El cliente no decide qué bajar.** Manda una referencia; el servidor
 *   resuelve el stream —el mismo de la reproducción— y lo baja él. La fuente no
 *   autoriza nada: descargar es trabajo del motor, no una capacidad del plugin.
 * - **El archivo se sirve por id.** La ruta que se abre sale de la fila, no de la
 *   petición, y se comprueba que esté dentro de la raíz de descargas.
 */

import { mkdir, stat, statfs } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { CatalogStore, DownloadRecord } from '@nn-anime/catalog-store'
import {
  downloadItemSchema,
  downloadStartRequestSchema,
  downloadStartResponseSchema,
  downloadsDirRequestSchema,
  downloadsDirsSchema,
  downloadsSpaceSchema,
} from '@nn-anime/core'
import { insideRoot } from '@nn-anime/media-proxy'
import type { Provider } from '@nn-anime/provider-sdk'
import type { Context, Hono } from 'hono'
import { listarCarpetas } from '../downloads/dirs'
import type { DownloadQueue } from '../downloads/queue'
import { findProvider } from './anime'

/**
 * ¿Lo que quedó en disco es una playlist local?
 *
 * Manda la ruta, no el `kind`. La fila dice lo que el motor grabó al terminar,
 * pero una base de una versión anterior tiene filas con `kind` 'file' y una
 * playlist dentro —el `update` no escribía la columna— y servirlas como MP4 le
 * daba al reproductor el texto del manifiesto con `video/mp4`. El sufijo delata
 * el caso sin ambigüedad y no depende de que la fila se haya corregido.
 */
function esPlaylist(fila: DownloadRecord): boolean {
  return fila.kind === 'segments' || (fila.path ?? '').toLowerCase().endsWith('.m3u8')
}

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

function errorJson(c: Context, status: 400 | 403 | 404 | 409 | 416, message: string) {
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

  app.get('/api/downloads/space', async (c) => {
    const raiz = options.queue.root()
    await mkdir(raiz, { recursive: true }).catch(() => undefined)
    const espacio = await statfs(raiz).catch(() => undefined)
    const filas = await store.listDownloads(500)
    const ocupado = filas
      .filter((fila) => fila.status === 'complete')
      .reduce((total, fila) => total + fila.bytes, 0)

    return c.json(
      downloadsSpaceSchema.parse({
        path: raiz,
        freeBytes: espacio === undefined ? 0 : espacio.bavail * espacio.bsize,
        totalBytes: espacio === undefined ? 0 : espacio.blocks * espacio.bsize,
        downloadsBytes: ocupado,
      }),
    )
  })

  /**
   * Las carpetas de una ruta, para el selector de destino.
   *
   * Sin `path` se lista la raíz de descargas, que es donde el selector abre. Un
   * 403 y no un 500 cuando la carpeta existe pero no se deja leer: es lo que la
   * pantalla necesita para decir «esa no» sin romper el diálogo.
   */
  app.get('/api/downloads/dirs', async (c) => {
    const pedida = c.req.query('path') ?? options.queue.root()
    const resultado = await listarCarpetas(pedida)

    if (!resultado.ok) {
      const estado =
        resultado.motivo === 'invalida' ? 400 : resultado.motivo === 'sin-permiso' ? 403 : 404

      return errorJson(c, estado, resultado.detalle)
    }

    return c.json(downloadsDirsSchema.parse(resultado.listado))
  })

  /**
   * Una descarga por su id.
   *
   * La pantalla de la biblioteca abre un episodio con su id en la dirección y no
   * con el estado de la lista: recargar o guardar ese enlace tiene que abrir lo
   * mismo. Aquí sólo se dice qué es y en qué punto está; el archivo lo sirve la
   * ruta de siempre.
   */
  app.get('/api/downloads/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) return errorJson(c, 400, 'ese identificador no es válido')

    const fila = await store.getDownload(id)
    if (fila === undefined) return errorJson(c, 404, 'esa descarga no existe')

    return c.json(downloadItemSchema.parse(item(fila)))
  })

  app.patch('/api/downloads/dir', async (c) => {
    let crudo: unknown
    try {
      crudo = await c.req.json()
    } catch {
      return c.json({ error: 'el cuerpo no es JSON válido' }, 400)
    }

    const parsed = downloadsDirRequestSchema.safeParse(crudo)
    if (!parsed.success) return c.json({ error: 'la carpeta no es válida' }, 400)
    const tieneControl = [...parsed.data.path].some((letra) => letra.charCodeAt(0) < 0x20)
    if (!isAbsolute(parsed.data.path) || tieneControl) {
      return c.json({ error: 'la carpeta tiene que ser una ruta absoluta' }, 400)
    }

    try {
      options.queue.setRoot(parsed.data.path)
    } catch (cause) {
      return c.json(
        { error: cause instanceof Error ? cause.message : 'no se pudo cambiar la carpeta' },
        409,
      )
    }

    await mkdir(parsed.data.path, { recursive: true })
    await store.setSetting('downloadsDir', parsed.data.path)

    return c.json(parsed.data)
  })

  app.post('/api/downloads/cleanup', async (c) => {
    const filas = await store.listDownloads(500)
    const completas = filas.filter((fila) => fila.status === 'complete')

    for (const fila of completas) await options.queue.remove(fila.id)

    return c.json({ removed: completas.length })
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
    if (fila.path === undefined) return errorJson(c, 409, 'la descarga no tiene archivo')

    const raiz = options.queue.root()
    const absoluta = resolve(raiz, fila.path)
    if (isAbsolute(fila.path) || !insideRoot(raiz, absoluta)) {
      return errorJson(c, 409, 'la ruta de la descarga no es válida')
    }

    if (esPlaylist(fila)) {
      const playlist = await Bun.file(absoluta)
        .text()
        .catch(() => undefined)
      if (playlist === undefined) return errorJson(c, 404, 'la playlist de la descarga no está')

      // La playlist local nombra sus segmentos; se sirven por su propia ruta para
      // que el reproductor no pueda pedir un archivo que no sea de esta descarga.
      const reescrita = playlist
        .split(/\r?\n/)
        .map((linea) => {
          const limpia = linea.trim()
          if (limpia === '' || limpia.startsWith('#')) return linea

          return `/api/downloads/${id}/segment/${encodeURIComponent(limpia)}`
        })
        .join('\n')

      c.header('content-type', 'application/vnd.apple.mpegurl')
      c.header('cache-control', 'no-store')

      return c.body(`${reescrita}\n`)
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

  app.get('/api/downloads/:id/segment/:name', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) return errorJson(c, 400, 'ese identificador no es válido')

    const fila = await store.getDownload(id)
    if (fila === undefined || fila.path === undefined || !esPlaylist(fila)) {
      return errorJson(c, 404, 'esa descarga no tiene segmentos')
    }

    const nombre = c.req.param('name')
    if (!/^(segmento|init)-\d{5}\.[a-z0-9]{1,5}$/i.test(nombre)) {
      return errorJson(c, 404, 'ese segmento no existe')
    }

    const raiz = options.queue.root()
    const playlist = resolve(raiz, fila.path)
    const segmento = resolve(dirname(playlist), nombre)
    if (dirname(segmento) !== dirname(playlist) || !insideRoot(raiz, segmento)) {
      return errorJson(c, 404, 'ese segmento no existe')
    }

    const archivo = Bun.file(segmento)
    const info = await archivo.stat().catch(() => undefined)
    if (info === undefined || !info.isFile()) return errorJson(c, 404, 'ese segmento no está')

    c.header('content-type', nombre.endsWith('.mp4') ? 'video/mp4' : 'video/mp2t')
    c.header('content-length', String(info.size))

    return c.body(archivo.stream())
  })
}
