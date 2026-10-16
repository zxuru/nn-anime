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
import type {
  AiringResponse,
  AniListRelatedResponse,
  DiscoverResponse,
  EnrichmentResponse,
} from '@nn-anime/core'
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

/**
 * Enciende el contenido para adultos como lo haría la página de ajustes.
 *
 * Por HTTP y no escribiendo en la base: el ajuste entra por donde entra el del
 * usuario, así que la prueba mide también que la ruta lo persiste.
 */
async function encender(pedir: Contexto['pedir']): Promise<void> {
  await pedir('/api/settings', {
    method: 'PATCH',
    headers: { ...GOOD, 'content-type': 'application/json' },
    body: JSON.stringify({ adultContent: true }),
  })
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

  /**
   * El doble devuelve la obra marcada aunque la consulta la excluya, que es lo que
   * haría un tercero que ignorara el filtro **y** lo que pasa de verdad en la parrilla
   * y en lo recién emitido: su consulta cuelga de `airingSchedules` y no puede filtrar.
   * Con el interruptor apagado, la frontera las descarta igual.
   */
  test('apagado, la obra marcada no sale ni en el top, ni en la parrilla, ni en las novedades', async () => {
    const marcada: RawMediaFixture = { ...KIMETSU, id: 999, isAdult: true }
    const cita = { media: marcada, episode: 1, airingAt: 1_760_000_000 }

    await conApp({ top: [KIMETSU, marcada], airing: [cita], recent: [cita] }, async ({ pedir }) => {
      const top = (await (await pedir('/api/discover/top?media=anime')).json()) as DiscoverResponse
      expect(top.items.map((item) => item.anilistId)).toEqual([101922])

      const parrilla = (await (
        await pedir('/api/discover/airing?media=anime&days=3')
      ).json()) as AiringResponse
      expect(parrilla.items).toEqual([])

      const novedades = (await (
        await pedir('/api/discover/recent?media=anime')
      ).json()) as AiringResponse
      expect(novedades.items).toEqual([])
    })
  })

  test('encendido, la obra marcada sale con su marca', async () => {
    const marcada: RawMediaFixture = { ...KIMETSU, id: 999, isAdult: true }
    const cita = { media: marcada, episode: 1, airingAt: 1_760_000_000 }

    await conApp({ top: [KIMETSU, marcada], airing: [cita] }, async ({ pedir }) => {
      await encender(pedir)

      const top = (await (await pedir('/api/discover/top?media=anime')).json()) as DiscoverResponse
      expect(top.items.map((item) => item.adult)).toEqual([false, true])

      const parrilla = (await (
        await pedir('/api/discover/airing?media=anime&days=3')
      ).json()) as AiringResponse
      expect(parrilla.items[0]?.adult).toBe(true)
    })
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

  test('apagado, el enriquecido de una obra marcada no se sirve y deja su marca', async () => {
    await conApp(
      { search: { 'Aurora Nocturna': [{ ...AURORA, isAdult: true }] } },
      async ({ pedir, db }) => {
        const cuerpo = (await (
          await pedir(`/api/anime/fixture/${REF}/enrichment`)
        ).json()) as EnrichmentResponse

        expect(cuerpo.enrichment).toBeNull()

        // La marca es lo que después puede esconder esa obra del feed, de las
        // tendencias y de las filas de la base.
        const filas = db.query('SELECT COUNT(*) AS total FROM adult_ref').get() as { total: number }

        expect(filas.total).toBe(1)
      },
    )
  })

  test('con la marca puesta, la segunda petición no vuelve a preguntar a AniList', async () => {
    await conApp(
      { search: { 'Aurora Nocturna': [{ ...AURORA, isAdult: true }] } },
      async ({ pedir, fake }) => {
        await pedir(`/api/anime/fixture/${REF}/enrichment`)
        const antes = fake.calls.length

        const segunda = (await (
          await pedir(`/api/anime/fixture/${REF}/enrichment`)
        ).json()) as EnrichmentResponse

        expect(segunda.enrichment).toBeNull()
        expect(fake.calls.length).toBe(antes)
      },
    )
  })

  test('encendido, el enriquecido de una obra marcada sí se sirve', async () => {
    await conApp(
      { search: { 'Aurora Nocturna': [{ ...AURORA, isAdult: true }] } },
      async ({ pedir }) => {
        await encender(pedir)

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

describe('los relacionados de AniList', () => {
  /** Lo que AniList declara relacionado con «Aurora Nocturna» (id 555). */
  const RELACIONES = {
    555: [
      // El especial es el más antiguo y sale el último: primero lo que encadena.
      {
        relation: 'SPECIAL',
        media: { id: 558, romaji: 'Aurora Nocturna: Especial', year: 2015, format: 'SPECIAL' },
      },
      // Dos secuelas, y entre ellas manda el año: la de 2021 antes que la de 2024.
      {
        relation: 'SEQUEL',
        media: { id: 557, romaji: 'Aurora Nocturna III', year: 2024, format: 'TV' },
      },
      {
        relation: 'SEQUEL',
        media: { id: 556, romaji: 'Cazador de Sombras', year: 2021, format: 'TV' },
      },
    ],
  } as const

  test('sin proveedor es 404, y sin ficha abierta la lista viene vacía', async () => {
    await conApp({}, async ({ pedir, fake }) => {
      const ajeno = await pedir('/api/anime/desconocido/x/anilist-related')
      expect(ajeno.status).toBe(404)

      const vacio = await pedir('/api/anime/fixture/nadie-abrio-esta/anilist-related')
      expect(vacio.status).toBe(200)
      expect(((await vacio.json()) as AniListRelatedResponse).items).toEqual([])
      // Sin ficha local no hay título que emparejar: no se sale a la red.
      expect(fake.calls).toHaveLength(0)
    })
  })

  test('llegan con su motivo, su portada y el enlace que les toca', async () => {
    await conApp(
      { search: { 'Aurora Nocturna': [AURORA] }, relations: RELACIONES },
      async ({ pedir, fake }) => {
        // La segunda ficha se abre para que la base conozca esa obra.
        await pedir('/api/anime/fixture/cazador-de-sombras')

        const respuesta = await pedir(`/api/anime/fixture/${REF}/anilist-related`)
        expect(respuesta.status).toBe(200)

        const cuerpo = (await respuesta.json()) as AniListRelatedResponse
        // Primero lo que encadena —la secuela, aunque el especial sea más
        // antiguo— y dentro de lo mismo, el año.
        expect(cuerpo.items.map((item) => item.anilistId)).toEqual([556, 557, 558])
        expect(cuerpo.items.map((item) => item.relation)).toEqual(['sequel', 'sequel', 'special'])
        expect(cuerpo.items[0]?.title).toBe('Cazador de Sombras')
        expect(cuerpo.items[0]?.cover).toBe('/api/anilist/image/cover/556')
        expect(cuerpo.items[0]?.kind).toBe('tv')
        // La que está en la base abre su ficha; la que no, la búsqueda de su título.
        expect(cuerpo.items[0]?.ref).toEqual({ providerId: 'fixture', value: 'cazador-de-sombras' })
        expect(cuerpo.items[1]?.ref).toBeUndefined()
        expect(fake.calls.at(-1)?.query).toContain('relationType(version: 2)')
      },
    )
  })

  test('el manga de origen y el crossover no llegan a la ficha', async () => {
    await conApp(
      {
        search: { 'Aurora Nocturna': [AURORA] },
        relations: {
          555: [
            { relation: 'SOURCE', media: { id: 900, romaji: 'Aurora Nocturna', format: 'MANGA' } },
            { relation: 'CHARACTER', media: { id: 901, romaji: 'Corto de gag', format: 'ONA' } },
          ],
        },
      },
      async ({ pedir }) => {
        const respuesta = await pedir(`/api/anime/fixture/${REF}/anilist-related`)

        expect(((await respuesta.json()) as AniListRelatedResponse).items).toEqual([])
      },
    )
  })

  test('sin emparejamiento no se pregunta por las relaciones', async () => {
    await conApp({ relations: RELACIONES }, async ({ pedir, fake }) => {
      const respuesta = await pedir(`/api/anime/fixture/${REF}/anilist-related`)

      expect(respuesta.status).toBe(200)
      expect(((await respuesta.json()) as AniListRelatedResponse).items).toEqual([])
      expect(fake.calls.some((llamada) => llamada.query.includes('relations {'))).toBe(false)
    })
  })

  test('con AniList caído la lista viene vacía y la ficha no falla', async () => {
    const fixture: Parameters<typeof fakeAniList>[0] = {
      search: { 'Aurora Nocturna': [AURORA] },
      relations: RELACIONES,
    }

    await conApp(fixture, async ({ pedir }) => {
      // El enriquecimiento deja el emparejamiento cacheado: lo que se cae aquí es
      // la consulta de relaciones, no la de identidad.
      await pedir(`/api/anime/fixture/${REF}/enrichment`)
      fixture.status = { 'relations {': 500 }

      const respuesta = await pedir(`/api/anime/fixture/${REF}/anilist-related`)
      expect(respuesta.status).toBe(200)
      expect(((await respuesta.json()) as AniListRelatedResponse).items).toEqual([])
    })
  })

  test('la segunda lectura no vuelve a salir a AniList', async () => {
    await conApp(
      { search: { 'Aurora Nocturna': [AURORA] }, relations: RELACIONES },
      async ({ pedir, fake }) => {
        await pedir(`/api/anime/fixture/${REF}/anilist-related`)
        const antes = fake.calls.length

        const segunda = await pedir(`/api/anime/fixture/${REF}/anilist-related`)

        expect(fake.calls).toHaveLength(antes)
        expect(((await segunda.json()) as AniListRelatedResponse).items).toHaveLength(3)
      },
    )
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
