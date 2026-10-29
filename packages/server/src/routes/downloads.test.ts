import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type CatalogStore, openDb, runMigrations } from '@nn-anime/catalog-store'
import type { RemuxFn } from '@nn-anime/media-proxy'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { createApp, createContainer } from '../index'

const PORT = 7733
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }
const JSON_HEADERS = { ...GOOD, 'content-type': 'application/json' }

const ALTA = {
  providerId: 'fixture',
  animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
  episodeRef: { providerId: 'fixture', value: 'aurora-nocturna#1' },
}

async function esperar(condicion: () => Promise<boolean>, ms = 5_000): Promise<void> {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    if (await condicion()) return
    await new Promise((resolver) => setTimeout(resolver, 20))
  }
  throw new Error('la condición no se cumplió a tiempo')
}

async function conApp<T>(
  body: (
    pedir: (ruta: string, init?: RequestInit) => Promise<Response>,
    store: CatalogStore,
    dir: string,
  ) => Promise<T>,
  opciones: { readonly download?: boolean; readonly remux?: RemuxFn } = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-rutas-descargas-'))
  const db = openDb(join(dir, 'nn-anime.db'))
  runMigrations(db)
  const container = createContainer({ db })
  const proveedor = createFixtureProvider({ download: opciones.download ?? true })

  try {
    const servidor = createApp({
      port: PORT,
      session: {
        cookieName: SESSION_COOKIE,
        value: SESSION_VALUE,
        matches: (candidate) => candidate === SESSION_VALUE,
      },
      bootToken: 'token',
      version: '0.1.0',
      plugins: { active: [{ provider: proveedor, file: '/plugins/fixture.ts' }], rejected: [] },
      container,
      downloadsDir: join(dir, 'downloads'),
      downloadConcurrency: 1,
      downloadFetchImpl: async () => new Response('MP4'),
      ...(opciones.remux === undefined ? {} : { downloadRemux: opciones.remux }),
      streamFetchImpl: async () => new Response('MP4'),
      streamResolver: async () => ['93.184.216.34'],
    })

    return await body(
      async (ruta, init) =>
        await Promise.resolve(servidor.request(`${BASE}${ruta}`, init ?? { headers: GOOD })),
      container.store,
      dir,
    )
  } finally {
    await container.close().catch(() => {})
    db.close()
    await rm(dir, { recursive: true, force: true })
  }
}

describe('las rutas de descargas', () => {
  test('el alta crea la fila, la cola la completa y el archivo se sirve con rangos', async () => {
    await conApp(async (pedir) => {
      const alta = await pedir('/api/downloads', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(ALTA),
      })
      expect(alta.status).toBe(201)
      const { id } = (await alta.json()) as { id: number }

      await esperar(async () => {
        const lista = await pedir('/api/downloads')
        const cuerpo = (await lista.json()) as { items: { id: number; status: string }[] }
        return cuerpo.items.find((item) => item.id === id)?.status === 'complete'
      })

      const lista = await pedir('/api/downloads')
      const cuerpo = (await lista.json()) as {
        items: { id: number; status: string; bytes: number; kind: string }[]
      }
      const fila = cuerpo.items.find((item) => item.id === id)
      expect(fila?.status).toBe('complete')
      expect(fila?.bytes).toBe(3)
      expect(fila?.kind).toBe('file')

      const archivo = await pedir(`/api/downloads/${id}/file`, {
        headers: { ...GOOD, range: 'bytes=0-1' },
      })
      expect(archivo.status).toBe(206)
      expect(archivo.headers.get('content-range')).toBe('bytes 0-1/3')
      expect(await archivo.text()).toBe('MP')
    })
  })

  test('una fuente sin `download` descarga igual: lo baja la aplicación', async () => {
    await conApp(
      async (pedir) => {
        const alta = await pedir('/api/downloads', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(ALTA),
        })
        expect(alta.status).toBe(201)
        const { id } = (await alta.json()) as { id: number }

        await esperar(async () => {
          const lista = await pedir('/api/downloads')
          const cuerpo = (await lista.json()) as { items: { id: number; status: string }[] }
          return cuerpo.items.find((item) => item.id === id)?.status === 'complete'
        })

        const archivo = await pedir(`/api/downloads/${id}/file`)
        expect(archivo.status).toBe(200)
        expect(await archivo.text()).toBe('MP4')
      },
      { download: false },
    )
  })

  test('borrar quita la fila', async () => {
    await conApp(async (pedir) => {
      const alta = await pedir('/api/downloads', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(ALTA),
      })
      const { id } = (await alta.json()) as { id: number }

      await esperar(async () => {
        const lista = await pedir('/api/downloads')
        const cuerpo = (await lista.json()) as { items: { id: number; status: string }[] }
        return cuerpo.items.find((item) => item.id === id)?.status === 'complete'
      })

      const borrada = await pedir(`/api/downloads/${id}`, { method: 'DELETE', headers: GOOD })
      expect(borrada.status).toBe(204)

      const lista = await pedir('/api/downloads')
      const cuerpo = (await lista.json()) as { items: { id: number }[] }
      expect(cuerpo.items.some((item) => item.id === id)).toBe(false)
    })
  })

  test('el espacio se informa y las completadas se borran de una vez', async () => {
    await conApp(async (pedir) => {
      const alta = await pedir('/api/downloads', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(ALTA),
      })
      const { id } = (await alta.json()) as { id: number }

      await esperar(async () => {
        const lista = await pedir('/api/downloads')
        const cuerpo = (await lista.json()) as { items: { id: number; status: string }[] }
        return cuerpo.items.find((item) => item.id === id)?.status === 'complete'
      })

      const espacio = await pedir('/api/downloads/space')
      expect(espacio.status).toBe(200)
      const datos = (await espacio.json()) as {
        freeBytes: number
        totalBytes: number
        downloadsBytes: number
      }
      expect(datos.totalBytes).toBeGreaterThan(0)
      expect(datos.freeBytes).toBeGreaterThanOrEqual(0)
      expect(datos.downloadsBytes).toBe(3)

      const limpieza = await pedir('/api/downloads/cleanup', { method: 'POST', headers: GOOD })
      expect(limpieza.status).toBe(200)
      expect(await limpieza.json()).toEqual({ removed: 1 })

      const lista = await pedir('/api/downloads')
      const cuerpo = (await lista.json()) as { items: unknown[] }
      expect(cuerpo.items).toEqual([])
    })
  })

  test('la carpeta de descargas se cambia con una ruta absoluta', async () => {
    await conApp(async (pedir, _store, dir) => {
      const nueva = join(dir, 'otra-carpeta')
      const cambio = await pedir('/api/downloads/dir', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ path: nueva }),
      })
      expect(cambio.status).toBe(200)

      const espacio = await pedir('/api/downloads/space')
      const datos = (await espacio.json()) as { path: string }
      expect(datos.path).toBe(nueva)

      const relativa = await pedir('/api/downloads/dir', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ path: 'carpeta-relativa' }),
      })
      expect(relativa.status).toBe(400)
    })
  })

  test('el listado de carpetas arranca en la raíz de descargas', async () => {
    await conApp(async (pedir, _store, dir) => {
      const raiz = join(dir, 'downloads')
      await mkdir(join(raiz, 'Series'), { recursive: true })
      await writeFile(join(raiz, 'suelto.txt'), 'no soy una carpeta')

      const listado = await pedir('/api/downloads/dirs')
      expect(listado.status).toBe(200)

      const cuerpo = (await listado.json()) as {
        path: string
        parent: string | null
        dirs: { name: string; path: string }[]
      }
      expect(cuerpo.path).toBe(raiz)
      // Sólo carpetas: el archivo suelto no entra en la lista.
      expect(cuerpo.dirs).toEqual([{ name: 'Series', path: join(raiz, 'Series') }])
      expect(cuerpo.parent).toBe(dir)
    })
  })

  test('el listado se navega con ?path= y distingue lo inválido de lo que no existe', async () => {
    await conApp(async (pedir, _store, dir) => {
      const raiz = join(dir, 'downloads')
      const series = join(raiz, 'Series')
      await mkdir(join(series, 'Temporada 1'), { recursive: true })

      const dentro = await pedir(`/api/downloads/dirs?path=${encodeURIComponent(series)}`)
      expect(dentro.status).toBe(200)
      const cuerpo = (await dentro.json()) as { dirs: { name: string; path: string }[] }
      // La carpeta con espacio en el nombre vuelve entera: la ruta viaja codificada.
      expect(cuerpo.dirs).toEqual([{ name: 'Temporada 1', path: join(series, 'Temporada 1') }])

      const relativa = await pedir(`/api/downloads/dirs?path=${encodeURIComponent('carpetas')}`)
      expect(relativa.status).toBe(400)

      const ausente = await pedir(
        `/api/downloads/dirs?path=${encodeURIComponent(join(dir, 'no-existe'))}`,
      )
      expect(ausente.status).toBe(404)
    })
  })

  test('una descarga se lee por su id, y un id que no existe es 404', async () => {
    await conApp(async (pedir, store) => {
      const fila = await store.createDownload({
        providerId: 'fixture',
        providerRef: 'aurora-nocturna',
        episodeRef: 'aurora-nocturna#2',
        title: 'Aurora Nocturna',
        episodeLabel: 'Episodio 2',
        kind: 'file',
      })
      await store.updateDownload(fila.id, { status: 'complete', path: 'aurora.mp4', bytes: 3 })

      const respuesta = await pedir(`/api/downloads/${fila.id}`)
      expect(respuesta.status).toBe(200)
      expect(await respuesta.json()).toEqual(
        expect.objectContaining({
          id: fila.id,
          status: 'complete',
          title: 'Aurora Nocturna',
          bytes: 3,
        }),
      )

      expect((await pedir('/api/downloads/999')).status).toBe(404)
      expect((await pedir('/api/downloads/no-es-un-id')).status).toBe(400)
    })
  })

  test('un id que no existe es 404', async () => {
    await conApp(async (pedir) => {
      expect((await pedir('/api/downloads/999/file')).status).toBe(404)
      expect(
        (await pedir('/api/downloads/999/pause', { method: 'POST', headers: GOOD })).status,
      ).toBe(404)
    })
  })

  test('una descarga de segmentos se sirve como playlist local y sus segmentos', async () => {
    await conApp(async (pedir, store, dir) => {
      const relativa = 'fixture/aurora-nocturna/Episodio-9/index.m3u8'
      const carpeta = join(dir, 'downloads', 'fixture', 'aurora-nocturna', 'Episodio-9')
      await mkdir(carpeta, { recursive: true })
      await writeFile(
        join(carpeta, 'index.m3u8'),
        '#EXTM3U\n#EXTINF:4,\nsegmento-00000.ts\n#EXT-X-ENDLIST\n',
        'utf8',
      )
      await writeFile(join(carpeta, 'segmento-00000.ts'), 'TS')

      const fila = await store.createDownload({
        providerId: 'fixture',
        providerRef: 'aurora-nocturna',
        episodeRef: 'aurora-nocturna#9',
        title: 'Aurora Nocturna',
        episodeLabel: 'Episodio 9',
        kind: 'segments',
      })
      await store.updateDownload(fila.id, {
        status: 'complete',
        path: relativa,
        bytes: 2,
      })

      const playlist = await pedir(`/api/downloads/${fila.id}/file`)
      expect(playlist.status).toBe(200)
      expect(playlist.headers.get('content-type')).toBe('application/vnd.apple.mpegurl')
      const texto = await playlist.text()
      expect(texto).toContain(`/api/downloads/${fila.id}/segment/segmento-00000.ts`)
      expect(texto).not.toContain('\nsegmento-00000.ts')

      const segmento = await pedir(`/api/downloads/${fila.id}/segment/segmento-00000.ts`)
      expect(segmento.status).toBe(200)
      expect(await segmento.text()).toBe('TS')

      // Un nombre que intenta subir no llega al archivo.
      expect((await pedir(`/api/downloads/${fila.id}/segment/../index.m3u8`)).status).toBe(404)
    })
  })

  /**
   * La fila que dice «archivo» y tiene una playlist dentro.
   *
   * Es lo que quedó grabado en las bases anteriores: el alta nace en 'file' y el
   * `update` no escribía el `kind`, así que una descarga sin ffmpeg se servía con
   * `content-type: video/mp4` y el cuerpo del manifiesto, y el reproductor no
   * abría nada. La ruta tiene que mirar el sufijo del archivo, no sólo la
   * columna.
   */
  test('una fila con kind file y una playlist dentro se sirve igual como HLS', async () => {
    await conApp(async (pedir, store, dir) => {
      const relativa = 'fixture/aurora-nocturna/Episodio-10/index.m3u8'
      const carpeta = join(dir, 'downloads', 'fixture', 'aurora-nocturna', 'Episodio-10')
      await mkdir(carpeta, { recursive: true })
      await writeFile(
        join(carpeta, 'index.m3u8'),
        '#EXTM3U\n#EXTINF:4,\nsegmento-00000.ts\n#EXT-X-ENDLIST\n',
        'utf8',
      )
      await writeFile(join(carpeta, 'segmento-00000.ts'), 'TS')

      const fila = await store.createDownload({
        providerId: 'fixture',
        providerRef: 'aurora-nocturna',
        episodeRef: 'aurora-nocturna#10',
        title: 'Aurora Nocturna',
        episodeLabel: 'Episodio 10',
        kind: 'file',
      })
      await store.updateDownload(fila.id, { status: 'complete', path: relativa, bytes: 2 })

      const playlist = await pedir(`/api/downloads/${fila.id}/file`)
      expect(playlist.status).toBe(200)
      expect(playlist.headers.get('content-type')).toBe('application/vnd.apple.mpegurl')
      expect(await playlist.text()).toContain(`/api/downloads/${fila.id}/segment/segmento-00000.ts`)

      // Y sus segmentos se sirven: sin esto la playlist reescrita daría 404.
      const segmento = await pedir(`/api/downloads/${fila.id}/segment/segmento-00000.ts`)
      expect(segmento.status).toBe(200)
      expect(await segmento.text()).toBe('TS')
    })
  })

  /**
   * El botón que arregla una descarga que ya está en disco.
   *
   * Sin red: el doble de remezclador escribe el MP4, como haría ffmpeg. Lo que se
   * mide es la fila —pasa a `file`, con la ruta del MP4— y que la ruta de servido
   * deje de contestar con la playlist.
   */
  test('convertir a MP4 cambia la fila y sirve el archivo como vídeo', async () => {
    const remux: RemuxFn = async (_playlist, salida) => {
      await writeFile(salida, 'MP4-convertido')
    }

    await conApp(
      async (pedir, store, dir) => {
        const relativa = 'fixture/aurora-nocturna/Episodio-11/index.m3u8'
        const carpeta = join(dir, 'downloads', 'fixture', 'aurora-nocturna', 'Episodio-11')
        await mkdir(carpeta, { recursive: true })
        await writeFile(
          join(carpeta, 'index.m3u8'),
          '#EXTM3U\n#EXTINF:4,\nsegmento-00000.ts\n#EXT-X-ENDLIST\n',
          'utf8',
        )
        await writeFile(join(carpeta, 'segmento-00000.ts'), 'TS')

        const fila = await store.createDownload({
          providerId: 'fixture',
          providerRef: 'aurora-nocturna',
          episodeRef: 'aurora-nocturna#11',
          title: 'Aurora Nocturna',
          episodeLabel: 'Episodio 11',
          kind: 'segments',
        })
        await store.updateDownload(fila.id, { status: 'complete', path: relativa, bytes: 2 })

        const conversion = await pedir(`/api/downloads/${fila.id}/remux`, {
          method: 'POST',
          headers: GOOD,
        })
        expect(conversion.status).toBe(200)

        const convertida = (await conversion.json()) as { kind: string; bytes: number }
        expect(convertida.kind).toBe('file')
        expect(convertida.bytes).toBe('MP4-convertido'.length)

        // El MP4 quedó al lado de la carpeta, con su nombre.
        const mp4 = join(dir, 'downloads', 'fixture', 'aurora-nocturna', 'Episodio-11.mp4')
        expect(await Bun.file(mp4).text()).toBe('MP4-convertido')

        // El archivo se sirve como vídeo, ya no como manifiesto.
        const archivo = await pedir(`/api/downloads/${fila.id}/file`)
        expect(archivo.status).toBe(200)
        expect(archivo.headers.get('content-type')).toBe('video/mp4')
        expect(await archivo.text()).toBe('MP4-convertido')

        // Y los segmentos se fueron con la carpeta.
        expect((await pedir(`/api/downloads/${fila.id}/segment/segmento-00000.ts`)).status).toBe(
          404,
        )

        // Convertir lo que ya es un MP4 se rechaza, no se vuelve a convertir.
        const otra = await pedir(`/api/downloads/${fila.id}/remux`, {
          method: 'POST',
          headers: GOOD,
        })
        expect(otra.status).toBe(409)
      },
      { remux },
    )
  })
})
