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
import { type AnimeDetail, createLogger, localWork } from '@nn-anime/core'
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

/** Una obra local del fixture, que la cruzada tiene que poder cruzar. */
const AURORA: RawMediaFixture = {
  id: 555,
  romaji: 'Aurora Nocturna',
  year: 2019,
  format: 'TV',
}

/** Una película del mismo estudio: la mitad de anime no la admite. */
const PELICULA: RawMediaFixture = {
  id: 999,
  romaji: 'El Jardín de Hierro',
  year: 2021,
  format: 'MOVIE',
}

/** Una obra marcada para adultos: con el interruptor apagado no se sirve. */
const MARCADA: RawMediaFixture = {
  id: 777,
  romaji: 'Obra Marcada',
  year: 2020,
  format: 'TV',
  isAdult: true,
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
  /** Los avisos que el catálogo escribió por el registro, en orden. */
  readonly avisos: readonly string[]
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
    // El registro se recoge: un fallo que sólo se devuelve y no se cuenta deja la
    // búsqueda sin su lista sin que nada lo diga, que es el defecto que se arregló.
    const avisos: string[] = []
    const catalog = createAniListCatalog({
      store,
      client,
      now: reloj.now,
      logger: createLogger({ level: 'warn', sink: (entrada) => avisos.push(entrada.msg) }),
    })

    await body({ catalog, store, reloj, fake, db, avisos })
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
      const primera = await catalog.top('anime', false)
      expect(primera.ok).toBe(true)
      expect(primera.ok ? primera.value.map((una) => una.id) : []).toEqual([101922, 20920])
      expect(fake.calls).toHaveLength(1)

      const segunda = await catalog.top('anime', false)
      expect(segunda.ok ? segunda.value.length : 0).toBe(2)
      expect(fake.calls).toHaveLength(1)
    })
  })

  test('con la caché vencida y AniList caído se sirve lo viejo', async () => {
    const fixture: Parameters<typeof fakeAniList>[0] = { top: [KIMETSU] }

    await conCatalogo(fixture, async ({ catalog, reloj, db }) => {
      const primera = await catalog.top('anime', false)
      expect(primera.ok).toBe(true)

      // El fixture pasa a contestar 500: la lectura vencida no puede vaciar la
      // fila, y menos con un 429 o un 500 del tercero.
      fixture.status = { POPULARITY_DESC: 500 }
      db.query('UPDATE anilist_list_cache SET fetched_at = 0').run()
      reloj.avanzar(TTL_SECONDS.anilistTop * 1000 + 1)

      const segunda = await catalog.top('anime', false)
      expect(segunda.ok).toBe(true)
      expect(segunda.ok ? segunda.value.map((una) => una.id) : []).toEqual([101922])
    })
  })

  test('cada mitad pide sus formatos y tiene su propia caché', async () => {
    await conCatalogo({ top: [KIMETSU] }, async ({ catalog, fake }) => {
      await catalog.top('anime', false)
      await catalog.top('movies', false)

      expect(fake.calls).toHaveLength(2)
      expect(fake.calls[0]?.variables.formatos).toEqual(['TV', 'TV_SHORT', 'SPECIAL', 'OVA', 'ONA'])
      expect(fake.calls[1]?.variables.formatos).toEqual(['MOVIE'])
    })
  })
})

/**
 * La búsqueda cruzada.
 *
 * Lo que se mide aquí y no en la ruta: que la consulta que sale sea **una que AniList
 * acepta** —el estudio por `Page.studios`, con sus obras, y el género por `genre:`, y
 * ninguno de los dos con argumentos que `Media` no tiene—, y que el filtro de la mitad
 * y el del interruptor se apliquen donde la consulta no puede: la conexión de obras de
 * un estudio no acepta `format_in` ni `isAdult`.
 */
describe('la búsqueda cruzada', () => {
  const ESTUDIO_COBRE = {
    name: 'Estudio Cobre',
    media: [KIMETSU, AURORA],
  }

  test('el término viaja como estudio, y como género sólo si lo es', async () => {
    await conCatalogo(
      { cross: { studios: [ESTUDIO_COBRE], genre: [DANMACHI] } },
      async ({ catalog, fake }) => {
        const porEstudio = await catalog.cross('ufotable', 'anime', false)

        expect(porEstudio.ok ? porEstudio.value.map((una) => una.id) : []).toEqual([101922, 555])
        // Sin género en la consulta: `genre:` sólo acepta un nombre de la lista cerrada
        // de AniList y con otro devuelve un error.
        expect(fake.calls[0]?.variables.q).toBe('ufotable')
        expect(fake.calls[0]?.variables.genero).toBeUndefined()
        expect(fake.calls[0]?.query).not.toContain('genre:')
      },
    )
  })

  test('el estudio se pide por `Page.studios`, que es lo que AniList tiene', async () => {
    // El fallo que esto mide, y que llegó a producción: la consulta pedía
    // `media(studio: $q)`, un argumento que `Media` no tiene. AniList contestaba un
    // error de la consulta entera —con él caía también el género que viajaba al lado— y
    // el doble de las pruebas lo aceptaba, así que nada lo dijo.
    await conCatalogo({ cross: { studios: [ESTUDIO_COBRE] } }, async ({ catalog, fake }) => {
      const resultado = await catalog.cross('ufotable', 'anime', false)
      const consulta = fake.calls[0]?.query ?? ''

      expect(resultado.ok).toBe(true)
      expect(consulta).toContain('studios(search: $q)')
      expect(consulta).toContain('media(page: 1, perPage: $porEstudio, isMain: true')
      // Un `studio:` dentro de un `media(` es el argumento que no existe.
      expect(consulta).not.toMatch(/media\([^)]*\bstudio\s*:/s)
    })
  })

  test('se miran las obras del estudio del nombre exacto, no las de sus parecidos', async () => {
    // «Cobre» devuelve dos estudios —es una búsqueda, no una igualdad— y el usuario ha
    // pedido uno: las obras del otro no son suyas.
    await conCatalogo(
      {
        cross: {
          studios: [
            { name: 'Estudio Cobre Animación', media: [DANMACHI] },
            { name: 'Estudio Cobre', media: [KIMETSU] },
          ],
        },
      },
      async ({ catalog }) => {
        const resultado = await catalog.cross('estudio cobre', 'anime', false)

        expect(resultado.ok ? resultado.value.map((una) => una.id) : []).toEqual([101922])
      },
    )
  })

  test('sin nombre exacto se miran los estudios que devolvió la búsqueda', async () => {
    await conCatalogo(
      {
        cross: {
          studios: [
            { name: 'Toei Animation', media: [KIMETSU] },
            { name: 'Toei Company', media: [DANMACHI] },
          ],
        },
      },
      async ({ catalog }) => {
        const resultado = await catalog.cross('toei', 'anime', false)

        expect(resultado.ok ? resultado.value.map((una) => una.id) : []).toEqual([101922, 20920])
      },
    )
  })

  test('un género en español viaja con el nombre que exige AniList', async () => {
    await conCatalogo({ cross: { genre: [DANMACHI] } }, async ({ catalog, fake }) => {
      const resultado = await catalog.cross('Acción', 'anime', false)

      expect(resultado.ok ? resultado.value.map((una) => una.id) : []).toEqual([20920])
      expect(fake.calls[0]?.variables.genero).toBe('Action')
      expect(fake.calls[0]?.query).toContain('genre: $genero')
    })
  })

  test('las dos listas se unen sin repetir y con el tope puesto', async () => {
    // La misma obra en las dos —un estudio que se llame como un género— es una
    // pieza: sin la unión, la rejilla la pintaría dos veces.
    await conCatalogo(
      {
        cross: {
          studios: [{ name: 'Action', media: [KIMETSU, DANMACHI] }],
          genre: [KIMETSU],
        },
      },
      async ({ catalog, fake }) => {
        const resultado = await catalog.cross('Action', 'anime', false)

        expect(resultado.ok ? resultado.value.map((una) => una.id) : []).toEqual([101922, 20920])
        expect(fake.calls).toHaveLength(1)
      },
    )
  })

  test('la mitad se filtra después: la conexión del estudio no acepta `format_in`', async () => {
    // La película del estudio no entra en la mitad de anime, y la serie no entra en la
    // de películas: el filtro va sobre lo que llegó porque la consulta no puede pedirlo.
    await conCatalogo(
      { cross: { studios: [{ name: 'Estudio Cobre', media: [KIMETSU, PELICULA] }] } },
      async ({ catalog }) => {
        const anime = await catalog.cross('estudio cobre', 'anime', false)
        const peliculas = await catalog.cross('estudio cobre', 'movies', false)

        expect(anime.ok ? anime.value.map((una) => una.id) : []).toEqual([101922])
        expect(peliculas.ok ? peliculas.value.map((una) => una.id) : []).toEqual([999])
      },
    )
  })

  test('la obra marcada del estudio tampoco entra con el interruptor apagado', async () => {
    // La consulta del género filtra por `isAdult`, la del estudio no puede: si este
    // filtro no estuviera, la lista del estudio sería la única puerta por la que se
    // colaría una obra marcada.
    await conCatalogo(
      { cross: { studios: [{ name: 'Estudio Cobre', media: [KIMETSU, MARCADA] }] } },
      async ({ catalog }) => {
        const segura = await catalog.cross('estudio cobre', 'anime', false)
        const entera = await catalog.cross('estudio cobre', 'anime', true)

        expect(segura.ok ? segura.value.map((una) => una.id) : []).toEqual([101922])
        expect(entera.ok ? entera.value.map((una) => una.id) : []).toEqual([101922, 777])
      },
    )
  })

  test('la segunda lectura del mismo término no vuelve a salir a la red', async () => {
    await conCatalogo({ cross: { studios: [ESTUDIO_COBRE] } }, async ({ catalog, fake }) => {
      await catalog.cross('ufotable', 'anime', false)
      await catalog.cross('  UFOTABLE ', 'anime', false)

      // El término se normaliza en la clave: dos grafías del mismo estudio son una
      // consulta, y el presupuesto de AniList no se gasta dos veces en lo mismo.
      expect(fake.calls).toHaveLength(1)
    })
  })

  test('con el interruptor apagado la consulta del género filtra; con él encendido no', async () => {
    await conCatalogo({ cross: { genre: [KIMETSU] } }, async ({ catalog, fake }) => {
      await catalog.cross('Acción', 'anime', false)
      await catalog.cross('Acción', 'anime', true)

      expect(fake.calls[0]?.query).toContain('isAdult: false')
      // El eje viaja en la clave de caché: encender el interruptor pide otra cosa y
      // no puede servirse la lista del estado anterior.
      expect(fake.calls).toHaveLength(2)
      // `isAdult` está también en los campos de la obra; lo que cambia es el filtro.
      expect(fake.calls[1]?.query).not.toContain('isAdult: false')
    })
  })

  test('un fallo de AniList se avisa por el registro, no sólo se devuelve', async () => {
    // El fallo que costó una tarde: la consulta no validaba, la lista no llegaba y nada
    // lo decía. La prueba mide que ahora sí se dice.
    const fixture: Parameters<typeof fakeAniList>[0] = { cross: { studios: [ESTUDIO_COBRE] } }

    await conCatalogo(fixture, async ({ catalog, avisos }) => {
      fixture.status = { 'porEstudio: Page(': 500 }

      const resultado = await catalog.cross('Estudio Cobre', 'anime', false)

      expect(resultado.ok).toBe(false)
      expect(avisos).toHaveLength(1)
      expect(avisos[0]).toContain('AniList')
    })
  })

  test('la mitad decide los formatos que se piden al género', async () => {
    await conCatalogo({ cross: { genre: [KIMETSU] } }, async ({ catalog, fake }) => {
      await catalog.cross('Acción', 'movies', false)

      expect(fake.calls[0]?.variables.formatos).toEqual(['MOVIE'])
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
      const resultado = await catalog.recent('movies', false)

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
      const primera = await catalog.top('anime', false)
      expect(primera.ok).toBe(true)

      // Una fila con otra forma —lo que dejaría una versión anterior del código—
      // no puede convertirse en un error para quien está mirando la home.
      db.query('UPDATE anilist_list_cache SET payload_json = \'{"no": true}\'').run()

      const segunda = await catalog.top('anime', false)
      expect(segunda.ok).toBe(true)
      expect(segunda.ok ? segunda.value.map((una) => una.id) : []).toEqual([101922])
      expect(fake.calls.length).toBeGreaterThan(1)
    })
  })

  /**
   * Una entrada guardada antes de que existiera `adult` no se puede leer —el schema la
   * exige—, así que la fila se trata como ausente y se vuelve a pedir. Es a propósito:
   * un `false` por defecto daría por apta una obra que nadie ha mirado.
   */
  test('una entrada sin la marca de adultos se vuelve a pedir', async () => {
    await conCatalogo({ top: [KIMETSU] }, async ({ catalog, db, fake }) => {
      const primera = await catalog.top('anime', false)
      expect(primera.ok).toBe(true)
      const antes = fake.calls.length

      db.query(
        "UPDATE anilist_list_cache SET payload_json = json_remove(payload_json, '$[0].adult')",
      ).run()

      const segunda = await catalog.top('anime', false)

      expect(segunda.ok ? segunda.value.length : 0).toBe(1)
      expect(fake.calls.length).toBeGreaterThan(antes)
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

      const primera = await catalog.match({ key, local }, false)
      expect(primera.ok).toBe(true)
      expect(primera.ok ? primera.value?.id : undefined).toBe(20920)
      expect(fake.calls).toHaveLength(1)

      const segunda = await catalog.match({ key, local }, false)
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

        const primera = await catalog.matchMany(peticiones, false)
        expect(primera.get(matchKey('Kimetsu no Yaiba', undefined))?.id).toBe(101922)
        expect(primera.get(matchKey('Obra 3', undefined))).toBeNull()
        // Diez obras, dos consultas: ocho y dos.
        expect(fake.calls).toHaveLength(2)

        // Y la siguiente vez no sale ninguna: lo emparejado y lo que no, se recuerda.
        const antes = fake.calls.length
        await catalog.matchMany(peticiones, false)
        expect(fake.calls).toHaveLength(antes)

        // Pasado el TTL del «no hay», vuelve a preguntarse por lo que no hay.
        reloj.avanzar(TTL_SECONDS.anilistMiss * 1000 + 1)
        const segunda = peticiones[1]
        if (segunda === undefined) throw new Error('la petición de prueba no está')
        await catalog.matchMany([segunda], false)
        expect(fake.calls.length).toBeGreaterThan(antes)
      },
    )
  })
})

describe('el contenido para adultos en la caché', () => {
  const MARCADA: RawMediaFixture = { ...KIMETSU, id: 999, isAdult: true }

  /**
   * La regla de guarda: con el interruptor apagado, de una obra marcada queda sólo la
   * marca de su referencia —la escribe la ruta, que es quien la conoce— y no la
   * entrada. Sin esto, la caché tendría la portada y la sinopsis de lo que el usuario
   * ha pedido no ver.
   */
  test('apagado, un emparejamiento marcado no deja entrada en la caché', async () => {
    await conCatalogo({ search: { 'Kimetsu no Yaiba': [MARCADA] } }, async ({ catalog, db }) => {
      const key = matchKey('Kimetsu no Yaiba', undefined)
      const resultado = await catalog.match(
        { key, local: localWork({ title: 'Kimetsu no Yaiba' }) },
        false,
      )

      expect(resultado.ok ? resultado.value?.adult : undefined).toBe(true)

      const filas = db.query('SELECT COUNT(*) AS total FROM anilist_media').get() as {
        total: number
      }

      expect(filas.total).toBe(0)
    })
  })

  test('encendido, sí la guarda: es lo que la ficha necesita', async () => {
    await conCatalogo({ search: { 'Kimetsu no Yaiba': [MARCADA] } }, async ({ catalog, db }) => {
      const key = matchKey('Kimetsu no Yaiba', undefined)
      await catalog.match({ key, local: localWork({ title: 'Kimetsu no Yaiba' }) }, true)

      const filas = db.query('SELECT COUNT(*) AS total FROM anilist_media').get() as {
        total: number
      }

      expect(filas.total).toBe(1)
    })
  })

  /**
   * El eje va en la clave: con el interruptor encendido se pide otra cosa, y sin él la
   * lista cacheada apagada se serviría encendida hasta que venciera el TTL.
   */
  test('el top se cachea por eje: lo pedido apagado no se sirve encendido', async () => {
    await conCatalogo({ top: [KIMETSU, MARCADA] }, async ({ catalog, fake }) => {
      await catalog.top('anime', false)
      await catalog.top('anime', false)
      expect(fake.calls).toHaveLength(1)

      await catalog.top('anime', true)
      expect(fake.calls).toHaveLength(2)
    })
  })

  test('la consulta excluye apagado y omite el argumento encendido', async () => {
    await conCatalogo({ top: [KIMETSU] }, async ({ catalog, fake }) => {
      await catalog.top('anime', false)
      await catalog.top('anime', true)

      // El campo `isAdult` va en la selección **siempre** —se guarda con cada obra—;
      // lo que cambia es el argumento que filtra.
      expect(fake.calls[0]?.query).toContain('isAdult: false')
      expect(fake.calls[1]?.query).not.toContain('isAdult: false')
    })
  })

  /**
   * El emparejamiento **no filtra nunca**: preguntar es la única forma de saber que una
   * obra es para adultos, y el feed de una fuente no publica la edad de sus entradas.
   */
  test('el emparejamiento no filtra en ninguno de los dos estados', async () => {
    await conCatalogo({ search: { 'Kimetsu no Yaiba': [KIMETSU] } }, async ({ catalog, fake }) => {
      const peticion = {
        key: matchKey('Kimetsu no Yaiba', undefined),
        local: localWork({ title: 'Kimetsu no Yaiba' }),
      }

      await catalog.match(peticion, false)
      await catalog.match(peticion, true)

      for (const llamada of fake.calls) expect(llamada.query).not.toContain('isAdult: false')
    })
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

/** La película que AniList declara como secuela de «Kimetsu no Yaiba». */
const MUGEN: RawMediaFixture = {
  id: 112151,
  romaji: 'Kimetsu no Yaiba: Mugen Ressha-hen',
  year: 2020,
  format: 'MOVIE',
}

describe('las relaciones de una obra', () => {
  test('la segunda lectura no vuelve a salir a la red', async () => {
    await conCatalogo(
      { relations: { 101922: [{ relation: 'SEQUEL', media: MUGEN }] } },
      async ({ catalog, fake }) => {
        const primera = await catalog.related(101922)
        expect(primera.ok ? primera.value.map((una) => una.media.id) : []).toEqual([112151])
        expect(primera.ok ? primera.value[0]?.relation : undefined).toBe('sequel')
        expect(fake.calls).toHaveLength(1)
        expect(fake.calls[0]?.variables.id).toBe(101922)

        const segunda = await catalog.related(101922)
        expect(segunda.ok ? segunda.value.length : 0).toBe(1)
        expect(fake.calls).toHaveLength(1)
      },
    )
  })

  test('la caché guarda la portada de la secuela: su imagen se puede pedir', async () => {
    // Sin la media en la lista cacheada, la ruta de la imagen contestaría 404 y
    // la pieza saldría sin carátula: la caché de imágenes la escribe esta lectura.
    await conCatalogo(
      { relations: { 101922: [{ relation: 'SEQUEL', media: MUGEN }] } },
      async ({ catalog }) => {
        await catalog.related(101922)

        expect(await catalog.image(112151, 'cover')).toContain('112151')
      },
    )
  })

  test('con la caché vencida y AniList caído se sirve lo viejo', async () => {
    const fixture: Parameters<typeof fakeAniList>[0] = {
      relations: { 101922: [{ relation: 'SEQUEL', media: MUGEN }] },
    }

    await conCatalogo(fixture, async ({ catalog, reloj, db }) => {
      const primera = await catalog.related(101922)
      expect(primera.ok).toBe(true)

      fixture.status = { relations: 500 }
      db.query('UPDATE anilist_list_cache SET fetched_at = 0').run()
      reloj.avanzar(TTL_SECONDS.anilistRelated * 1000 + 1)

      const segunda = await catalog.related(101922)
      expect(segunda.ok ? segunda.value.map((una) => una.media.id) : []).toEqual([112151])
    })
  })

  test('sin relaciones la respuesta es una lista vacía, no un error', async () => {
    await conCatalogo({ relations: {} }, async ({ catalog }) => {
      const resultado = await catalog.related(101922)

      expect(resultado.ok ? resultado.value : undefined).toEqual([])
    })
  })
})
