import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FetchLike } from '../byte-proxy'
import { downloadFile } from './file'

function cuerpo(...trozos: readonly string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controlador) {
      for (const trozo of trozos) controlador.enqueue(new TextEncoder().encode(trozo))
      controlador.close()
    },
  })
}

function respuesta(
  trozos: readonly string[],
  opciones: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(cuerpo(...trozos), {
    status: opciones.status ?? 200,
    headers: opciones.headers ?? {},
  })
}

async function conDirectorio<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-descarga-'))

  try {
    return await body(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const SENAL = new AbortController().signal

describe('la descarga directa de un archivo', () => {
  test('baja los bytes, informa del progreso y renombra al terminar', async () => {
    await conDirectorio(async (dir) => {
      const filePath = join(dir, 'sub', 'episodio.mp4')
      const progreso: number[] = []
      const peticiones: { url: string; init: RequestInit }[] = []

      const fetchImpl: FetchLike = async (url, init) => {
        peticiones.push({ url, init })
        return respuesta(['abc', 'def'], { headers: { 'content-length': '6' } })
      }

      const resultado = await downloadFile({
        url: 'https://fixture.invalid/episodio.mp4',
        filePath,
        headers: { Referer: 'https://fixture.invalid/titulo' },
        signal: SENAL,
        fetchImpl,
        onProgress: (bytes) => progreso.push(bytes),
      })

      expect(await readFile(filePath, 'utf8')).toBe('abcdef')
      expect(resultado).toEqual({ bytes: 6, totalBytes: 6, path: filePath })
      expect(progreso).toEqual([3, 6])
      // El `.part` no se queda: el archivo final es el único que existe.
      await expect(stat(`${filePath}.part`)).rejects.toThrow()
      // Las cabeceras del upstream viajan a la petición y no al archivo.
      expect(peticiones[0]?.url).toBe('https://fixture.invalid/episodio.mp4')
      expect(new Headers(peticiones[0]?.init.headers).get('Referer')).toBe(
        'https://fixture.invalid/titulo',
      )
    })
  })

  test('reanuda un `.part` con `Range` y suma lo que falta', async () => {
    await conDirectorio(async (dir) => {
      const filePath = join(dir, 'episodio.mp4')
      await writeFile(`${filePath}.part`, 'abc')
      let rango: string | undefined

      const fetchImpl: FetchLike = async (_url, init) => {
        rango = new Headers(init.headers).get('range') ?? undefined
        return respuesta(['def'], {
          status: 206,
          headers: { 'content-range': 'bytes 3-5/6' },
        })
      }

      const resultado = await downloadFile({
        url: 'https://fixture.invalid/episodio.mp4',
        filePath,
        signal: SENAL,
        fetchImpl,
      })

      expect(rango).toBe('bytes=3-')
      expect(await readFile(filePath, 'utf8')).toBe('abcdef')
      expect(resultado.bytes).toBe(6)
    })
  })

  test('si el servidor ignora el rango, el temporal se tira y no se duplica el principio', async () => {
    await conDirectorio(async (dir) => {
      const filePath = join(dir, 'episodio.mp4')
      await writeFile(`${filePath}.part`, 'abc')

      const resultado = await downloadFile({
        url: 'https://fixture.invalid/episodio.mp4',
        filePath,
        signal: SENAL,
        fetchImpl: async () => respuesta(['abcdef'], { status: 200 }),
      })

      expect(await readFile(filePath, 'utf8')).toBe('abcdef')
      expect(resultado.bytes).toBe(6)
    })
  })

  test('un 416 con algo descargado da el temporal por completo', async () => {
    await conDirectorio(async (dir) => {
      const filePath = join(dir, 'episodio.mp4')
      await writeFile(`${filePath}.part`, 'abc')

      const resultado = await downloadFile({
        url: 'https://fixture.invalid/episodio.mp4',
        filePath,
        signal: SENAL,
        fetchImpl: async () => new Response(null, { status: 416 }),
      })

      expect(await readFile(filePath, 'utf8')).toBe('abc')
      expect(resultado.bytes).toBe(3)
    })
  })

  test('un error del servidor no borra lo que ya había', async () => {
    await conDirectorio(async (dir) => {
      const filePath = join(dir, 'episodio.mp4')
      await writeFile(`${filePath}.part`, 'abc')

      await expect(
        downloadFile({
          url: 'https://fixture.invalid/episodio.mp4',
          filePath,
          signal: SENAL,
          fetchImpl: async () => new Response('boom', { status: 500 }),
        }),
      ).rejects.toThrow('500')

      expect(await readFile(`${filePath}.part`, 'utf8')).toBe('abc')
    })
  })

  test('una descarga incompleta se denuncia y deja el temporal para reintentar', async () => {
    await conDirectorio(async (dir) => {
      const filePath = join(dir, 'episodio.mp4')

      await expect(
        downloadFile({
          url: 'https://fixture.invalid/episodio.mp4',
          filePath,
          signal: SENAL,
          fetchImpl: async () =>
            respuesta(['abc'], { headers: { 'content-range': 'bytes 0-2/10' } }),
        }),
      ).rejects.toThrow('incompleta')

      expect(await readFile(`${filePath}.part`, 'utf8')).toBe('abc')
      await expect(stat(filePath)).rejects.toThrow()
    })
  })

  test('un archivo que pasa del tope se corta sin escribir el trozo', async () => {
    await conDirectorio(async (dir) => {
      const filePath = join(dir, 'episodio.mp4')

      await expect(
        downloadFile({
          url: 'https://fixture.invalid/episodio.mp4',
          filePath,
          signal: SENAL,
          maxBytes: 5,
          fetchImpl: async () => respuesta(['1234567890']),
        }),
      ).rejects.toThrow('tope')

      expect((await stat(`${filePath}.part`).catch(() => undefined))?.size ?? 0).toBe(0)
    })
  })
})
