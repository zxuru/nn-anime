import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FetchLike } from '../byte-proxy'
import { downloadHls } from './hls-download'

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000
baja/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000
alta/index.m3u8
`

const MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-MAP:URI="init.mp4"
#EXTINF:4,
seg0.ts
#EXTINF:4,
seg1.ts
#EXT-X-ENDLIST
`

function servidor(mapa: Readonly<Record<string, string>>): FetchLike {
  return async (url) => {
    const cuerpo = mapa[url]
    if (cuerpo === undefined) return new Response('no está', { status: 404 })

    return new Response(cuerpo, { status: 200 })
  }
}

const BASE = 'https://fixture.invalid/alta/index.m3u8'

function mapaCompleto(media: string = MEDIA): Record<string, string> {
  return {
    'https://fixture.invalid/master.m3u8': MASTER,
    [BASE]: media,
    'https://fixture.invalid/alta/init.mp4': 'INIT',
    'https://fixture.invalid/alta/seg0.ts': 'AAA',
    'https://fixture.invalid/alta/seg1.ts': 'BBB',
  }
}

async function conDirectorio<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-hls-'))

  try {
    return await body(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('la descarga de un HLS', () => {
  test('del master elige la variante de más ancho de banda y baja sus segmentos', async () => {
    await conDirectorio(async (dir) => {
      const resultado = await downloadHls({
        playlistUrl: 'https://fixture.invalid/master.m3u8',
        dir: join(dir, 'episodio'),
        signal: new AbortController().signal,
        fetchImpl: servidor(mapaCompleto()),
      })

      expect(resultado.kind).toBe('segments')
      expect(resultado.segments).toBe(2)
      // 4 del init y 3 + 3 de los dos segmentos.
      expect(resultado.bytes).toBe(10)

      const playlist = await readFile(join(dir, 'episodio', 'index.m3u8'), 'utf8')
      expect(playlist).toContain('URI="init-00000.mp4"')
      expect(playlist).toContain('segmento-00000.ts')
      expect(playlist).toContain('segmento-00001.ts')
      expect(playlist).toContain('#EXT-X-ENDLIST')
      // Ninguna dirección del upstream queda escrita.
      expect(playlist).not.toContain('https://')
    })
  })

  test('con remux deja un MP4 y borra los segmentos', async () => {
    await conDirectorio(async (dir) => {
      const segmentos = join(dir, 'episodio')
      const mp4 = join(dir, 'episodio.mp4')
      let visto = ''

      const resultado = await downloadHls({
        playlistUrl: 'https://fixture.invalid/master.m3u8',
        dir: segmentos,
        mp4Path: mp4,
        signal: new AbortController().signal,
        fetchImpl: servidor(mapaCompleto()),
        remux: async (playlistPath, salida) => {
          visto = await readFile(playlistPath, 'utf8')
          await writeFile(salida, 'MP4')
        },
      })

      expect(resultado).toEqual({ kind: 'hls', path: mp4, segments: 2, bytes: 10 })
      expect(await readFile(mp4, 'utf8')).toBe('MP4')
      expect(visto).toContain('segmento-00000.ts')
      // El andamio no se queda: el usuario quería un archivo.
      await expect(stat(segmentos)).rejects.toThrow()
    })
  })

  test('si el remux falla, los segmentos se quedan para reintentar', async () => {
    await conDirectorio(async (dir) => {
      const segmentos = join(dir, 'episodio')

      await expect(
        downloadHls({
          playlistUrl: 'https://fixture.invalid/master.m3u8',
          dir: segmentos,
          signal: new AbortController().signal,
          fetchImpl: servidor(mapaCompleto()),
          remux: async () => {
            throw new Error('ffmpeg no está')
          },
        }),
      ).rejects.toThrow('ffmpeg no está')

      expect(await readFile(join(segmentos, 'index.m3u8'), 'utf8')).toContain('segmento-00000.ts')
    })
  })

  test('un HLS cifrado se rechaza con el motivo y no baja ningún segmento', async () => {
    await conDirectorio(async (dir) => {
      const cifrado = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="clave"
#EXTINF:4,
seg0.ts
#EXT-X-ENDLIST
`
      let peticiones = 0
      const base = servidor(mapaCompleto(cifrado))

      await expect(
        downloadHls({
          playlistUrl: 'https://fixture.invalid/master.m3u8',
          dir: join(dir, 'episodio'),
          signal: new AbortController().signal,
          fetchImpl: async (url, init) => {
            peticiones += 1
            return await base(url, init)
          },
        }),
      ).rejects.toThrow('cifrado')

      // Master + variante, y ningún segmento.
      expect(peticiones).toBe(2)
    })
  })

  test('un master sin variantes se rechaza', async () => {
    await conDirectorio(async (dir) => {
      await expect(
        downloadHls({
          playlistUrl: 'https://fixture.invalid/master.m3u8',
          dir: join(dir, 'episodio'),
          signal: new AbortController().signal,
          fetchImpl: servidor({
            'https://fixture.invalid/master.m3u8': '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n',
          }),
        }),
      ).rejects.toThrow('variante')
    })
  })
})

/**
 * Las dos mitades de un progreso que dice la verdad: mientras baja, el total es
 * una proyección por duración; al terminar, es lo que quedó en disco.
 */
const DESIGUAL = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-MAP:URI="init.mp4"
#EXTINF:4,
corto.ts
#EXTINF:4,
largo.ts
#EXT-X-ENDLIST
`

describe('el progreso de un HLS', () => {
  test('estima el total con la duración y lo cierra con los bytes reales', async () => {
    await conDirectorio(async (dir) => {
      const avisos: { bytes: number; total: number | undefined }[] = []

      const resultado = await downloadHls({
        playlistUrl: 'https://fixture.invalid/desigual.m3u8',
        dir: join(dir, 'episodio'),
        signal: new AbortController().signal,
        fetchImpl: servidor({
          'https://fixture.invalid/desigual.m3u8': DESIGUAL,
          'https://fixture.invalid/init.mp4': 'INIT',
          'https://fixture.invalid/corto.ts': 'AA',
          'https://fixture.invalid/largo.ts': 'BBBBBB',
        }),
        onProgress: (bytes, totalBytes) => avisos.push({ bytes, total: totalBytes }),
      })

      // A mitad de duración pesó 2 de los 6 bytes de segmentos: la proyección
      // —4 del init más 2 por cada mitad— da 8, que no es lo bajado.
      expect(avisos.some((aviso) => aviso.bytes === 6 && aviso.total === 8)).toBe(true)
      // Al terminar ya no hay proyección: el total es el archivo real.
      expect(resultado.bytes).toBe(12)
      expect(avisos.at(-1)).toEqual({ bytes: 12, total: 12 })
    })
  })

  test('sin duraciones no inventa un total', async () => {
    await conDirectorio(async (dir) => {
      const avisos: (number | undefined)[] = []

      await downloadHls({
        playlistUrl: 'https://fixture.invalid/muda.m3u8',
        dir: join(dir, 'episodio'),
        signal: new AbortController().signal,
        fetchImpl: servidor({
          'https://fixture.invalid/muda.m3u8': '#EXTM3U\nuno.ts\ndos.ts\n#EXT-X-ENDLIST\n',
          'https://fixture.invalid/uno.ts': 'AAA',
          'https://fixture.invalid/dos.ts': 'BBB',
        }),
        onProgress: (_bytes, totalBytes) => avisos.push(totalBytes),
      })

      expect(avisos.length).toBeGreaterThan(0)
      expect(avisos.every((total) => total === undefined)).toBe(true)
    })
  })
})
