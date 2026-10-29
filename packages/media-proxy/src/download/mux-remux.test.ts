import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MuxSegment } from 'mux.js'
import { createMuxRemux, segmentosDePlaylist, type TransmuxerLike } from './mux-remux'

/**
 * El doble del transmuxer.
 *
 * `mux.js` de verdad vive fuera de esta prueba: lo que se mide aquí es el
 * pegamento —orden de lectura, cabecera delante, archivo a medias borrado— y no
 * la corrección de un decodificador de TS, que es de la biblioteca.
 */
function transmuxerFalso(
  visto: { pusheados: string[] },
  opciones: { readonly cabecera?: boolean } = {},
): TransmuxerLike {
  const manejadores: ((segmento: MuxSegment) => void)[] = []

  return {
    on(_evento, manejador) {
      manejadores.push(manejador)
    },
    push(trozo) {
      visto.pusheados.push(new TextDecoder().decode(trozo))
      const cabecera = new TextEncoder().encode('CAB')
      const datos = new TextEncoder().encode(`F${visto.pusheados.length}`)

      for (const manejador of manejadores) {
        manejador({
          data: datos,
          type: 'combined',
          ...(opciones.cabecera === false ? {} : { initSegment: cabecera }),
        })
      }
    },
    flush() {},
  }
}

async function conDescarga<T>(
  body: (rutas: { playlist: string; salida: string }) => Promise<T>,
  segmentos: readonly string[] = ['segmento-00000.ts', 'segmento-00001.ts'],
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'nn-anime-mux-'))

  try {
    const carpeta = join(root, 'Episodio-1')
    await mkdir(carpeta, { recursive: true })

    const lineas = ['#EXTM3U', '#EXT-X-VERSION:3']
    for (const [indice, nombre] of segmentos.entries()) {
      lineas.push('#EXTINF:4.0,', nombre)
      await writeFile(join(carpeta, nombre), `TS${indice}`)
    }
    lineas.push('#EXT-X-ENDLIST')
    await writeFile(join(carpeta, 'index.m3u8'), `${lineas.join('\n')}\n`)

    return await body({
      playlist: join(carpeta, 'index.m3u8'),
      salida: join(root, 'Episodio-1.mp4'),
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const senal = (): AbortSignal => new AbortController().signal

describe('los segmentos de una playlist local', () => {
  test('se leen en orden y se saltan las etiquetas', () => {
    const texto = '#EXTM3U\n#EXTINF:4,\na.ts\n\n#EXT-X-ENDLIST\nb.ts\n'

    expect(segmentosDePlaylist(texto)).toEqual(['a.ts', 'b.ts'])
  })
})

describe('la conversión con mux.js', () => {
  test('escribe la cabecera una vez y delante de los fragmentos', async () => {
    await conDescarga(async ({ playlist, salida }) => {
      const visto = { pusheados: [] as string[] }

      await createMuxRemux({ createTransmuxer: () => transmuxerFalso(visto) })(
        playlist,
        salida,
        senal(),
      )

      expect(await readFile(salida, 'utf8')).toBe('CABF1F2')
    })
  })

  test('lee los segmentos que nombra la playlist, en su orden', async () => {
    await conDescarga(async ({ playlist, salida }) => {
      const visto = { pusheados: [] as string[] }

      await createMuxRemux({ createTransmuxer: () => transmuxerFalso(visto) })(
        playlist,
        salida,
        senal(),
      )

      expect(visto.pusheados).toEqual(['TS0', 'TS1'])
    })
  })

  test('sin cabecera no se escribe nada y se dice por qué', async () => {
    await conDescarga(async ({ playlist, salida }) => {
      const visto = { pusheados: [] as string[] }

      await expect(
        createMuxRemux({
          createTransmuxer: () => transmuxerFalso(visto, { cabecera: false }),
        })(playlist, salida, senal()),
      ).rejects.toThrow('no reconoció')

      // Y no queda un archivo vacío con el nombre bueno.
      await expect(stat(salida)).rejects.toThrow()
    })
  })

  test('si falla a mitad, el MP4 a medias no se queda', async () => {
    await conDescarga(async ({ playlist, salida }) => {
      let llamadas = 0
      let avisar: ((segmento: MuxSegment) => void) | undefined

      const transmuxer: TransmuxerLike = {
        on(_evento, manejador) {
          avisar = manejador
        },
        push() {
          llamadas += 1
          if (llamadas === 2) throw new Error('flujo roto')

          avisar?.({
            data: new TextEncoder().encode('F'),
            initSegment: new TextEncoder().encode('CAB'),
            type: 'combined',
          })
        },
        flush() {},
      }

      await expect(
        createMuxRemux({ createTransmuxer: () => transmuxer })(playlist, salida, senal()),
      ).rejects.toThrow('flujo roto')

      await expect(stat(salida)).rejects.toThrow()
    })
  })

  test('cancelar antes de empezar no escribe nada', async () => {
    await conDescarga(async ({ playlist, salida }) => {
      const visto = { pusheados: [] as string[] }
      const controlador = new AbortController()
      controlador.abort()

      await expect(
        createMuxRemux({ createTransmuxer: () => transmuxerFalso(visto) })(
          playlist,
          salida,
          controlador.signal,
        ),
      ).rejects.toThrow('canceló')

      expect(visto.pusheados).toEqual([])
      await expect(stat(salida)).rejects.toThrow()
    })
  })

  test('un segmento que no es TS se rechaza con el nombre dentro', async () => {
    await conDescarga(
      async ({ playlist, salida }) => {
        await expect(
          createMuxRemux({ createTransmuxer: () => transmuxerFalso({ pusheados: [] }) })(
            playlist,
            salida,
            senal(),
          ),
        ).rejects.toThrow(/segmento-00000\.m4s no es MPEG-TS/)
      },
      ['segmento-00000.m4s'],
    )
  })
})
