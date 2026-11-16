/**
 * Las tres cachés de AniList, medidas con reloj inyectado.
 *
 * Lo que se prueba aquí no es que se guarde y se lea —eso lo haría cualquier
 * tabla—, sino las dos distinciones que el resto del código usa: «no se ha
 * buscado» contra «se buscó y no hay», y que cada una caduque a su ritmo. Una
 * caché que no distingue lo primero de lo segundo vuelve a preguntar por cada
 * carga de la home lo que ya sabe que no existe.
 */

import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AniListEntry,
  anilistAiringEntrySchema,
  anilistEntrySchema,
  StoreError,
} from '@rona/core'
import { TTL_SECONDS } from '../cache-policy'
import { openDb } from '../db'
import { listMigrations, runMigrations } from '../migrations/runner'
import { createAniListRepository } from './anilist'

/** Una obra con la forma que guarda la caché, con datos de la API real. */
function entrada(overrides: Partial<AniListEntry> = {}): AniListEntry {
  return {
    id: 101922,
    names: {
      romaji: 'Kimetsu no Yaiba',
      english: 'Demon Slayer: Kimetsu no Yaiba',
      native: '鬼滅の刃',
      synonyms: ['Kimetsu no Yaiba TV'],
    },
    format: 'TV',
    status: 'finished',
    year: 2019,
    adult: false,
    episodes: 26,
    durationMin: 23,
    score: 84,
    synopsis: 'Tanjiro Kamado ve su vida destrozada por los demonios.',
    genres: ['Action', 'Adventure', 'Supernatural'],
    studios: ['ufotable'],
    coverUrl:
      'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101922-WBsBl0ClmgYL.jpg',
    bannerUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/101922.jpg',
    siteUrl: 'https://anilist.co/anime/101922',
    ...overrides,
  }
}

/**
 * Base en directorio temporal: ningún test toca `$XDG_DATA_HOME`.
 *
 * `hasta` aplica sólo las migraciones anteriores o iguales a esa versión, que es
 * lo que necesita una prueba del relleno: hay que dejar la base como estaba
 * **antes** de la migración que se mide, escribir la fila antigua y aplicar
 * después lo que falta.
 */
async function withDb<T>(body: (db: Database) => T, hasta?: number): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'rona-anilist-'))
  const db = openDb(join(dir, 'rona.db'))

  try {
    const migraciones =
      hasta === undefined
        ? listMigrations()
        : listMigrations().filter((migration) => migration.version <= hasta)

    runMigrations(db, migraciones)

    return body(db)
  } finally {
    try {
      db.close()
    } catch {
      // Ya estaba cerrada.
    }
    await rm(dir, { recursive: true, force: true })
  }
}

describe('el emparejamiento guardado', () => {
  test('lo que no se ha buscado no es lo mismo que el «no hay»', async () => {
    await withDb((db) => {
      const repo = createAniListRepository(db)

      expect(repo.readMedia('sin-buscar')).toBeNull()

      repo.writeMedia('sin-buscar', null, 1_000)

      const hit = repo.readMedia('sin-buscar', 1_000)
      expect(hit?.value).toBeNull()
      expect(hit?.ttlS).toBe(TTL_SECONDS.anilistMiss)
    })
  })

  test('una obra emparejada se lee con su mes de vida y luego sale vieja', async () => {
    await withDb((db) => {
      const repo = createAniListRepository(db)
      repo.writeMedia('kimetsu', entrada(), 1_000)

      const fresco = repo.readMedia('kimetsu', 1_000)
      expect(fresco?.value?.id).toBe(101922)
      expect(fresco?.ttlS).toBe(TTL_SECONDS.anilistMedia)
      expect(fresco?.stale).toBe(false)

      const justoAntes = 1_000 + TTL_SECONDS.anilistMedia * 1000 - 1
      expect(repo.readMedia('kimetsu', justoAntes)?.stale).toBe(false)

      const justoDespues = 1_000 + TTL_SECONDS.anilistMedia * 1000
      expect(repo.readMedia('kimetsu', justoDespues)?.stale).toBe(true)
    })
  })

  test('volver a escribir pisa el valor y la fecha', async () => {
    await withDb((db) => {
      const repo = createAniListRepository(db)
      repo.writeMedia('kimetsu', null, 1_000)
      repo.writeMedia('kimetsu', entrada({ id: 999 }), 5_000)

      const hit = repo.readMedia('kimetsu', 5_000)
      expect(hit?.value?.id).toBe(999)
      expect(hit?.fetchedAt.getTime()).toBe(5_000)
    })
  })

  test('una fila con una forma que no se entiende es un error, no un dato', async () => {
    await withDb((db) => {
      db.query(
        'INSERT INTO anilist_media (title_key, media_json, fetched_at, ttl_s) VALUES (?, ?, ?, ?)',
      ).run('rota', '{"id": "no-es-un-numero"}', 1_000, TTL_SECONDS.anilistMedia)

      expect(() => createAniListRepository(db).readMedia('rota', 1_000)).toThrow(StoreError)
    })
  })

  /**
   * El emparejamiento y sus imágenes, en la misma escritura.
   *
   * La ficha resuelve el banner **por el id de esta fila**, así que guardar la
   * obra sin sus direcciones dejaba la portada y el banner en un 404 —lo que el
   * navegador pinta como el icono de imagen rota—. No lo veía ninguna prueba
   * porque el único camino que escribía imágenes era el de las listas, y éste es
   * el de la ficha.
   */
  test('guardar el emparejamiento guarda también sus direcciones de imagen', async () => {
    await withDb((db) => {
      const repo = createAniListRepository(db)
      repo.writeMedia('kimetsu', entrada(), 1_000)

      expect(repo.readImage(101922, 'cover')).toBe(entrada().coverUrl)
      expect(repo.readImage(101922, 'banner')).toBe(entrada().bannerUrl)
    })
  })

  test('el «se buscó y no hay» no deja imágenes de una obra que no existe', async () => {
    await withDb((db) => {
      const repo = createAniListRepository(db)
      repo.writeMedia('sin-equivalente', null, 1_000)

      expect(repo.readMedia('sin-equivalente', 1_000)?.value).toBeNull()

      const filas = db
        .query<{ filas: number }, []>('SELECT COUNT(*) AS filas FROM anilist_image')
        .get()

      expect(filas?.filas).toBe(0)
    })
  })
})

describe('las listas cacheadas', () => {
  test('se guardan y se leen con el schema de su contenido', async () => {
    await withDb((db) => {
      const repo = createAniListRepository(db)
      repo.writeList('top:anime', [entrada()], TTL_SECONDS.anilistTop, 1_000)

      const hit = repo.readList('top:anime', anilistEntrySchema, 1_000)
      expect(hit?.value).toHaveLength(1)
      expect(hit?.ttlS).toBe(TTL_SECONDS.anilistTop)
      expect(hit?.stale).toBe(false)
    })
  })

  test('una clave sin fila no es una lista vacía', async () => {
    await withDb((db) => {
      expect(
        createAniListRepository(db).readList('top:anime', anilistEntrySchema, 1_000),
      ).toBeNull()
    })
  })

  test('una lista del top leída como parrilla es un error', async () => {
    await withDb((db) => {
      const repo = createAniListRepository(db)
      repo.writeList('top:anime', [entrada()], TTL_SECONDS.anilistTop, 1_000)

      // La parrilla guarda `media`/`episode`/`airingAt`, así que una lista del
      // top no la cumple: el schema de quien lee es lo que lo detecta.
      expect(() => repo.readList('top:anime', anilistAiringEntrySchema, 1_000)).toThrow(StoreError)
    })
  })
})

describe('las imágenes por id', () => {
  test('se guardan la portada y el banner, y lo que no está no se inventa', async () => {
    await withDb((db) => {
      const repo = createAniListRepository(db)

      expect(repo.readImage(101922, 'cover')).toBeUndefined()

      repo.writeImages(entrada())

      expect(repo.readImage(101922, 'cover')).toBe(entrada().coverUrl)
      expect(repo.readImage(101922, 'banner')).toBe(entrada().bannerUrl)
      expect(repo.readImage(1, 'cover')).toBeUndefined()
    })
  })

  test('una obra sin banner no deja fila de banner', async () => {
    await withDb((db) => {
      const repo = createAniListRepository(db)
      const sinBanner = entrada()
      const { bannerUrl: _sinBanner, ...resto } = sinBanner
      repo.writeImages(resto)

      expect(repo.readImage(101922, 'banner')).toBeUndefined()
      expect(repo.readImage(101922, 'cover')).toBe(resto.coverUrl)
    })
  })
})

/**
 * El relleno de lo emparejado antes del arreglo.
 *
 * Esta migración no crea esquema: arregla datos. Una fila que guardó la versión
 * que no escribía imágenes tiene que aparecer con las suyas sin volver a
 * preguntarle a AniList, que es lo que el TTL de un mes obligaría a esperar.
 */
describe('el relleno de las imágenes ya emparejadas', () => {
  const RELLENO = listMigrations().find((migration) => migration.name === 'anilist-image-relleno')

  /** La versión anterior a la del relleno, para dejar la base como estaba. */
  const ANTES = (RELLENO?.version ?? 0) - 1

  /** Una obra emparejada, escrita como la escribía la versión anterior. */
  function emparejar(db: Database, media: AniListEntry | null, clave = 'kimetsu'): void {
    db.query(
      'INSERT INTO anilist_media (title_key, media_json, fetched_at, ttl_s) VALUES (?, ?, ?, ?)',
    ).run(clave, media === null ? null : JSON.stringify(media), 1_000, TTL_SECONDS.anilistMedia)
  }

  test('la obra guardada sin imágenes recupera su portada y su banner', async () => {
    expect(RELLENO, 'falta la migración del relleno').toBeDefined()

    await withDb((db) => {
      emparejar(db, entrada())

      // Antes del relleno no hay ninguna dirección guardada: la escribía sólo la
      // caché de listas, y esta fila la escribió el código viejo del emparejamiento.
      const antes = db
        .query<{ filas: number }, []>('SELECT COUNT(*) AS filas FROM anilist_image')
        .get()
      expect(antes?.filas).toBe(0)

      // Lo que hace el arranque de la aplicación al abrir una base ya usada.
      runMigrations(db)

      // El repositorio se crea **después** de migrar, que es lo que hace la
      // fachada: prepara sus sentencias al construirse y las columnas nuevas de
      // T60 no existen en la base de antes.
      const repo = createAniListRepository(db)

      expect(repo.readImage(101922, 'cover')).toBe(entrada().coverUrl)
      expect(repo.readImage(101922, 'banner')).toBe(entrada().bannerUrl)
    }, ANTES)
  })

  test('no se inventa lo que no había: ni el banner de una obra sin él, ni el «no hay»', async () => {
    const sinBanner = entrada()
    const { bannerUrl: _sinBanner, ...resto } = sinBanner

    await withDb((db) => {
      emparejar(db, resto)
      emparejar(db, null, 'sin-equivalente')

      runMigrations(db)

      const repo = createAniListRepository(db)
      const filas = db
        .query<{ filas: number }, []>('SELECT COUNT(*) AS filas FROM anilist_image')
        .get()

      expect(repo.readImage(101922, 'cover')).toBe(resto.coverUrl)
      expect(repo.readImage(101922, 'banner')).toBeUndefined()
      expect(filas?.filas).toBe(1)
    }, ANTES)
  })
})

/**
 * La vuelta de AniList a MAL.
 *
 * La ruta de los saltos recibe el id de AniList —es el único que el reproductor
 * conoce— y AniSkip se pide por el de MyAnimeList. Ese mapeo se guarda al mismo
 * tiempo que el emparejamiento; sin él, cada petición de intervalos tendría que
 * parsear el JSON de la obra.
 */
describe('el id de MAL del emparejamiento', () => {
  /** El id real de MAL de Kimetsu no Yaiba, para no inventar un número bonito. */
  const MAL = 38000

  test('lo escrito con malId se lee por el id de AniList', async () => {
    await withDb((db) => {
      const repo = createAniListRepository(db)
      repo.writeMedia('kimetsu', entrada({ malId: MAL }), 1_000)

      expect(repo.readMalId(101922)).toBe(MAL)
    })
  })

  test('una obra sin ficha de MAL y un id que no está dan lo mismo: no hay', async () => {
    await withDb((db) => {
      const repo = createAniListRepository(db)
      repo.writeMedia('sin-mal', entrada({ id: 999, malId: null }), 1_000)

      // `null` es «se preguntó y AniList dijo que no hay»; el id sin fila es «no
      // se ha buscado». A quien pide saltos no le cambia nada: no hay con qué.
      expect(repo.readMalId(999)).toBeUndefined()
      expect(repo.readMalId(123456)).toBeUndefined()
    })
  })

  test('regrabar el «no hay» borra el mapeo anterior del título', async () => {
    await withDb((db) => {
      const repo = createAniListRepository(db)
      repo.writeMedia('kimetsu', entrada({ malId: MAL }), 1_000)
      expect(repo.readMalId(101922)).toBe(MAL)

      // Lo mismo que el servidor hace cuando la caché caduca y la búsqueda no
      // encuentra nada: la fila pasa a «no hay» y no puede seguir sirviendo los
      // intervalos de la obra que ya no es la de este título.
      repo.writeMedia('kimetsu', null, 2_000)

      expect(repo.readMalId(101922)).toBeUndefined()
    })
  })

  test('la fila legacy recupera el id de AniList, y el de MAL sigue sin saberse', async () => {
    const MIGRACION = listMigrations().find((migration) => migration.name === 'anilist-mal')
    expect(MIGRACION, 'falta la migración del id de MAL').toBeDefined()

    /** La base como estaba antes de la columna: sin `anilist_id` ni `mal_id`. */
    const ANTES_DE_MAL = (MIGRACION?.version ?? 0) - 1

    await withDb((db) => {
      // Una fila escrita por la versión anterior: el JSON del emparejamiento y
      // nada más. La obra se emparejó y su `malId` no viajaba en el JSON.
      db.query(
        'INSERT INTO anilist_media (title_key, media_json, fetched_at, ttl_s) VALUES (?, ?, ?, ?)',
      ).run('kimetsu', JSON.stringify(entrada()), 1_000, TTL_SECONDS.anilistMedia)
      db.query(
        'INSERT INTO anilist_media (title_key, media_json, fetched_at, ttl_s) VALUES (?, ?, ?, ?)',
      ).run('sin-equivalente', null, 1_000, TTL_SECONDS.anilistMiss)

      runMigrations(db)

      const fila = db
        .query<{ anilist_id: number | null; mal_id: number | null }, [string]>(
          'SELECT anilist_id, mal_id FROM anilist_media WHERE title_key = ?',
        )
        .get('kimetsu')
      // El id de AniList se copia del JSON para que la vuelta funcione ya; el de
      // MAL no se inventa: esa fila es justo la que el servidor vuelve a pedir.
      expect(fila).toEqual({ anilist_id: 101922, mal_id: null })

      const vacia = db
        .query<{ anilist_id: number | null; mal_id: number | null }, [string]>(
          'SELECT anilist_id, mal_id FROM anilist_media WHERE title_key = ?',
        )
        .get('sin-equivalente')
      expect(vacia).toEqual({ anilist_id: null, mal_id: null })

      expect(createAniListRepository(db).readMalId(101922)).toBeUndefined()
    }, ANTES_DE_MAL)
  })
})
