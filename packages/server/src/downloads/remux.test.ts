import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RemuxFn } from '@nn-anime/media-proxy'
import { mp4DeCarpeta, remuxSegments } from './remux'

/** Una descarga en segmentos de mentira: playlist, un trozo y su carpeta. */
async function conDescarga<T>(
  body: (rutas: { root: string; playlist: string }) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'nn-anime-convertir-'))

  try {
    const carpeta = join(root, 'fixture', 'aurora', 'Episodio-1')
    await mkdir(carpeta, { recursive: true })
    await writeFile(join(carpeta, 'index.m3u8'), '#EXTM3U\n#EXTINF:4,\nsegmento-00000.ts\n')
    await writeFile(join(carpeta, 'segmento-00000.ts'), 'TS')

    return await body({ root, playlist: join(carpeta, 'index.m3u8') })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** El doble de ffmpeg: escribe el MP4 y anota lo que recibió. */
function remuxFalso(visto: { playlist?: string; salida?: string } = {}): RemuxFn {
  return async (playlist, salida) => {
    visto.playlist = playlist
    visto.salida = salida
    await writeFile(salida, 'MP4')
  }
}

describe('convertir una descarga en segmentos a MP4', () => {
  test('el MP4 va al lado de la carpeta, con su nombre, y los segmentos se van', async () => {
    await conDescarga(async ({ root, playlist }) => {
      const resultado = await remuxSegments({
        root,
        playlist,
        remux: remuxFalso(),
        signal: new AbortController().signal,
      })

      expect(resultado.path).toBe(mp4DeCarpeta(playlist))
      expect(resultado.path.endsWith('Episodio-1.mp4')).toBe(true)
      expect(resultado.relPath).toBe(join('fixture', 'aurora', 'Episodio-1.mp4'))
      expect(resultado.bytes).toBe(3)
      expect(await readFile(resultado.path, 'utf8')).toBe('MP4')

      // La carpeta con la playlist y el segmento ya no está: eran el andamio.
      await expect(
        readFile(join(root, 'fixture', 'aurora', 'Episodio-1', 'index.m3u8')),
      ).rejects.toThrow()
    })
  })

  test('el remezclador recibe la playlist local y el MP4 de destino', async () => {
    await conDescarga(async ({ root, playlist }) => {
      const visto: { playlist?: string; salida?: string } = {}
      await remuxSegments({
        root,
        playlist,
        remux: remuxFalso(visto),
        signal: new AbortController().signal,
      })

      expect(visto.playlist).toBe(playlist)
      expect(visto.salida).toBe(mp4DeCarpeta(playlist))
    })
  })

  test('si el remux falla, los segmentos se quedan para reintentar', async () => {
    await conDescarga(async ({ root, playlist }) => {
      await expect(
        remuxSegments({
          root,
          playlist,
          remux: async () => {
            throw new Error('ffmpeg falló (1): ruido')
          },
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow('ffmpeg falló')

      // Lo descargado sigue ahí: convertirlo otra vez es barato, bajarlo no.
      expect(await readFile(playlist, 'utf8')).toContain('segmento-00000.ts')
    })
  })

  test('sin remezclador ni ffmpeg se dice, no se finge el archivo', async () => {
    await conDescarga(async ({ root, playlist }) => {
      await expect(
        remuxSegments({ root, playlist, signal: new AbortController().signal }),
      ).rejects.toThrow('no hay ffmpeg')

      expect(await readFile(playlist, 'utf8')).toContain('segmento-00000.ts')
    })
  })
})
