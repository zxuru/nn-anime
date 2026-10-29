import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DownloadPatch, DownloadRecord, DownloadStatus } from '@nn-anime/catalog-store'
import type { FetchLike } from '@nn-anime/media-proxy'
import { createDownloadQueue, type DownloadStorePort } from './queue'

function fila(id: number, status: DownloadStatus = 'queued'): DownloadRecord {
  return {
    id,
    providerId: 'fixture',
    providerRef: 'aurora-nocturna',
    episodeRef: `aurora-nocturna#${id}`,
    title: 'Aurora Nocturna',
    episodeLabel: `Episodio ${id}`,
    kind: 'file',
    status,
    bytes: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }
}

function memoria(iniciales: readonly DownloadRecord[]): DownloadStorePort & {
  readonly filas: Map<number, DownloadRecord>
  readonly updates: DownloadPatch[]
} {
  const filas = new Map(iniciales.map((item) => [item.id, { ...item }]))
  const updates: DownloadPatch[] = []

  return {
    filas,
    updates,
    async get(id) {
      return filas.get(id)
    },
    async list(limit = 100) {
      return [...filas.values()].slice(0, limit)
    },
    async update(id, patch) {
      updates.push(patch)
      const actual = filas.get(id)
      if (actual === undefined) return undefined
      const siguiente: DownloadRecord = {
        ...actual,
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.kind === undefined ? {} : { kind: patch.kind }),
        ...(patch.path === undefined ? {} : { path: patch.path }),
        ...(patch.bytes === undefined ? {} : { bytes: patch.bytes }),
        ...(patch.totalBytes === undefined ? {} : { totalBytes: patch.totalBytes }),
        ...(patch.error === undefined
          ? {}
          : patch.error === null
            ? { error: undefined }
            : { error: patch.error }),
      }
      filas.set(id, siguiente)
      return siguiente
    },
    async remove(id) {
      const actual = filas.get(id)
      if (actual === undefined) return undefined
      filas.delete(id)
      return actual
    },
    async requeueInterrupted() {
      let cuantas = 0
      for (const [id, actual] of filas) {
        if (actual.status !== 'downloading') continue
        filas.set(id, { ...actual, status: 'queued' })
        cuantas += 1
      }
      return cuantas
    },
  }
}

const FETCH: FetchLike = async (url) =>
  url.endsWith('.mp4') ? new Response('MP4') : new Response('no', { status: 404 })

/** Un HLS mínimo: playlist maestra que apunta a una de segmentos con uno solo. */
const HLS_FETCH: FetchLike = async (url) => {
  if (url.endsWith('/master.m3u8')) {
    return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmedia.m3u8\n')
  }
  if (url.endsWith('/media.m3u8')) {
    return new Response('#EXTM3U\n#EXTINF:4,\nsegmento.ts\n#EXT-X-ENDLIST\n')
  }
  if (url.endsWith('/segmento.ts')) return new Response('TS')

  return new Response('no', { status: 404 })
}

async function esperar(condicion: () => Promise<boolean>, ms = 5_000): Promise<void> {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    if (await condicion()) return
    await new Promise((resolver) => setTimeout(resolver, 20))
  }
  throw new Error('la condición no se cumplió a tiempo')
}

async function conRaiz<T>(body: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'nn-anime-cola-'))

  try {
    return await body(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('la cola de descargas', () => {
  test('procesa una fila en cola y la deja completa con su archivo', async () => {
    await conRaiz(async (root) => {
      const store = memoria([fila(1)])
      const cola = createDownloadQueue({
        store,
        root,
        concurrency: 1,
        fetchImpl: FETCH,
        resolve: async () => ({ url: 'https://fixture.invalid/v.mp4', kind: 'file' }),
      })

      await cola.start()
      await esperar(async () => (await store.get(1))?.status === 'complete')

      const final = await store.get(1)
      expect(final?.status).toBe('complete')
      expect(final?.bytes).toBe(3)
      expect(final?.path ?? '').not.toContain('..')
      expect(await readFile(join(root, final?.path ?? ''), 'utf8')).toBe('MP4')
    })
  })

  /**
   * El desenlace sin MP4 tiene que llegar a la fila.
   *
   * El motor devuelve `kind: 'segments'` cuando no hubo remux, y hasta ahora ese
   * dato se perdía en el `update`: la fila decía «file» con una playlist dentro.
   * `remux: null` fija el caso —no depende de que la máquina tenga ffmpeg— y la
   * fila tiene que decir lo mismo que el disco.
   */
  test('un HLS sin ffmpeg se guarda como segmentos, no como archivo', async () => {
    await conRaiz(async (root) => {
      const store = memoria([fila(1)])
      const cola = createDownloadQueue({
        store,
        root,
        concurrency: 1,
        fetchImpl: HLS_FETCH,
        remux: null,
        resolve: async () => ({ url: 'https://fixture.invalid/v/master.m3u8', kind: 'hls' }),
      })

      await cola.start()
      await esperar(async () => (await store.get(1))?.status === 'complete')

      const final = await store.get(1)
      expect(final?.kind).toBe('segments')
      expect(final?.path ?? '').toEndWith('index.m3u8')
      // Los segmentos están en disco: la playlist y el trozo que nombra.
      expect(await readFile(join(root, final?.path ?? ''), 'utf8')).toContain('segmento-00000.ts')
    })
  })

  test('no pasa de la concurrencia configurada', async () => {
    await conRaiz(async (root) => {
      const store = memoria([fila(1), fila(2)])
      let liberar: (() => void) | undefined
      const bloqueo = new Promise<void>((resolver) => {
        liberar = resolver
      })
      const cola = createDownloadQueue({
        store,
        root,
        concurrency: 2,
        fetchImpl: FETCH,
        resolve: async () => {
          await bloqueo
          return { url: 'https://fixture.invalid/v.mp4', kind: 'file' }
        },
      })

      void cola.start()
      await esperar(async () => cola.active() === 2)
      expect(cola.active()).toBe(2)
      liberar?.()
      await esperar(async () => (await store.get(1))?.status === 'complete')
      await esperar(async () => (await store.get(2))?.status === 'complete')
      expect(cola.active()).toBe(0)
    })
  })

  test('pausar aborta y deja el estado en pausa, no en fallo', async () => {
    await conRaiz(async (root) => {
      const store = memoria([fila(1)])
      let abortada = false
      const cola = createDownloadQueue({
        store,
        root,
        concurrency: 1,
        fetchImpl: FETCH,
        resolve: async (_provider, _ref, signal) =>
          await new Promise((_exito, fallo) => {
            signal.addEventListener('abort', () => {
              abortada = true
              fallo(new Error('abortada'))
            })
          }),
      })

      void cola.start()
      await esperar(async () => (await store.get(1))?.status === 'downloading')
      await cola.pause(1)

      expect(abortada).toBe(true)
      expect((await store.get(1))?.status).toBe('paused')
    })
  })

  test('reanudar vuelve a encolarla y la termina', async () => {
    await conRaiz(async (root) => {
      const store = memoria([{ ...fila(1), status: 'paused' }])
      const cola = createDownloadQueue({
        store,
        root,
        concurrency: 1,
        fetchImpl: FETCH,
        resolve: async () => ({ url: 'https://fixture.invalid/v.mp4', kind: 'file' }),
      })

      await cola.resume(1)
      await esperar(async () => (await store.get(1))?.status === 'complete')
      expect((await store.get(1))?.status).toBe('complete')
    })
  })

  test('borrar para la descarga y se lleva archivo y fila', async () => {
    await conRaiz(async (root) => {
      const store = memoria([fila(1)])
      const cola = createDownloadQueue({
        store,
        root,
        concurrency: 1,
        fetchImpl: FETCH,
        resolve: async () => ({ url: 'https://fixture.invalid/v.mp4', kind: 'file' }),
      })

      await cola.start()
      await esperar(async () => (await store.get(1))?.status === 'complete')
      const final = await store.get(1)
      const ruta = join(root, final?.path ?? '')
      await stat(ruta)

      await cola.remove(1)

      expect(await store.get(1)).toBeUndefined()
      await expect(stat(ruta)).rejects.toThrow()
    })
  })

  test('al arrancar devuelve a la cola lo que quedó descargando', async () => {
    await conRaiz(async (root) => {
      await writeFile(join(root, 'nada'), '')
      const store = memoria([fila(1, 'downloading'), fila(2, 'paused')])
      const cola = createDownloadQueue({
        store,
        root,
        concurrency: 1,
        fetchImpl: FETCH,
        resolve: async () => ({ url: 'https://fixture.invalid/v.mp4', kind: 'file' }),
      })

      await cola.start()
      await esperar(async () => (await store.get(1))?.status === 'complete')
      // La pausada no se toca sin que el usuario lo pida.
      expect((await store.get(2))?.status).toBe('paused')
    })
  })

  test('un fallo del proveedor deja la fila fallida con el motivo', async () => {
    await conRaiz(async (root) => {
      const store = memoria([fila(1)])
      const cola = createDownloadQueue({
        store,
        root,
        concurrency: 1,
        resolve: async () => undefined,
      })

      await cola.start()
      await esperar(async () => (await store.get(1))?.status === 'failed')
      expect((await store.get(1))?.error).toContain('ningún stream')
    })
  })
})
