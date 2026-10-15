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
} from '@nn-anime/core'
import { TTL_SECONDS } from '../cache-policy'
import { openDb } from '../db'
import { runMigrations } from '../migrations/runner'
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

/** Base en directorio temporal: ningún test toca `$XDG_DATA_HOME`. */
async function withDb<T>(body: (db: Database) => T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-anilist-'))
  const db = openDb(join(dir, 'nn-anime.db'))

  try {
    runMigrations(db)

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
