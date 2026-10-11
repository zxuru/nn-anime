import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProviderRef, SearchResult } from '@nn-anime/core'
import { findCoverUrl } from './cover-ref'
import { openDb } from './db'
import { runMigrations } from './migrations/runner'
import { createFeedRepository } from './repositories/feed'
import { createSearchRepository } from './repositories/search'
import { createTrendingRepository } from './repositories/trending'

/**
 * La portada que sale de un listado cacheado.
 *
 * Es el camino que hace que las tarjetas de la búsqueda tengan imagen sin abrir
 * la ficha: el `SearchResult` trae `coverUrl`, pero hasta ahora se guardaba sólo
 * en la caché de resultados y la ruta de portadas no la miraba.
 */

const REF: ProviderRef = { providerId: 'fixture', value: 'aurora-nocturna' }

function resultado(titulo: string, overrides: Partial<SearchResult> = {}): SearchResult {
  const ref = titulo.toLowerCase().replace(/\s+/g, '-')

  return {
    ref: { providerId: 'fixture', value: ref },
    title: titulo,
    coverUrl: `https://fixture.invalid/portada/${ref}.webp`,
    ...overrides,
  }
}

async function withDb<T>(body: (db: Database) => T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-portada-'))

  try {
    const db = openDb(join(dir, 'nn-anime.db'))
    runMigrations(db)

    return body(db)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('findCoverUrl', () => {
  test('la saca de una búsqueda cacheada, sin detalle', async () => {
    await withDb((db) => {
      createSearchRepository(db).write('fixture', 'aurora', [resultado('Aurora Nocturna')])

      expect(findCoverUrl(db, REF)).toBe('https://fixture.invalid/portada/aurora-nocturna.webp')
    })
  })

  test('la saca también de las tendencias', async () => {
    await withDb((db) => {
      createTrendingRepository(db).write('fixture', [resultado('Aurora Nocturna')])

      expect(findCoverUrl(db, REF)).toBe('https://fixture.invalid/portada/aurora-nocturna.webp')
    })
  })

  /**
   * La fila de novedades es la que más lo necesita: es la única de la home que
   * sale entera de un listado, así que sin esta vía cada tarjeta pedía una
   * portada que la ruta contestaba 404 y la fila se pintaba de huecos.
   *
   * La entrada lleva `publishedAt`, y esa fecha es justo lo que la distingue: el
   * schema de `SearchResult` es estricto y la rechazaría, así que la prueba
   * también fija con qué forma se lee la fila del feed.
   */
  test('la saca del feed de novedades, que trae fecha', async () => {
    await withDb((db) => {
      createFeedRepository(db).write('fixture', [
        { ...resultado('Aurora Nocturna'), publishedAt: '2026-10-01T12:00:00.000Z' },
      ])

      expect(findCoverUrl(db, REF)).toBe('https://fixture.invalid/portada/aurora-nocturna.webp')
    })
  })

  test('una novedad de otro proveedor no cuenta', async () => {
    await withDb((db) => {
      createFeedRepository(db).write('otro', [
        { ...resultado('Aurora Nocturna'), publishedAt: '2026-10-01T12:00:00.000Z' },
      ])

      expect(findCoverUrl(db, REF)).toBeUndefined()
    })
  })

  test('sin listado cacheado no hay portada', async () => {
    await withDb((db) => {
      expect(findCoverUrl(db, REF)).toBeUndefined()
    })
  })

  test('un resultado de otro proveedor no cuenta', async () => {
    await withDb((db) => {
      createSearchRepository(db).write('otro', 'aurora', [resultado('Aurora Nocturna')])

      expect(findCoverUrl(db, REF)).toBeUndefined()
    })
  })

  test('un resultado sin portada no inventa una', async () => {
    await withDb((db) => {
      const sinPortada = resultado('Aurora Nocturna')
      createSearchRepository(db).write('fixture', 'aurora', [
        { ref: sinPortada.ref, title: sinPortada.title },
      ])

      expect(findCoverUrl(db, REF)).toBeUndefined()
    })
  })

  test('una fila ilegible se salta en lugar de tumbar la consulta', async () => {
    await withDb((db) => {
      createSearchRepository(db).write('fixture', 'rota', [resultado('Otra')])
      createSearchRepository(db).write('fixture', 'aurora', [resultado('Aurora Nocturna')])
      db.query("UPDATE search_cache SET results_json = 'no es json' WHERE query = 'aurora'").run()
      db.query(
        "UPDATE search_cache SET results_json = '[{\"title\": 1}]' WHERE query = 'rota'",
      ).run()

      expect(findCoverUrl(db, REF)).toBeUndefined()
    })
  })

  test('una fila ilegible no impide leer la siguiente', async () => {
    await withDb((db) => {
      createSearchRepository(db).write('fixture', 'aurora', [resultado('Otra')])
      createTrendingRepository(db).write('fixture', [resultado('Aurora Nocturna')])
      db.query("UPDATE search_cache SET results_json = 'no es json'").run()

      expect(findCoverUrl(db, REF)).toBe('https://fixture.invalid/portada/aurora-nocturna.webp')
    })
  })
})
