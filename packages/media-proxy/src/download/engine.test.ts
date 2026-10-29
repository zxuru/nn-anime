import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { FetchLike } from '../byte-proxy'
import { downloadPaths, downloadTask, insideRoot, MIN_FREE_BYTES, safeSegment } from './engine'

const TAREA = {
  providerId: 'fixture',
  providerRef: 'aurora-nocturna',
  episodeRef: 'aurora-nocturna#1',
  title: 'Aurora Nocturna',
  episodeLabel: 'Episodio 1',
}

const HLS = {
  master: `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=900000
media.m3u8
`,
  media: `#EXTM3U
#EXTINF:4,
a.ts
#EXTINF:4,
b.ts
#EXT-X-ENDLIST
`,
}

function servidor(mapa: Readonly<Record<string, string>>): FetchLike {
  return async (url) => {
    const cuerpo = mapa[url]
    return cuerpo === undefined ? new Response('no está', { status: 404 }) : new Response(cuerpo)
  }
}

async function conRaiz<T>(body: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'nn-anime-motor-'))

  try {
    return await body(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('las rutas de una descarga', () => {
  test('sanea cada trozo y no deja salir de la raíz', () => {
    const root = resolve(process.cwd(), '.tmp', 'descargas')
    const otra = resolve(process.cwd(), '.tmp', 'otra', 'cosa.mp4')
    const rutas = downloadPaths(root, {
      ...TAREA,
      title: '../../fuera',
      episodeLabel: 'Episodio 1/2',
    })

    expect(rutas.file.startsWith(root)).toBe(true)
    expect(rutas.dir.startsWith(root)).toBe(true)
    expect(rutas.file).not.toContain('..')
    expect(insideRoot(root, rutas.file)).toBe(true)
    expect(insideRoot(root, otra)).toBe(false)
  })

  test('un nombre sin nada útil cae al respaldo', () => {
    expect(safeSegment('...')).toBe('sin-nombre')
    expect(safeSegment('  ')).toBe('sin-nombre')
    expect(safeSegment('Aurora Nocturna')).toBe('Aurora-Nocturna')
  })
})

describe('la descarga de una tarea', () => {
  test('un `file` se guarda como MP4 dentro de la raíz', async () => {
    await conRaiz(async (root) => {
      const salida = await downloadTask({
        root,
        task: TAREA,
        signal: new AbortController().signal,
        resolve: async () => ({ url: 'https://fixture.invalid/v.mp4', kind: 'file' }),
        fetchImpl: servidor({ 'https://fixture.invalid/v.mp4': 'MP4' }),
      })

      expect(salida.kind).toBe('file')
      expect(salida.path.startsWith(root)).toBe(true)
      expect(salida.relPath).not.toContain('..')
      expect(await readFile(salida.path, 'utf8')).toBe('MP4')
    })
  })

  test('un HLS con remux deja el MP4 y borra los segmentos', async () => {
    await conRaiz(async (root) => {
      const salida = await downloadTask({
        root,
        task: TAREA,
        signal: new AbortController().signal,
        resolve: async () => ({ url: 'https://fixture.invalid/master.m3u8', kind: 'hls' }),
        fetchImpl: servidor({
          'https://fixture.invalid/master.m3u8': HLS.master,
          'https://fixture.invalid/media.m3u8': HLS.media,
          'https://fixture.invalid/a.ts': 'AAAA',
          'https://fixture.invalid/b.ts': 'BBBB',
        }),
        remux: async (playlist, salidaMp4) => {
          expect(await readFile(playlist, 'utf8')).toContain('segmento-00000.ts')
          await Bun.write(salidaMp4, 'MP4')
        },
      })

      expect(salida.kind).toBe('hls')
      expect(await readFile(salida.path, 'utf8')).toBe('MP4')
      const dir = salida.path.replace(/\.mp4$/, '')
      await expect(stat(dir)).rejects.toThrow()
    })
  })

  test('un HLS sin remux devuelve la playlist local', async () => {
    await conRaiz(async (root) => {
      const salida = await downloadTask({
        root,
        task: TAREA,
        signal: new AbortController().signal,
        resolve: async () => ({ url: 'https://fixture.invalid/master.m3u8', kind: 'hls' }),
        fetchImpl: servidor({
          'https://fixture.invalid/master.m3u8': HLS.master,
          'https://fixture.invalid/media.m3u8': HLS.media,
          'https://fixture.invalid/a.ts': 'AAAA',
          'https://fixture.invalid/b.ts': 'BBBB',
        }),
      })

      expect(salida.kind).toBe('segments')
      expect(salida.path.endsWith('index.m3u8')).toBe(true)
      expect(await readFile(salida.path, 'utf8')).toContain('segmento-00001.ts')
    })
  })

  test('un HLS informa el total estimado y lo cierra con los bytes del archivo', async () => {
    await conRaiz(async (root) => {
      const totales: (number | undefined)[] = []

      const salida = await downloadTask({
        root,
        task: TAREA,
        signal: new AbortController().signal,
        resolve: async () => ({ url: 'https://fixture.invalid/master.m3u8', kind: 'hls' }),
        fetchImpl: servidor({
          'https://fixture.invalid/master.m3u8': HLS.master,
          'https://fixture.invalid/media.m3u8': HLS.media,
          'https://fixture.invalid/a.ts': 'AAAA',
          'https://fixture.invalid/b.ts': 'BBBB',
        }),
        onProgress: (_bytes, totalBytes) => totales.push(totalBytes),
      })

      // Mientras baja hay una proyección: sin ella la barra no tendría cifra.
      expect(totales.some((total) => total !== undefined)).toBe(true)
      // Al terminar, el total es el archivo, no la proyección.
      expect(salida.totalBytes).toBe(salida.bytes)
    })
  })

  test('un stream a loopback se corta antes de pedirlo', async () => {
    await conRaiz(async (root) => {
      let pedido = false

      await expect(
        downloadTask({
          root,
          task: TAREA,
          signal: new AbortController().signal,
          resolve: async () => ({ url: 'http://127.0.0.1:8080/v.mp4', kind: 'file' }),
          fetchImpl: async () => {
            pedido = true
            return new Response('no debería')
          },
        }),
      ).rejects.toThrow('destino no permitido')

      expect(pedido).toBe(false)
    })
  })

  test('sin espacio suficiente no se empieza', async () => {
    await conRaiz(async (root) => {
      await expect(
        downloadTask({
          root,
          task: TAREA,
          signal: new AbortController().signal,
          resolve: async () => ({ url: 'https://fixture.invalid/v.mp4', kind: 'file' }),
          freeBytes: async () => MIN_FREE_BYTES - 1,
        }),
      ).rejects.toThrow('espacio')
    })
  })

  test('si el proveedor no da stream, se denuncia sin tocar el disco', async () => {
    await conRaiz(async (root) => {
      await expect(
        downloadTask({
          root,
          task: TAREA,
          signal: new AbortController().signal,
          resolve: async () => undefined,
        }),
      ).rejects.toThrow('no dio ningún stream')
    })
  })
})
