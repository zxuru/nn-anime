import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type CatalogStore, openDb, runMigrations } from '@nn-anime/catalog-store'
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
  opciones: { readonly download?: boolean } = {},
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

  test('una fuente sin `download` no se puede descargar', async () => {
    await conApp(
      async (pedir) => {
        const alta = await pedir('/api/downloads', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(ALTA),
        })
        expect(alta.status).toBe(400)
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
})
