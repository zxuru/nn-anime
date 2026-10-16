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
import {
  type CatalogStore,
  openDb,
  runMigrations,
  type StoreConnection,
} from '@nn-anime/catalog-store'
import {
  type AiringResponse,
  type AniListRelatedResponse,
  type AnimeDetail,
  anilistSearchResponseSchema,
  type DiscoverResponse,
  type EnrichmentResponse,
} from '@nn-anime/core'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { type FakeAniList, fakeAniList, type RawMediaFixture } from '../__fixtures__/anilist'
import { createApp, createContainer } from '../index'
import { paginaPedida } from './anilist'

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
  readonly store: CatalogStore
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
      store: container.store,
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

/**
 * La búsqueda de una sola casilla, de punta a punta.
 *
 * Lo que se mide aquí y no en `core`: que los valores que salen sean los que el análisis
 * dice —incluido lo que **no** sale, que es lo que la API lee como «sin filtro»—, que la
 * lista de géneros se pida sólo cuando el texto lleva un `#`, que la paginación se decida
 * con `hasNextPage`, que las portadas queden resolubles por su id y que un fallo del
 * tercero sea un 502 y no una lista vacía.
 */
describe('la búsqueda de una casilla', () => {
  const AURORA_NOCTURNA: RawMediaFixture = {
    id: 555,
    romaji: 'Aurora Nocturna',
    year: 2019,
    format: 'TV',
    genres: ['Misterio'],
  }

  /** Una obra con nombre en los tres idiomas: es la que mide qué se enseña. */
  const FRIEREN: RawMediaFixture = {
    id: 154587,
    romaji: 'Sousou no Frieren',
    english: 'Frieren: Beyond Journey’s End',
    native: '葬送のフリーレン',
    year: 2023,
    format: 'TV',
    genres: ['Adventure', 'Drama', 'Fantasy'],
  }

  const GENEROS = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Sci-Fi']

  /** Las variables de la última consulta de búsqueda que vio el doble. */
  function variablesDeBusqueda(fake: FakeAniList): Readonly<Record<string, unknown>> {
    const llamada = [...fake.calls].reverse().find((una) => una.query.includes('pageInfo {'))

    return llamada?.variables ?? {}
  }

  test('un título devuelve la página con el nombre que se enseña y los tres que publica', async () => {
    await conApp({ searchPage: { 1: [FRIEREN] }, genres: GENEROS }, async ({ pedir, fake }) => {
      const respuesta = await pedir('/api/anilist/search?q=frieren')

      expect(respuesta.status).toBe(200)
      const cuerpo = anilistSearchResponseSchema.parse(await respuesta.json())

      expect(cuerpo.items).toHaveLength(1)
      expect(cuerpo.items[0]?.title).toBe('Frieren: Beyond Journey’s End')
      expect(cuerpo.items[0]?.secondaryTitle).toBe('Sousou no Frieren')
      expect(cuerpo.items[0]?.titles).toEqual({
        romaji: 'Sousou no Frieren',
        english: 'Frieren: Beyond Journey’s End',
        native: '葬送のフリーレン',
      })
      expect(cuerpo.items[0]?.genres).toEqual(['Adventure', 'Drama', 'Fantasy'])
      // La portada va por la ruta local, no por la dirección que publica AniList.
      expect(cuerpo.items[0]?.cover).toBe('/api/anilist/image/cover/154587')
      expect(cuerpo).toMatchObject({ page: 1, hasNextPage: false, unknownGenres: [] })

      const variables = variablesDeBusqueda(fake)
      expect(variables.search).toBe('frieren')
      expect(variables.sort).toEqual(['SEARCH_MATCH'])
      expect(Object.hasOwn(variables, 'genres')).toBe(false)
    })
  })

  test('un género se manda como género, sin título, y con el orden de lo popular', async () => {
    await conApp({ searchPage: { 1: [FRIEREN] }, genres: GENEROS }, async ({ pedir, fake }) => {
      const respuesta = await pedir('/api/anilist/search?q=%23fantasy')

      expect(respuesta.status).toBe(200)
      const variables = variablesDeBusqueda(fake)

      expect(variables.genres).toEqual(['Fantasy'])
      expect(Object.hasOwn(variables, 'search')).toBe(false)
      expect(variables.sort).toEqual(['POPULARITY_DESC'])
    })
  })

  test('título y géneros juntos: los dos filtros y el orden de la búsqueda', async () => {
    await conApp({ searchPage: { 1: [FRIEREN] }, genres: GENEROS }, async ({ pedir, fake }) => {
      await pedir('/api/anilist/search?q=frieren%20%23adventure%20%23drama')

      const variables = variablesDeBusqueda(fake)

      expect(variables.search).toBe('frieren')
      expect(variables.genres).toEqual(['Adventure', 'Drama'])
      expect(variables.sort).toEqual(['SEARCH_MATCH'])
    })
  })

  test('un género que AniList no tiene se informa y no se manda', async () => {
    await conApp({ searchPage: { 1: [] }, genres: GENEROS }, async ({ pedir, fake }) => {
      const respuesta = await pedir('/api/anilist/search?q=naruto%20%23shonnen')
      const cuerpo = anilistSearchResponseSchema.parse(await respuesta.json())

      expect(cuerpo.unknownGenres).toEqual(['shonnen'])
      expect(variablesDeBusqueda(fake).search).toBe('naruto')
      expect(variablesDeBusqueda(fake).genres).toBeUndefined()
      expect(JSON.stringify(variablesDeBusqueda(fake))).not.toContain('shonnen')
    })
  })

  test('una casilla vacía enseña lo más popular', async () => {
    await conApp({ searchPage: { 1: [FRIEREN] }, genres: GENEROS }, async ({ pedir, fake }) => {
      const respuesta = await pedir('/api/anilist/search?q=')
      const cuerpo = anilistSearchResponseSchema.parse(await respuesta.json())

      expect(cuerpo.items).toHaveLength(1)
      expect(variablesDeBusqueda(fake).sort).toEqual(['POPULARITY_DESC'])
      expect(Object.hasOwn(variablesDeBusqueda(fake), 'search')).toBe(false)
    })
  })

  test('la paginación la decide `hasNextPage`, y `total` sólo se enseña', async () => {
    const fixture: Parameters<typeof fakeAniList>[0] = {
      searchPage: { 1: [FRIEREN], 2: [AURORA_NOCTURNA] },
      genres: GENEROS,
    }

    await conApp(fixture, async ({ pedir }) => {
      const primera = anilistSearchResponseSchema.parse(
        await (await pedir('/api/anilist/search?q=naruto')).json(),
      )

      expect(primera.hasNextPage).toBe(true)
      expect(primera.total).toBe(2)

      const segunda = anilistSearchResponseSchema.parse(
        await (await pedir('/api/anilist/search?q=naruto&page=2')).json(),
      )

      expect(segunda.page).toBe(2)
      expect(segunda.items.map((item) => item.anilistId)).toEqual([555])
      expect(segunda.hasNextPage).toBe(false)
    })
  })

  test('una obra que la base conoce llega con su referencia local', async () => {
    await conApp(
      { searchPage: { 1: [AURORA_NOCTURNA, FRIEREN] }, genres: GENEROS },
      async ({ pedir }) => {
        const cuerpo = anilistSearchResponseSchema.parse(
          await (await pedir('/api/anilist/search?q=aurora')).json(),
        )

        // La ficha de Aurora se abrió al montar el arnés; la de Frieren no existe.
        expect(cuerpo.items[0]?.ref).toEqual({ providerId: 'fixture', value: REF })
        expect(cuerpo.items[1]?.ref).toBeUndefined()
      },
    )
  })

  test('un género no asigna la ficha local de Naruto a Shippuuden', async () => {
    const NARUTO: RawMediaFixture = {
      id: 20,
      romaji: 'NARUTO',
      english: 'Naruto',
      native: 'NARUTO -ナルト-',
      year: 2002,
    }
    const SHIPPUUDEN: RawMediaFixture = {
      id: 1735,
      romaji: 'NARUTO: Shippuuden',
      english: 'Naruto: Shippuden',
      native: 'NARUTO -ナルト- 疾風伝',
      synonyms: ['Naruto Shippuuden', 'Naruto Shippuden'],
      year: 2007,
    }
    const detalle: AnimeDetail = {
      ref: { providerId: 'fixture', value: 'naruto' },
      title: 'Naruto',
      year: 2002,
      genres: [],
      studios: [],
    }

    await conApp(
      { searchPage: { 1: [NARUTO, SHIPPUUDEN] }, genres: GENEROS },
      async ({ pedir, store }) => {
        await store.writeAnime(detalle.ref, detalle)

        const cuerpo = anilistSearchResponseSchema.parse(
          await (await pedir('/api/anilist/search?q=%23action')).json(),
        )

        expect(cuerpo.items.map((item) => item.anilistId)).toEqual([20, 1735])
        expect(cuerpo.items[0]?.ref).toEqual({ providerId: 'fixture', value: 'naruto' })
        expect(cuerpo.items[1]?.ref).toBeUndefined()
      },
    )
  })

  test('las portadas de la búsqueda se sirven por su id', async () => {
    // Es lo que mide que la lista de la búsqueda escriba sus imágenes en la caché: sin
    // eso, la rejilla pediría una portada que la ruta contesta con 404.
    await conApp({ searchPage: { 1: [FRIEREN] }, genres: GENEROS }, async ({ pedir, fake }) => {
      await pedir('/api/anilist/search?q=frieren')

      const imagen = await pedir('/api/anilist/image/cover/154587')

      expect(imagen.status).toBe(200)
      expect(imagen.headers.get('content-type')).toContain('image/jpeg')
      expect(fake.images).toHaveLength(1)
    })
  })

  /**
   * El reloj de la API no se inyecta en la ruta, así que esta prueba paga el presupuesto
   * de verdad: cada petición espera dos segundos a la anterior. Tres búsquedas —una de
   * ellas con su lista de géneros— no caben en los cinco segundos por defecto.
   */
  test('la lista de géneros se pide sólo cuando el texto lleva un `#`', async () => {
    await conApp({ searchPage: { 1: [FRIEREN] }, genres: GENEROS }, async ({ pedir, fake }) => {
      const generos = (): number =>
        fake.calls.filter((una) => una.query.includes('GenreCollection')).length

      await pedir('/api/anilist/search?q=naruto')
      expect(generos()).toBe(0)

      await pedir('/api/anilist/search?q=%23drama')
      expect(generos()).toBe(1)

      // La segunda no la vuelve a pedir: la lista se guarda en memoria.
      await pedir('/api/anilist/search?q=%23comedy')
      expect(generos()).toBe(1)
    })
  }, 20_000)

  test('un fallo de AniList es un 502, no una lista vacía', async () => {
    const fixture: Parameters<typeof fakeAniList>[0] = {
      searchPage: { 1: [FRIEREN] },
      genres: GENEROS,
    }

    await conApp(fixture, async ({ pedir }) => {
      fixture.status = { 'pageInfo {': 500 }

      const respuesta = await pedir('/api/anilist/search?q=naruto')

      expect(respuesta.status).toBe(502)
      expect(await respuesta.json()).toMatchObject({ error: expect.stringContaining('AniList') })
    })
  })

  test('la página pedida se sanea: lo que no es un entero positivo es la primera', () => {
    expect(paginaPedida(undefined)).toBe(1)
    expect(paginaPedida('')).toBe(1)
    expect(paginaPedida('0')).toBe(1)
    expect(paginaPedida('-3')).toBe(1)
    expect(paginaPedida('2.5')).toBe(1)
    expect(paginaPedida('abc')).toBe(1)
    expect(paginaPedida('3')).toBe(3)
  })
})
