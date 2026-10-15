/**
 * Las rutas de AniList, contra la aplicación montada.
 *
 * Ninguna prueba sale a la red: el `fetch` de AniList y el de las imágenes se
 * inyectan, y el resolutor devuelve una IP pública. Lo que se mide es lo que la
 * interfaz va a recibir: las piezas con su referencia local cuando la base conoce
 * la obra, el enriquecimiento de una ficha, el lote del motor y las imágenes por
 * referencia —con su 404 y su 304—.
 */

import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations, type StoreConnection } from '@nn-anime/catalog-store'
import type { AiringResponse, DiscoverResponse, EnrichmentResponse } from '@nn-anime/core'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { type FakeAniList, fakeAniList, type RawMediaFixture } from '../__fixtures__/anilist'
import { createApp, createContainer } from '../index'

const PORT = 7719
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }
const REF = 'aurora-nocturna'

const KIMETSU: RawMediaFixture = {
  id: 101922,
  romaji: 'Kimetsu no Yaiba',
  english: 'Demon Slayer',
  year: 2019,
  format: 'TV',
  score: 84,
  banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/101922.jpg',
}

/** La obra local del fixture, tal y como la devuelve su detalle. */
const AURORA: RawMediaFixture = {
  id: 555,
  romaji: 'Aurora Nocturna',
  year: 2019,
  format: 'TV',
  score: 77,
  genres: ['Misterio', 'Fantasía'],
  studios: ['Estudio Cobre'],
  description: 'Una cartógrafa <b>recorre</b> el cielo de su ciudad.',
}

interface Contexto {
  readonly pedir: (ruta: string, init?: RequestInit) => Promise<Response>
  readonly fake: FakeAniList
  readonly db: StoreConnection
}

async function conApp<T>(
  fixture: Parameters<typeof fakeAniList>[0],
  body: (contexto: Contexto) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-anilist-rutas-'))
  const db = openDb(join(dir, 'nn-anime.db'))
  runMigrations(db)

  const fake = fakeAniList(fixture)
  const container = createContainer({ db })
  const proveedor = createFixtureProvider()

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
      anilistFetchImpl: fake.impl,
      anilistResolver: async () => ['140.82.121.3'],
      anilistClock: () => 1_700_000_000_000,
    })

    // La ficha local se cachea abriéndola, que es como la conoce la aplicación.
    await servidor.request(`${BASE}/api/anime/fixture/${REF}`, { headers: GOOD })

    return await body({
      pedir: async (ruta, init) =>
        await Promise.resolve(servidor.request(`${BASE}${ruta}`, init ?? { headers: GOOD })),
      fake,
      db,
    })
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

describe('el descubrimiento', () => {
  test('el top llega con la referencia local cuando la base conoce la obra', async () => {
    await conApp({ top: [KIMETSU, AURORA] }, async ({ pedir }) => {
      const respuesta = await pedir('/api/discover/top?media=anime')
      expect(respuesta.status).toBe(200)

      const cuerpo = (await respuesta.json()) as DiscoverResponse
      expect(cuerpo.items.map((item) => item.anilistId)).toEqual([101922, 555])
      expect(cuerpo.items[0]?.cover).toBe('/api/anilist/image/cover/101922')
      expect(cuerpo.items[0]?.kind).toBe('tv')
      // La de Aurora está en la base —su ficha se abrió—; la de Kimetsu no.
      expect(cuerpo.items[1]?.ref).toEqual({ providerId: 'fixture', value: REF })
      expect(cuerpo.items[0]?.ref).toBeUndefined()
    })
  })

  test('la segunda lectura no vuelve a salir a AniList', async () => {
    await conApp({ top: [KIMETSU] }, async ({ pedir, fake }) => {
      await pedir('/api/discover/top?media=anime')
      const antes = fake.calls.length

      await pedir('/api/discover/top?media=anime')

      expect(fake.calls.length).toBe(antes)
    })
  })

  test('sin `media` se responde la mitad con la que abre la aplicación', async () => {
    await conApp({ top: [KIMETSU] }, async ({ pedir, fake }) => {
      const respuesta = await pedir('/api/discover/top')

      expect(respuesta.status).toBe(200)
      expect(fake.calls[0]?.variables.formatos).toEqual(['TV', 'TV_SHORT', 'SPECIAL', 'OVA', 'ONA'])
    })
  })

  test('con `both` se dice que no: el descubrimiento está partido en dos', async () => {
    await conApp({}, async ({ pedir, fake }) => {
      const respuesta = await pedir('/api/discover/top?media=both')

      expect(respuesta.status).toBe(400)
      expect(fake.calls).toHaveLength(0)
    })
  })

  test('la obra que AniList marca para adultos viaja marcada, en el top y en la parrilla', async () => {
    const marcada: RawMediaFixture = { ...KIMETSU, id: 999, isAdult: true }

    await conApp(
      {
        top: [KIMETSU, marcada],
        airing: [{ media: marcada, episode: 1, airingAt: 1_760_000_000 }],
      },
      async ({ pedir }) => {
        const top = (await (
          await pedir('/api/discover/top?media=anime')
        ).json()) as DiscoverResponse
        expect(top.items.map((item) => item.adult)).toEqual([false, true])

        const parrilla = (await (
          await pedir('/api/discover/airing?media=anime&days=3')
        ).json()) as AiringResponse
        expect(parrilla.items[0]?.adult).toBe(true)
      },
    )
  })

  test('la parrilla anuncia los capítulos de los próximos días', async () => {
    await conApp(
      { airing: [{ media: AURORA, episode: 8, airingAt: 1_760_000_000 }] },
      async ({ pedir }) => {
        const respuesta = await pedir('/api/discover/airing?media=anime&days=3')
        expect(respuesta.status).toBe(200)

        const cuerpo = (await respuesta.json()) as AiringResponse
        expect(cuerpo.items).toHaveLength(1)
        expect(cuerpo.items[0]?.episode).toBe(8)
        expect(cuerpo.items[0]?.airingAt).toBe(new Date(1_760_000_000 * 1000).toISOString())
        expect(cuerpo.items[0]?.ref).toEqual({ providerId: 'fixture', value: REF })
      },
    )
  })
})

describe('el enriquecimiento de una ficha', () => {
  test('sin proveedor no hay ficha, y sin ficha no hay enriquecimiento', async () => {
    await conApp({}, async ({ pedir }) => {
      const ajeno = await pedir('/api/anime/desconocido/x/enrichment')
      expect(ajeno.status).toBe(404)

      const vacio = await pedir('/api/anime/fixture/nadie-abrio-esta/enrichment')
      expect(vacio.status).toBe(200)

      const cuerpo = (await vacio.json()) as EnrichmentResponse
      expect(cuerpo.enrichment).toBeNull()
    })
  })

  test('la sinopsis llega sin etiquetas, con sus géneros y su nota', async () => {
    await conApp({ search: { 'Aurora Nocturna': [AURORA] } }, async ({ pedir }) => {
      const respuesta = await pedir(`/api/anime/fixture/${REF}/enrichment`)
      expect(respuesta.status).toBe(200)

      const cuerpo = (await respuesta.json()) as EnrichmentResponse
      expect(cuerpo.enrichment?.anilistId).toBe(555)
      expect(cuerpo.enrichment?.synopsis).toBe('Una cartógrafa recorre el cielo de su ciudad.')
      expect(cuerpo.enrichment?.genres).toEqual(['Misterio', 'Fantasía'])
      expect(cuerpo.enrichment?.studios).toEqual(['Estudio Cobre'])
      expect(cuerpo.enrichment?.score).toBe(77)
      expect(cuerpo.enrichment?.cover).toBe('/api/anilist/image/cover/555')
      expect(cuerpo.enrichment?.banner).toBe('/api/anilist/image/banner/555')
      expect(cuerpo.enrichment?.siteUrl).toBe('https://anilist.co/anime/555')
    })
  })

  test('la marca de adultos viaja también en el enriquecido de la ficha', async () => {
    await conApp(
      { search: { 'Aurora Nocturna': [{ ...AURORA, isAdult: true }] } },
      async ({ pedir }) => {
        const cuerpo = (await (
          await pedir(`/api/anime/fixture/${REF}/enrichment`)
        ).json()) as EnrichmentResponse

        expect(cuerpo.enrichment?.adult).toBe(true)
      },
    )
  })

  test('el lote del motor empareja lo que ya está en la base y omite lo demás', async () => {
    await conApp({ search: { 'Aurora Nocturna': [AURORA] } }, async ({ pedir }) => {
      const respuesta = await pedir('/api/enrichment', {
        method: 'POST',
        headers: { ...GOOD, 'content-type': 'application/json' },
        body: JSON.stringify({
          refs: [
            { providerId: 'fixture', value: REF },
            { providerId: 'fixture', value: 'no-existe' },
          ],
        }),
      })
      expect(respuesta.status).toBe(200)

      const cuerpo = (await respuesta.json()) as { items: { ref: { value: string } }[] }
      expect(cuerpo.items).toHaveLength(1)
      expect(cuerpo.items[0]?.ref.value).toBe(REF)
    })
  })

  test('un lote mal formado es 400 y no sale a la red', async () => {
    await conApp({}, async ({ pedir, fake }) => {
      const respuesta = await pedir('/api/enrichment', {
        method: 'POST',
        headers: { ...GOOD, 'content-type': 'application/json' },
        body: JSON.stringify({ refs: [] }),
      })

      expect(respuesta.status).toBe(400)
      expect(fake.calls).toHaveLength(0)
    })
  })
})

describe('las imágenes', () => {
  test('se sirven por referencia, con su ETag y su caché larga', async () => {
    await conApp({ top: [KIMETSU] }, async ({ pedir, fake }) => {
      // El top cachea la obra y con ella su portada: la imagen ya se puede pedir.
      await pedir('/api/discover/top?media=anime')

      const primera = await pedir('/api/anilist/image/cover/101922')
      expect(primera.status).toBe(200)
      expect(primera.headers.get('etag')).not.toBeNull()
      expect(primera.headers.get('cache-control')).toContain('max-age=604800')
      expect(fake.images).toHaveLength(1)

      const segunda = await pedir('/api/anilist/image/cover/101922', {
        headers: { ...GOOD, 'if-none-match': primera.headers.get('etag') ?? '' },
      })
      expect(segunda.status).toBe(304)
      // La 304 no vuelve a bajar la imagen.
      expect(fake.images).toHaveLength(1)
    })
  })

  test('una imagen que no está cacheada es 404, no una salida a la red', async () => {
    await conApp({}, async ({ pedir, fake }) => {
      const desconocida = await pedir('/api/anilist/image/cover/999999')
      expect(desconocida.status).toBe(404)

      const tipo = await pedir('/api/anilist/image/lo-que-sea/1')
      expect(tipo.status).toBe(404)

      const id = await pedir('/api/anilist/image/cover/cero')
      expect(id.status).toBe(404)

      expect(fake.images).toHaveLength(0)
    })
  })

  test('una dirección cacheada que no es de su CDN no se sirve', async () => {
    await conApp({}, async ({ pedir, fake, db }) => {
      // Se escribe a mano lo que el catálogo no dejaría entrar: una fila de imagen
      // que apunta a otro host. La ruta de la imagen no puede ser un proxy hacia
      // donde diga una fila.
      db.query('INSERT INTO anilist_image (media_id, kind, url) VALUES (?, ?, ?)').run(
        777,
        'cover',
        'https://ejemplo.invalid/portada.jpg',
      )

      const respuesta = await pedir('/api/anilist/image/cover/777')

      expect(respuesta.status).toBe(404)
      expect(fake.images).toHaveLength(0)
    })
  })
})

describe('los guards siguen delante', () => {
  test('sin sesión, ninguna ruta de AniList contesta', async () => {
    await conApp({ top: [KIMETSU] }, async ({ pedir }) => {
      const sinCookie = await pedir('/api/discover/top?media=anime', { headers: {} })

      expect(sinCookie.status).toBe(401)
    })
  })
})
