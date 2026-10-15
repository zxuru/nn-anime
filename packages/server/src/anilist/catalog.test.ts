/**
 * El catálogo de AniList: la caché por delante, el lote de búsquedas y el
 * emparejamiento con lo que la base ya conoce.
 *
 * Se mide con la base de verdad —en un directorio temporal— y con el `fetch` de
 * mentira: lo que importa no es que la tabla guarde, sino que la **segunda**
 * lectura no vuelva a salir a la red, que un fallo del tercero sirva lo viejo, y
 * que diez títulos sean dos peticiones y no diez.
 */

import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createCatalogStore,
  openDb,
  runMigrations,
  type StoreConnection,
  TTL_SECONDS,
} from '@nn-anime/catalog-store'
import { type AnimeDetail, localWork } from '@nn-anime/core'
import type { Resolver } from '@nn-anime/media-proxy'
import { fakeAniList, mediaJson, type RawMediaFixture } from '../__fixtures__/anilist'
import { type AniListCatalog, createAniListCatalog, matchKey } from './catalog'
import { createAniListClient } from './client'
import { mediaSchema, toEntry } from './entries'

const RESOLVER: Resolver = async () => ['140.82.121.3']

const KIMETSU: RawMediaFixture = {
  id: 101922,
  romaji: 'Kimetsu no Yaiba',
  english: 'Demon Slayer: Kimetsu no Yaiba',
  year: 2019,
  format: 'TV',
  score: 84,
}

const DANMACHI: RawMediaFixture = {
  id: 20920,
  romaji: 'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka',
  english: 'Is It Wrong to Try to Pick Up Girls in a Dungeon?',
  synonyms: ['Danmachi', 'DanMachi: Familia Myth'],
  year: 2015,
  format: 'TV',
}

/** El reloj falso, con espera: así el presupuesto no se espera de verdad. */
interface Reloj {
  readonly now: () => number
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  readonly avanzar: (ms: number) => void
}

function relojFalso(): Reloj {
  let t = 1_700_000_000_000

  return {
    now: () => t,
    async sleep(ms: number) {
      t += ms
    },
    avanzar(ms: number) {
      t += ms
    },
  }
}

interface Contexto {
  readonly catalog: AniListCatalog
  readonly store: ReturnType<typeof createCatalogStore>
  readonly reloj: Reloj
  readonly fake: ReturnType<typeof fakeAniList>
  readonly db: StoreConnection
}

async function conCatalogo(
  fixture: Parameters<typeof fakeAniList>[0],
  body: (contexto: Contexto) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-catalogo-'))
  const db = openDb(join(dir, 'nn-anime.db'))

  try {
    runMigrations(db)
    const reloj = relojFalso()
    const store = createCatalogStore(db, { now: reloj.now })
    const fake = fakeAniList(fixture)
    const client = createAniListClient({
      fetchImpl: fake.impl,
      resolver: RESOLVER,
      now: reloj.now,
      sleep: reloj.sleep,
    })
    const catalog = createAniListCatalog({ store, client, now: reloj.now })

    await body({ catalog, store, reloj, fake, db })
  } finally {
    try {
      db.close()
    } catch {
      // Ya estaba cerrada.
    }
    await rm(dir, { recursive: true, force: true })
  }
}

describe('el top', () => {
  test('la segunda lectura no vuelve a salir a la red', async () => {
    await conCatalogo({ top: [KIMETSU, DANMACHI] }, async ({ catalog, fake }) => {
      const primera = await catalog.top('anime')
      expect(primera.ok).toBe(true)
      expect(primera.ok ? primera.value.map((una) => una.id) : []).toEqual([101922, 20920])
      expect(fake.calls).toHaveLength(1)

      const segunda = await catalog.top('anime')
      expect(segunda.ok ? segunda.value.length : 0).toBe(2)
      expect(fake.calls).toHaveLength(1)
    })
  })

  test('con la caché vencida y AniList caído se sirve lo viejo', async () => {
    const fixture: Parameters<typeof fakeAniList>[0] = { top: [KIMETSU] }

    await conCatalogo(fixture, async ({ catalog, reloj, db }) => {
      const primera = await catalog.top('anime')
      expect(primera.ok).toBe(true)

      // El fixture pasa a contestar 500: la lectura vencida no puede vaciar la
      // fila, y menos con un 429 o un 500 del tercero.
      fixture.status = { POPULARITY_DESC: 500 }
      db.query('UPDATE anilist_list_cache SET fetched_at = 0').run()
      reloj.avanzar(TTL_SECONDS.anilistTop * 1000 + 1)

      const segunda = await catalog.top('anime')
      expect(segunda.ok).toBe(true)
      expect(segunda.ok ? segunda.value.map((una) => una.id) : []).toEqual([101922])
    })
  })

  test('cada mitad pide sus formatos y tiene su propia caché', async () => {
    await conCatalogo({ top: [KIMETSU] }, async ({ catalog, fake }) => {
      await catalog.top('anime')
      await catalog.top('movies')

      expect(fake.calls).toHaveLength(2)
      expect(fake.calls[0]?.variables.formatos).toEqual(['TV', 'TV_SHORT', 'SPECIAL', 'OVA', 'ONA'])
      expect(fake.calls[1]?.variables.formatos).toEqual(['MOVIE'])
    })
  })
})

describe('la parrilla', () => {
  test('llega con el capítulo, la fecha y su obra', async () => {
    await conCatalogo(
      { airing: [{ media: KIMETSU, episode: 5, airingAt: 1_760_000_000 }] },
      async ({ catalog }) => {
        const resultado = await catalog.airing('anime', 7)

        expect(resultado.ok).toBe(true)
        expect(resultado.ok ? resultado.value : []).toHaveLength(1)
        expect(resultado.ok ? resultado.value[0]?.episode : undefined).toBe(5)
        expect(resultado.ok ? resultado.value[0]?.airingAt : undefined).toBe(
          new Date(1_760_000_000 * 1000).toISOString(),
        )
      },
    )
  })

  test('la parrilla de películas no existe y no sale a preguntarla', async () => {
    await conCatalogo({}, async ({ catalog, fake }) => {
      const resultado = await catalog.airing('movies', 7)

      // Un estreno se anuncia con precisión de año —lo dice la API— y colocarlo en
      // un calendario por días sería inventar la fecha. Se dice vacío, sin salir.
      expect(resultado.ok).toBe(true)
      expect(resultado.ok ? resultado.value : ['algo']).toEqual([])
      expect(fake.calls).toHaveLength(0)
    })
  })

  test('los estrenos recientes de películas se listan con día o con año', async () => {
    await conCatalogo({}, async ({ catalog, fake }) => {
      const resultado = await catalog.recent('movies')

      expect(resultado.ok).toBe(true)
      expect(fake.calls).toHaveLength(1)
      expect(fake.calls[0]?.variables).toHaveProperty('desde')
      expect(fake.calls[0]?.variables).toHaveProperty('hasta')
    })
  })
})

describe('una caché que no se entiende', () => {
  test('no tumba la fila: se pide otra vez y la escritura la reemplaza', async () => {
    await conCatalogo({ top: [KIMETSU] }, async ({ catalog, db, fake }) => {
      const primera = await catalog.top('anime')
      expect(primera.ok).toBe(true)

      // Una fila con otra forma —lo que dejaría una versión anterior del código—
      // no puede convertirse en un error para quien está mirando la home.
      db.query('UPDATE anilist_list_cache SET payload_json = \'{"no": true}\'').run()

      const segunda = await catalog.top('anime')
      expect(segunda.ok).toBe(true)
      expect(segunda.ok ? segunda.value.map((una) => una.id) : []).toEqual([101922])
      expect(fake.calls.length).toBeGreaterThan(1)
    })
  })
})

describe('el emparejamiento', () => {
  test('elige la candidata correcta y no vuelve a preguntar', async () => {
    await conCatalogo({ search: { Danmachi: [KIMETSU, DANMACHI] } }, async ({ catalog, fake }) => {
      // La identidad es la de verdad —la que usa la ruta—: con ella, la
      // búsqueda que devuelve dos obras tiene que quedarse con la de 2015.
      const key = matchKey('Danmachi', 2015)
      const local = localWork({ title: 'Danmachi' }, 2015)

      const primera = await catalog.match({ key, local })
      expect(primera.ok).toBe(true)
      expect(primera.ok ? primera.value?.id : undefined).toBe(20920)
      expect(fake.calls).toHaveLength(1)

      const segunda = await catalog.match({ key, local })
      expect(segunda.ok ? segunda.value?.id : undefined).toBe(20920)
      expect(fake.calls).toHaveLength(1)
    })
  })

  test('un lote de diez obras son dos peticiones, y el «no hay» se recuerda', async () => {
    await conCatalogo(
      { search: { 'Kimetsu no Yaiba': [KIMETSU] } },
      async ({ catalog, fake, reloj }) => {
        const peticiones = Array.from({ length: 10 }, (_, indice) => ({
          key: matchKey(indice === 0 ? 'Kimetsu no Yaiba' : `Obra ${indice}`, undefined),
          local: localWork({ title: indice === 0 ? 'Kimetsu no Yaiba' : `Obra ${indice}` }),
        }))

        const primera = await catalog.matchMany(peticiones)
        expect(primera.get(matchKey('Kimetsu no Yaiba', undefined))?.id).toBe(101922)
        expect(primera.get(matchKey('Obra 3', undefined))).toBeNull()
        // Diez obras, dos consultas: ocho y dos.
        expect(fake.calls).toHaveLength(2)

        // Y la siguiente vez no sale ninguna: lo emparejado y lo que no, se recuerda.
        const antes = fake.calls.length
        await catalog.matchMany(peticiones)
        expect(fake.calls).toHaveLength(antes)

        // Pasado el TTL del «no hay», vuelve a preguntarse por lo que no hay.
        reloj.avanzar(TTL_SECONDS.anilistMiss * 1000 + 1)
        const segunda = peticiones[1]
        if (segunda === undefined) throw new Error('la petición de prueba no está')
        await catalog.matchMany([segunda])
        expect(fake.calls.length).toBeGreaterThan(antes)
      },
    )
  })
})

describe('el emparejamiento con lo que la base ya conoce', () => {
  test('un título local se reconoce por un sinónimo de AniList', async () => {
    await conCatalogo({}, async ({ catalog, store }) => {
      const detalle: AnimeDetail = {
        ref: { providerId: 'fixture', value: 'danmachi' },
        title: 'Danmachi',
        year: 2015,
        genres: [],
        studios: [],
      }
      await store.writeAnime(detalle.ref, detalle)

      const entrada = toEntry(mediaSchema.parse(mediaJson(DANMACHI)))
      expect(entrada).toBeDefined()
      if (entrada === undefined) return

      const refs = await catalog.localRefs([entrada])

      expect(refs.get(20920)).toEqual({ providerId: 'fixture', value: 'danmachi' })
    })
  })

  test('sin nada en la base no hay referencia, y eso no es un error', async () => {
    await conCatalogo({}, async ({ catalog }) => {
      const entrada = toEntry(mediaSchema.parse(mediaJson(KIMETSU)))
      expect(entrada).toBeDefined()
      if (entrada === undefined) return

      const refs = await catalog.localRefs([entrada])

      expect(refs.size).toBe(0)
    })
  })
})
