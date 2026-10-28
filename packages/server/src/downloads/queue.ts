/**
 * La cola que mueve las descargas.
 *
 * El motor (`media-proxy`) sabe bajar un archivo; esta pieza sabe **cuándo**
 * hacerlo: cuántas a la vez, cómo se pausa una, qué pasa al reiniciar y cómo se
 * borra lo que dejó. No conoce HTTP ni el contenedor: recibe un puerto de almacén
 * y una función que resuelve el stream, y por eso se puede medir sin montar la
 * aplicación entera.
 *
 * Dos reglas que no son cosméticas:
 *
 * 1. **Al arrancar, lo que quedó «downloading» vuelve a la cola.** Si el proceso
 *    murió a mitad, esa fila no puede quedarse así para siempre.
 * 2. **Una pausa no es un fallo.** Cuando la señal aborta, el estado se queda en
 *    «paused»; el `catch` no lo pisa con «failed».
 */

import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { DownloadPatch, DownloadRecord, DownloadStatus } from '@nn-anime/catalog-store'
import { downloadTask, findFfmpeg, insideRoot, type FetchLike } from '@nn-anime/media-proxy'

/** Lo mínimo del almacén que la cola necesita. */
export interface DownloadStorePort {
  get(id: number): Promise<DownloadRecord | undefined>
  list(limit?: number): Promise<readonly DownloadRecord[]>
  update(id: number, patch: DownloadPatch): Promise<DownloadRecord | undefined>
  remove(id: number): Promise<DownloadRecord | undefined>
  requeueInterrupted(): Promise<number>
}

export interface DownloadQueueStream {
  readonly url: string
  readonly kind: 'file' | 'hls'
  readonly headers?: Readonly<Record<string, string>> | undefined
}

export type ResolveDownload = (
  providerId: string,
  episodeRef: string,
  signal: AbortSignal,
) => Promise<DownloadQueueStream | undefined>

export interface DownloadQueueOptions {
  readonly store: DownloadStorePort
  readonly resolve: ResolveDownload
  readonly root: string
  readonly fetchImpl?: FetchLike | undefined
  readonly ffmpegPath?: string | undefined
  readonly concurrency?: number | undefined
  readonly freeBytes?: (() => Promise<number>) | undefined
  readonly now?: (() => number) | undefined
}

export interface DownloadQueue {
  /** Devuelve a la cola lo interrumpido y empieza a procesar. */
  start(): Promise<void>
  /** Encola una fila ya creada. */
  add(id: number): void
  pause(id: number): Promise<DownloadRecord | undefined>
  resume(id: number): Promise<DownloadRecord | undefined>
  /** Para la descarga y borra archivo y fila. */
  remove(id: number): Promise<DownloadRecord | undefined>
  /** Cuántas hay en vuelo. Para las pruebas y la interfaz. */
  active(): number
  close(): Promise<void>
}

const DEFAULT_CONCURRENCY = 2
const PROGRESS_MS = 500

export function createDownloadQueue(options: DownloadQueueOptions): DownloadQueue {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)
  const now = options.now ?? Date.now
  const ffmpegPath = options.ffmpegPath ?? findFfmpeg()
  const activas = new Map<number, Promise<void>>()
  const pendientes: number[] = []
  const controladores = new Map<number, AbortController>()
  let cerrada = false

  const estaPausadaOCancelada = async (id: number): Promise<boolean> => {
    const fila = await options.store.get(id)

    return fila?.status === 'paused' || fila?.status === 'cancelled'
  }

  async function procesar(id: number): Promise<void> {
    const fila = await options.store.get(id)
    if (fila === undefined || fila.status !== 'queued') return

    const controlador = new AbortController()
    controladores.set(id, controlador)
    const { signal } = controlador

    await options.store.update(id, { status: 'downloading', error: null })

    try {
      const stream = await options.resolve(fila.providerId, fila.episodeRef, signal)
      if (stream === undefined) throw new Error('el proveedor no dio ningún stream')

      let ultimoAviso = 0
      const resultado = await downloadTask({
        root: options.root,
        task: {
          providerId: fila.providerId,
          providerRef: fila.providerRef,
          episodeRef: fila.episodeRef,
          title: fila.title,
          episodeLabel: fila.episodeLabel,
        },
        resolve: async () => stream,
        signal,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        ...(ffmpegPath === undefined ? {} : { ffmpegPath }),
        ...(options.freeBytes === undefined ? {} : { freeBytes: options.freeBytes }),
        onProgress: (bytes, totalBytes) => {
          const instante = now()
          if (instante - ultimoAviso < PROGRESS_MS) return
          ultimoAviso = instante
          void options.store.update(id, {
            bytes,
            ...(totalBytes === undefined ? {} : { totalBytes }),
          })
        },
      })

      await options.store.update(id, {
        status: 'complete',
        path: resultado.relPath,
        bytes: resultado.bytes,
        ...(resultado.totalBytes === undefined ? {} : { totalBytes: resultado.totalBytes }),
        ...(resultado.kind === 'segments' ? { kind: 'segments' as const } : {}),
        error: null,
      })
    } catch (cause) {
      // Pausar o cancelar aborta: eso no es un fallo que haya que pintar.
      if (!(await estaPausadaOCancelada(id))) {
        await options.store.update(id, {
          status: 'failed',
          error: cause instanceof Error ? cause.message : String(cause),
        })
      }
    } finally {
      controladores.delete(id)
    }
  }

  function encolar(id: number): void {
    if (cerrada || activas.has(id) || pendientes.includes(id)) return
    pendientes.push(id)
    void bombear()
  }

  async function bombear(): Promise<void> {
    while (!cerrada && activas.size < concurrency) {
      const id = pendientes.shift()
      if (id === undefined) return
      if (activas.has(id)) continue

      const promesa = procesar(id).finally(() => {
        activas.delete(id)
        void bombear()
      })
      activas.set(id, promesa)
    }
  }

  return {
    async start() {
      await options.store.requeueInterrupted()
      const filas = await options.store.list(500)
      for (const fila of filas) {
        if (fila.status === 'queued') pendientes.push(fila.id)
      }
      await bombear()
    },

    add(id: number) {
      encolar(id)
    },

    async pause(id: number) {
      const fila = await options.store.get(id)
      if (fila === undefined) return undefined
      if (fila.status === 'complete' || fila.status === 'failed') return fila

      controladores.get(id)?.abort()
      return await options.store.update(id, { status: 'paused' as DownloadStatus })
    },

    async resume(id: number) {
      const fila = await options.store.get(id)
      if (fila === undefined) return undefined
      if (fila.status !== 'paused' && fila.status !== 'failed') return fila

      const actualizada = await options.store.update(id, {
        status: 'queued' as DownloadStatus,
        error: null,
      })
      encolar(id)

      return actualizada
    },

    async remove(id: number) {
      const fila = await options.store.get(id)
      if (fila === undefined) return undefined

      controladores.get(id)?.abort()

      if (fila.path !== undefined) {
        const absoluta = resolve(options.root, fila.path)
        if (insideRoot(options.root, absoluta)) {
          if (fila.kind === 'segments') {
            await rm(dirname(absoluta), { recursive: true, force: true })
          } else {
            await rm(absoluta, { force: true })
            await rm(`${absoluta}.part`, { force: true })
          }
        }
      }

      return await options.store.remove(id)
    },

    active() {
      return activas.size
    },

    async close() {
      cerrada = true
      for (const controlador of controladores.values()) controlador.abort()
      await Promise.all([...activas.values()])
    },
  }
}
