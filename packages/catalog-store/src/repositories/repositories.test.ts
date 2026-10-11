import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnimeDetail, Episode, ProviderRef, SearchResult } from '@nn-anime/core'
import { cacheHit, isStale, TTL_SECONDS } from '../cache-policy'
import { openDb } from '../db'
import { runMigrations } from '../migrations/runner'
import { createAnimeRepository } from './anime'
import { createEpisodesRepository } from './episodes'
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

/** Base en directorio temporal: ningún test toca `$XDG_DATA_HOME`. */
async function withStore<T>(body: (db: Database) => Promise<T> | T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-repo-'))

  try {
    const db = openDb(join(dir, 'nn-anime.db'))
    runMigrations(db)

    return await body(db)
  } finally {
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
