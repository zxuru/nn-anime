import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnimeDetail, Episode, FeedEntry, ProviderRef, SearchResult } from '@nn-anime/core'
import { StoreError } from '@nn-anime/core'
import { cacheHit, isStale, TTL_SECONDS } from '../cache-policy'
import { openDb } from '../db'
import { runMigrations } from '../migrations/runner'
import { createAnimeRepository } from './anime'
import { createEpisodesRepository } from './episodes'
import { createFeedRepository } from './feed'
import { createRecentRepository } from './recent'
import { createSearchRepository } from './search'

const REF: ProviderRef = { providerId: 'fixture', value: 'aurora-nocturna' }

function detalle(overrides: Partial<AnimeDetail> = {}): AnimeDetail {
  return {
    ref: REF,
    title: 'Aurora Nocturna',
    titleAlt: 'Night Aurora',
    coverUrl: 'https://fixture.invalid/portada/aurora.webp',
    year: 2019,
    kind: 'tv',
    synopsis: 'Una cartógrafa recorre el cielo de su ciudad.',
    status: 'finished',
    episodeCount: 12,
    genres: ['Acción', 'Fantasía', 'Misterio'],
    studios: ['Estudio Cobre'],
    ...overrides,
  }
}

function episodio(numero: number, overrides: Partial<Episode> = {}): Episode {
  return {
    ref: { providerId: 'fixture', value: `aurora-nocturna#${numero}` },
    animeRef: REF,
    number: numero,
    title: `Episodio ${numero}`,
    durationS: 1440,
    mode: 'sub',
    ...overrides,
  }
}

function resultado(title: string): SearchResult {
  return { ref: { providerId: 'fixture', value: title }, title }
}

/** Cierra la base sin lanzar: algún test la cierra por su cuenta. */
function cerrarBase(db: Database): void {
  try {
    db.close()
  } catch {
    // Ya estaba cerrada: no hay nada que hacer.
  }
}

/** Base en directorio temporal: ningún test toca `$XDG_DATA_HOME`. */
async function withStore<T>(body: (db: Database) => Promise<T> | T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-repo-'))
  const db = openDb(join(dir, 'nn-anime.db'))

  try {
    runMigrations(db)

    return await body(db)
  } finally {
    // Windows no deja borrar un archivo abierto, y SQLite mantiene la base y sus
    // `-wal`/`-shm` hasta el cierre: cerrarla antes del `rm` es lo que permite
    // borrar el directorio sin un EBUSY que tape el resultado del test.
    cerrarBase(db)
    await rm(dir, { recursive: true, force: true })
  }
}

describe('política de caché', () => {
  test('los TTL son los de la tabla del spec', () => {
    expect(TTL_SECONDS).toEqual({
      search: 900,
      anime: 86400,
      episodes: 21600,
      stream: 600,
      cover: 604800,
      // Las tendencias no estaban en la tabla del spec: las añadió la auditoría de
      // T47, que encontró que la segunda carga de la home volvía a pedirlas.
      trending: 900,
      // El feed lo añade T49: media hora, porque un feed cambia como mucho a
      // diario y cada consulta es una petición al sitio de otro.
      feed: 1800,
      // La página del selector la añade T87: cinco minutos, porque una página es
      // lo que se está mirando ahora y no el catálogo del título.
      episodePage: 300,
      // Las cuatro de AniList las añade T121: un mes el emparejamiento de una
      // obra —su título y su sinopsis no cambian—, una semana el «no hay» —que es
      // una respuesta y no se repite por nada—, seis horas el ranking y media
      // hora la parrilla, que es lo único que se mueve a diario.
      anilistMedia: 2592000,
      anilistMiss: 604800,
      anilistTop: 21600,
      anilistSchedule: 1800,
      // Las relaciones las añade T124: una semana. Es la estructura de una
      // franquicia —qué secuela tiene— y eso no se mueve a diario, pero se mueve
      // más que el título de una obra: cuando AniList anuncia la secuela, está.
      anilistRelated: 604800,
    })
  })

  test('un dato dentro del TTL no está viejo', () => {
    const ahora = 1_000_000

    expect(isStale(ahora - 900 * 1000 + 1, 900, ahora)).toBe(false)
  })

  test('justo al cumplirse el TTL, está viejo', () => {
    const ahora = 1_000_000

    expect(isStale(ahora - 900 * 1000, 900, ahora)).toBe(true)
  })

  test('el resultado de caché lleva value, fecha, ttl y stale', () => {
    const hit = cacheHit('valor', 5_000, 900, 5_000 + 10_000)

    expect(hit.value).toBe('valor')
    expect(hit.fetchedAt).toBeInstanceOf(Date)
    expect(hit.ttlS).toBe(900)
    expect(hit.stale).toBe(false)
  })
})

describe('anime', () => {
  test('un MISS devuelve null y no lanza', async () => {
    await withStore((db) => {
      const anime = createAnimeRepository(db)

      expect(anime.read(REF)).toBeNull()
    })
  })

  test('escribe y lee conservando géneros y estudios en orden', async () => {
    await withStore((db) => {
      const anime = createAnimeRepository(db)
      anime.write(REF, detalle())

      const hit = anime.read(REF)

      expect(hit).not.toBeNull()
      expect(hit?.value.title).toBe('Aurora Nocturna')
      expect(hit?.value.genres).toEqual(['Acción', 'Fantasía', 'Misterio'])
      expect(hit?.value.studios).toEqual(['Estudio Cobre'])
      expect(hit?.value.ref).toEqual(REF)
      expect(hit?.stale).toBe(false)
      expect(hit?.ttlS).toBe(TTL_SECONDS.anime)
    })
  })

  test('escribir dos veces la misma ref actualiza y no duplica', async () => {
    await withStore((db) => {
      const anime = createAnimeRepository(db)
      anime.write(REF, detalle())
      const primero = anime.idOf(REF)
      anime.write(REF, detalle({ title: 'Otro título', genres: ['Sólo uno'] }))

      const filas = db.query('SELECT COUNT(*) AS total FROM anime').get() as { total: number }

      expect(filas.total).toBe(1)
      expect(anime.idOf(REF)).toBe(primero)
      expect(anime.read(REF)?.value.title).toBe('Otro título')
      expect(db.query('SELECT name FROM genre ORDER BY name').all()).toEqual([{ name: 'Sólo uno' }])
    })
  })

  test('con TTL vencido el dato sale como stale, sin borrar nada', async () => {
    await withStore((db) => {
      const anime = createAnimeRepository(db)
      const ahora = 1_000_000
      anime.write(REF, detalle(), ahora)

      const fresco = anime.read(REF, ahora + 60_000)
      const viejo = anime.read(REF, ahora + TTL_SECONDS.anime * 1000 + 1)

      expect(fresco?.stale).toBe(false)
      expect(viejo?.stale).toBe(true)
      expect(viejo?.value.title).toBe('Aurora Nocturna')
    })
  })

  test('un raw_json corrupto se denuncia en vez de devolver medio objeto', async () => {
    await withStore((db) => {
      const anime = createAnimeRepository(db)
      anime.write(REF, detalle())
      db.query('UPDATE anime SET raw_json = \'{"title": 3}\'').run()

      expect(() => anime.read(REF)).toThrow(/no cumple el schema/)
    })
  })

  test('sin raw_json la fila no se puede leer y se dice por qué', async () => {
    await withStore((db) => {
      const anime = createAnimeRepository(db)
      anime.write(REF, detalle())
      db.query('UPDATE anime SET raw_json = NULL').run()

      expect(() => anime.read(REF)).toThrow(/raw_json/)
    })
  })
})

describe('la búsqueda por género', () => {
  const OTRO: ProviderRef = { providerId: 'fixture', value: 'mar-de-cristal' }

  /** Dos títulos con géneros distintos, que es lo mínimo para notar un filtro. */
  async function conDosTitulos<T>(
    body: (anime: ReturnType<typeof createAnimeRepository>) => T,
  ): Promise<T> {
    return await withStore((db) => {
      const anime = createAnimeRepository(db)
      anime.write(REF, detalle())
      anime.write(OTRO, detalle({ ref: OTRO, title: 'Mar de Cristal', genres: ['Drama'] }))

      return body(anime)
    })
  }

  test('el nombre del género se compara sin mayúsculas y sin tildes', async () => {
    await conDosTitulos((anime) => {
      for (const termino of ['Acción', 'accion', '  ACCIÓN  ', 'acci']) {
        expect(anime.searchByGenre(termino, 10).map((hit) => hit.title)).toEqual([
          'Aurora Nocturna',
        ])
      }
    })
  })

  test('lo que sale es un resultado de búsqueda completo, no una fila a medias', async () => {
    await conDosTitulos((anime) => {
      expect(anime.searchByGenre('acción', 10)).toEqual([
        {
          ref: REF,
          title: 'Aurora Nocturna',
          titleAlt: 'Night Aurora',
          coverUrl: 'https://fixture.invalid/portada/aurora.webp',
          year: 2019,
          kind: 'tv',
        },
      ])
    })
  })

  test('un título con dos géneros que encajan sale una sola vez', async () => {
    await withStore((db) => {
      const anime = createAnimeRepository(db)
      anime.write(REF, detalle({ genres: ['Ciencia ficción', 'Ficción'] }))

      expect(anime.searchByGenre('ficcion', 10)).toHaveLength(1)
    })
  })

  test('un género de dos palabras se encuentra por la segunda', async () => {
    await withStore((db) => {
      const anime = createAnimeRepository(db)
      anime.write(REF, detalle({ genres: ['Ciencia ficción'] }))

      expect(anime.searchByGenre('ficcion', 10).map((hit) => hit.title)).toEqual([
        'Aurora Nocturna',
      ])
    })
  })

  test('sin coincidencias devuelve vacío, no el catálogo entero', async () => {
    await conDosTitulos((anime) => {
      expect(anime.searchByGenre('mecha', 10)).toEqual([])
      expect(anime.searchByGenre('   ', 10)).toEqual([])
    })
  })

  test('un trozo a mitad de palabra no cuenta: se busca por principio de palabra', async () => {
    await conDosTitulos((anime) => {
      expect(anime.searchByGenre('ccion', 10)).toEqual([])
    })
  })

  test('el límite se respeta', async () => {
    await withStore((db) => {
      const anime = createAnimeRepository(db)
      anime.write(REF, detalle())
      anime.write(OTRO, detalle({ ref: OTRO, title: 'Mar de Cristal', genres: ['Acción'] }))

      expect(anime.searchByGenre('acción', 1)).toHaveLength(1)
      expect(anime.searchByGenre('acción', 10)).toHaveLength(2)
    })
  })
})

describe('episodios', () => {
  test('sin el anime, un MISS devuelve null', async () => {
    await withStore((db) => {
      const episodios = createEpisodesRepository(db)

      expect(episodios.read(REF)).toBeNull()
    })
  })

  test('guardar episodios de un anime que no está se denuncia', async () => {
    await withStore((db) => {
      const episodios = createEpisodesRepository(db)

      expect(() => episodios.write(REF, [episodio(1)])).toThrow(/no está/)
    })
  })

  test('escribe y lee la lista ordenada por número', async () => {
    await withStore((db) => {
      createAnimeRepository(db).write(REF, detalle())
      const episodios = createEpisodesRepository(db)
      episodios.write(REF, [episodio(3), episodio(1), episodio(2)])

      const hit = episodios.read(REF)

      expect(hit?.value.map((item) => item.number)).toEqual([1, 2, 3])
      expect(hit?.value[0]?.ref).toEqual({ providerId: 'fixture', value: 'aurora-nocturna#1' })
      expect(hit?.value[0]?.animeRef).toEqual(REF)
      expect(hit?.value[0]?.mode).toBe('sub')
      expect(hit?.ttlS).toBe(TTL_SECONDS.episodes)
    })
  })

  test('un anime sin episodios es una lista vacía, no un MISS', async () => {
    await withStore((db) => {
      createAnimeRepository(db).write(REF, detalle({ episodeCount: 0 }))
      const episodios = createEpisodesRepository(db)
      episodios.write(REF, [])

      const hit = episodios.read(REF)

      expect(hit).not.toBeNull()
      expect(hit?.value).toEqual([])
    })
  })

  test('escribir otra vez reemplaza la lista, no la duplica', async () => {
    await withStore((db) => {
      createAnimeRepository(db).write(REF, detalle())
      const episodios = createEpisodesRepository(db)
      episodios.write(REF, [episodio(1), episodio(2)])
      episodios.write(REF, [episodio(2)])

      const hit = episodios.read(REF)

      expect(hit?.value.map((item) => item.number)).toEqual([2])
    })
  })

  test('borrar el anime se lleva sus episodios: la clave foránea hace su trabajo', async () => {
    await withStore((db) => {
      const anime = createAnimeRepository(db)
      anime.write(REF, detalle())
      createEpisodesRepository(db).write(REF, [episodio(1)])

      db.query('DELETE FROM anime WHERE provider_id = ? AND provider_ref = ?').run(
        REF.providerId,
        REF.value,
      )

      const filas = db.query('SELECT COUNT(*) AS total FROM episode').get() as { total: number }
      expect(filas.total).toBe(0)
    })
  })
})

describe('búsqueda', () => {
  test('un MISS devuelve null', async () => {
    await withStore((db) => {
      const busquedas = createSearchRepository(db)

      expect(busquedas.read('fixture', 'aurora')).toBeNull()
    })
  })

  test('escribe y lee los resultados con su TTL', async () => {
    await withStore((db) => {
      const busquedas = createSearchRepository(db)
      busquedas.write('fixture', 'aurora', [resultado('Uno'), resultado('Dos')])

      const hit = busquedas.read('fixture', 'aurora')

      expect(hit?.value.map((item) => item.title)).toEqual(['Uno', 'Dos'])
      expect(hit?.ttlS).toBe(TTL_SECONDS.search)
    })
  })

  test('la clave es la consulta normalizada: la misma búsqueda, una entrada', async () => {
    await withStore((db) => {
      const busquedas = createSearchRepository(db)
      busquedas.write('fixture', '  Aurora  ', [resultado('Uno')])

      expect(busquedas.read('fixture', 'aurora')?.value).toHaveLength(1)
      expect(busquedas.read('fixture', 'AURORA')?.value).toHaveLength(1)
      expect(busquedas.read('fixture', 'e\u0301xito')).toBeNull()

      busquedas.write('fixture', 'éxito', [resultado('Dos')])
      expect(busquedas.read('fixture', 'e\u0301xito')?.value).toHaveLength(1)

      const filas = db.query('SELECT COUNT(*) AS total FROM search_cache').get() as {
        total: number
      }
      expect(filas.total).toBe(2)
    })
  })

  test('cada proveedor tiene sus propios resultados', async () => {
    await withStore((db) => {
      const busquedas = createSearchRepository(db)
      busquedas.write('uno', 'aurora', [resultado('De uno')])
      busquedas.write('dos', 'aurora', [resultado('De dos')])

      expect(busquedas.read('uno', 'aurora')?.value[0]?.title).toBe('De uno')
      expect(busquedas.read('dos', 'aurora')?.value[0]?.title).toBe('De dos')
    })
  })

  test('escribir otra vez la misma clave actualiza los resultados', async () => {
    await withStore((db) => {
      const busquedas = createSearchRepository(db)
      busquedas.write('fixture', 'aurora', [resultado('Viejo')])
      busquedas.write('fixture', 'aurora', [resultado('Nuevo')])

      expect(busquedas.read('fixture', 'aurora')?.value[0]?.title).toBe('Nuevo')
    })
  })

  test('los resultados cacheados se validan al leerlos', async () => {
    await withStore((db) => {
      const busquedas = createSearchRepository(db)
      busquedas.write('fixture', 'aurora', [resultado('Uno')])
      db.query('UPDATE search_cache SET results_json = \'[{"title": 1}]\'').run()

      expect(() => busquedas.read('fixture', 'aurora')).toThrow(/no cumplen el schema/)
    })
  })

  test('con TTL vencido sale stale y se sigue sirviendo', async () => {
    await withStore((db) => {
      const busquedas = createSearchRepository(db)
      const ahora = 1_000_000
      busquedas.write('fixture', 'aurora', [resultado('Uno')], ahora)

      const viejo = busquedas.read('fixture', 'aurora', ahora + TTL_SECONDS.search * 1000 + 1)

      expect(viejo?.stale).toBe(true)
      expect(viejo?.value).toHaveLength(1)
    })
  })
})

describe('detalle y episodios juntos', () => {
  test('una sola llamada deja el anime, sus géneros y sus episodios', async () => {
    await withStore((db) => {
      const anime = createAnimeRepository(db)
      anime.writeWith(REF, detalle(), [episodio(1), episodio(2)])

      expect(anime.read(REF)?.value.title).toBe('Aurora Nocturna')
      expect(createEpisodesRepository(db).read(REF)?.value).toHaveLength(2)
      expect(db.query('SELECT COUNT(*) AS total FROM genre').get()).toEqual({ total: 3 })
    })
  })

  test('si los episodios fallan, el anime no queda a medias', async () => {
    await withStore((db) => {
      const anime = createAnimeRepository(db)

      // Dos episodios con la misma referencia: la clave única los rechaza a
      // mitad de la transacción.
      expect(() => anime.writeWith(REF, detalle(), [episodio(1), episodio(1)])).toThrow()

      expect(anime.read(REF)).toBeNull()
      expect(createEpisodesRepository(db).read(REF)).toBeNull()
      expect(db.query('SELECT COUNT(*) AS total FROM genre').get()).toEqual({ total: 0 })
    })
  })

  test('escribir con episodios dos veces actualiza en lugar de acumular', async () => {
    await withStore((db) => {
      const anime = createAnimeRepository(db)
      anime.writeWith(REF, detalle(), [episodio(1), episodio(2)])
      anime.writeWith(REF, detalle({ title: 'Otro' }), [episodio(2)])

      expect(anime.read(REF)?.value.title).toBe('Otro')
      expect(
        createEpisodesRepository(db)
          .read(REF)
          ?.value.map((item) => item.number),
      ).toEqual([2])
      expect(db.query('SELECT COUNT(*) AS total FROM anime').get()).toEqual({ total: 1 })
    })
  })
})

describe('las tres tablas conviven', () => {
  test('cada repositorio escribe en la suya sin pisarse', async () => {
    await withStore((db) => {
      createAnimeRepository(db).write(REF, detalle())
      createEpisodesRepository(db).write(REF, [episodio(1)])
      createSearchRepository(db).write('fixture', 'aurora', [resultado('Uno')])

      expect(createAnimeRepository(db).read(REF)?.value.episodeCount).toBe(12)
      expect(createEpisodesRepository(db).read(REF)?.value).toHaveLength(1)
      expect(createSearchRepository(db).read('fixture', 'aurora')?.value).toHaveLength(1)
    })
  })
})

describe('el feed', () => {
  function entrada(title: string, publishedAt: string): FeedEntry {
    return { ref: { providerId: 'fixture', value: title }, title, publishedAt }
  }

  test('un MISS devuelve null', async () => {
    await withStore((db) => {
      expect(createFeedRepository(db).read('fixture')).toBeNull()
    })
  })

  test('escribe y lee las entradas con sus fechas y su TTL', async () => {
    await withStore((db) => {
      const feed = createFeedRepository(db)
      feed.write('fixture', [
        entrada('Nueva', '2026-10-01T12:00:00.000Z'),
        entrada('Vieja', '2026-09-20T12:00:00.000Z'),
      ])

      const hit = feed.read('fixture')

      expect(hit?.value.map((item) => item.title)).toEqual(['Nueva', 'Vieja'])
      expect(hit?.value[0]?.publishedAt).toBe('2026-10-01T12:00:00.000Z')
      expect(hit?.ttlS).toBe(TTL_SECONDS.feed)
      expect(hit?.stale).toBe(false)
    })
  })

  test('la segunda escritura reemplaza la del proveedor, no acumula', async () => {
    await withStore((db) => {
      const feed = createFeedRepository(db)
      feed.write('fixture', [entrada('Primera', '2026-09-01T12:00:00.000Z')])
      feed.write('fixture', [entrada('Segunda', '2026-10-01T12:00:00.000Z')])

      expect(feed.read('fixture')?.value.map((item) => item.title)).toEqual(['Segunda'])

      const filas = db.query('SELECT COUNT(*) AS total FROM feed_cache').get() as { total: number }
      expect(filas.total).toBe(1)
    })
  })

  test('la caducidad se calcula con el reloj que se le pasa', async () => {
    await withStore((db) => {
      const feed = createFeedRepository(db)
      const escrito = Date.parse('2026-10-01T12:00:00.000Z')
      feed.write('fixture', [entrada('Nueva', '2026-10-01T12:00:00.000Z')], escrito)

      // Justo antes del TTL y justo después: la frontera se mide, no se supone.
      expect(feed.read('fixture', escrito + TTL_SECONDS.feed * 1000 - 1)?.stale).toBe(false)
      expect(feed.read('fixture', escrito + TTL_SECONDS.feed * 1000)?.stale).toBe(true)
    })
  })

  test('cada proveedor tiene su propio feed', async () => {
    await withStore((db) => {
      const feed = createFeedRepository(db)
      feed.write('uno', [entrada('De uno', '2026-10-01T12:00:00.000Z')])
      feed.write('dos', [entrada('De dos', '2026-10-01T12:00:00.000Z')])

      expect(feed.read('uno')?.value[0]?.title).toBe('De uno')
      expect(feed.read('dos')?.value[0]?.title).toBe('De dos')
    })
  })

  test('un JSON cacheado que no cumple el schema es un StoreError con contexto', async () => {
    await withStore((db) => {
      db.query(
        'INSERT INTO feed_cache (provider_id, results_json, fetched_at, ttl_s) VALUES (?, ?, ?, ?)',
      ).run('fixture', JSON.stringify([{ title: 'sin ref' }]), Date.now(), TTL_SECONDS.feed)

      let capturado: unknown
      try {
        createFeedRepository(db).read('fixture')
      } catch (cause) {
        capturado = cause
      }

      expect(capturado).toBeInstanceOf(StoreError)
      expect(capturado instanceof StoreError ? capturado.op : '').toBe('readFeed')
      expect(capturado instanceof StoreError ? capturado.message : '').toContain('feed')
    })
  })

  test('una fecha que no es ISO no llega a entrar', async () => {
    await withStore((db) => {
      // El repositorio no valida al escribir —lo hace el SDK antes—, así que lo
      // que se comprueba aquí es que la lectura no se cree cualquier cosa.
      db.query(
        'INSERT INTO feed_cache (provider_id, results_json, fetched_at, ttl_s) VALUES (?, ?, ?, ?)',
      ).run(
        'fixture',
        JSON.stringify([{ ref: REF, title: 'Un título', publishedAt: 'ayer' }]),
        Date.now(),
        TTL_SECONDS.feed,
      )

      expect(() => createFeedRepository(db).read('fixture')).toThrow(StoreError)
    })
  })
})

describe('lo último que la aplicación conoce', () => {
  const MAR: ProviderRef = { providerId: 'fixture', value: 'mar-de-cristal' }

  test('une lo abierto y lo encontrado por una búsqueda', async () => {
    await withStore((db) => {
      const anime = createAnimeRepository(db)
      const busquedas = createSearchRepository(db)

      anime.write(REF, detalle(), 1_000)
      busquedas.write('fixture', 'mar', [resultado('Mar de Cristal')], 2_000)

      const lista = createRecentRepository(db).list(10)

      expect(lista.map((item) => item.title)).toEqual(['Mar de Cristal', 'Aurora Nocturna'])
    })
  })

  test('una referencia en las dos tablas es una entrada, con la marca más nueva', async () => {
    await withStore((db) => {
      const anime = createAnimeRepository(db)
      const busquedas = createSearchRepository(db)

      anime.write(REF, detalle({ title: 'Título viejo' }), 1_000)
      // La búsqueda es posterior: manda su título y su marca, y sigue habiendo una
      // sola fila. Sin el `GROUP BY`, el mismo título aparecería dos veces.
      busquedas.write('fixture', 'aurora', [{ ref: REF, title: 'Título nuevo' }], 5_000)

      const lista = createRecentRepository(db).list(10)

      expect(lista).toHaveLength(1)
      expect(lista[0]?.title).toBe('Título nuevo')
    })
  })

  test('una búsqueda caducada cuenta igual: esto no es «lo fresco»', async () => {
    await withStore((db) => {
      createSearchRepository(db).write('fixture', 'aurora', [resultado('Aurora Nocturna')], 1_000)

      // Muy por detrás del TTL de búsqueda: la fila dice «lo que la aplicación
      // conoce», y esconder lo que ya está en disco sería lo contrario.
      expect(createRecentRepository(db).list(10)).toHaveLength(1)
    })
  })

  test('respeta el límite y el orden: primero lo más nuevo', async () => {
    await withStore((db) => {
      const anime = createAnimeRepository(db)
      anime.write(REF, detalle(), 1_000)
      anime.write(MAR, detalle({ ref: MAR, title: 'Mar de Cristal' }), 9_000)

      const lista = createRecentRepository(db).list(1)

      expect(lista).toHaveLength(1)
      expect(lista[0]?.ref).toEqual(MAR)
    })
  })

  test('un límite de cero no devuelve nada', async () => {
    await withStore((db) => {
      createAnimeRepository(db).write(REF, detalle(), 1_000)

      expect(createRecentRepository(db).list(0)).toEqual([])
    })
  })

  test('un título sin portada ni año no inventa los campos', async () => {
    await withStore((db) => {
      createSearchRepository(db).write('fixture', 'aurora', [resultado('Aurora Nocturna')], 1_000)

      const [primero] = createRecentRepository(db).list(10)

      expect(primero?.title).toBe('Aurora Nocturna')
      expect(primero?.coverUrl).toBeUndefined()
      expect(primero?.year).toBeUndefined()
      expect(primero?.kind).toBeUndefined()
    })
  })

  test('el `kind` sale validado: uno que no es del contrato se descarta', async () => {
    await withStore((db) => {
      createAnimeRepository(db).write(REF, detalle({ kind: 'ova' }), 1_000)
      createSearchRepository(db).write(
        'fixture',
        'rara',
        [
          {
            ref: { providerId: 'fixture', value: 'otro' },
            title: 'Con tipo raro',
            kind: 'pelicula',
          },
        ] as unknown as readonly SearchResult[],
        2_000,
      )

      const lista = createRecentRepository(db).list(10)

      expect(lista.find((item) => item.title === 'Aurora Nocturna')?.kind).toBe('ova')
      expect(lista.find((item) => item.title === 'Con tipo raro')?.kind).toBeUndefined()
    })
  })

  test('un `results_json` que no es JSON no rompe la lectura', async () => {
    await withStore((db) => {
      createAnimeRepository(db).write(REF, detalle(), 1_000)
      db.query(
        `INSERT INTO search_cache (provider_id, query, results_json, fetched_at, ttl_s)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('fixture', 'rota', '{esto no es json', 9_000, TTL_SECONDS.search)

      // `json_each` sobre eso lanzaría: la fila se salta y lo demás se sirve.
      expect(
        createRecentRepository(db)
          .list(10)
          .map((item) => item.title),
      ).toEqual(['Aurora Nocturna'])
    })
  })

  test('un resultado con otra forma se descarta sin llevarse la lista', async () => {
    await withStore((db) => {
      createAnimeRepository(db).write(REF, detalle(), 1_000)
      createSearchRepository(db).write(
        'fixture',
        'rara',
        // Sin `ref`: el contrato lo exige, pero la base guarda lo que le den.
        [{ title: 'Sin referencia' }] as unknown as readonly SearchResult[],
        9_000,
      )

      expect(
        createRecentRepository(db)
          .list(10)
          .map((item) => item.title),
      ).toEqual(['Aurora Nocturna'])
    })
  })
})

describe('la tabla `genre`', () => {
  test('se escribe en la misma transacción que el título', async () => {
    // La auditoría de T47 dio por hecho que **nadie escribía** en esta tabla, con
    // un `grep` mal hecho, y lo dejó escrito en el spec. Esta prueba existe para
    // que ese hallazgo falso no pueda volver: si alguien deja de escribirla, se
    // entera aquí.
    await withStore((db) => {
      const anime = createAnimeRepository(db)
      anime.write(REF, detalle({ genres: ['Acción', 'Fantasía'] }))

      const filas = db.query('SELECT name FROM genre ORDER BY name').all() as { name: string }[]

      expect(filas.map((fila) => fila.name)).toEqual(['Acción', 'Fantasía'])
    })
  })
})
