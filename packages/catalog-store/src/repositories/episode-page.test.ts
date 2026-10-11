import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnimeDetail, Episode, ProviderRef } from '@nn-anime/core'
import { TTL_SECONDS } from '../cache-policy'
import { openDb } from '../db'
import { runMigrations } from '../migrations/runner'
import { createAnimeRepository } from './anime'
import { createEpisodePageRepository } from './episode-page'

const ANIME: ProviderRef = { providerId: 'fixture', value: 'aurora-nocturna' }
const FANTASMA: ProviderRef = { providerId: 'fixture', value: 'no-existe' }

function detalle(ref: ProviderRef): AnimeDetail {
  return { ref, title: 'Un título', genres: ['Acción'], studios: ['Estudio'] }
}

/** Un episodio con el número que se pida: el decimal es el caso que importa. */
function episodio(numero: number): Episode {
  return {
    ref: { providerId: ANIME.providerId, value: `${ANIME.value}#${numero}` },
    animeRef: ANIME,
    number: numero,
    mode: 'sub',
  }
}

/** Base temporal con el título ya escrito, que es lo que la página necesita. */
async function withDb<T>(body: (db: Database) => Promise<T> | T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-episode-page-'))
  const path = join(dir, 'nn-anime.db')

  try {
    const db = openDb(path)
    runMigrations(db)
    createAnimeRepository(db).write(ANIME, detalle(ANIME))

    return await body(db)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('episode_page: la ventana del selector', () => {
  test('la página escrita se lee dentro de la ventana, con su decimal y su hasMore', async () => {
    await withDb((db) => {
      const repo = createEpisodePageRepository(db)
      const t0 = 1_700_000_000_000

      repo.write(ANIME, 2, { episodes: [episodio(12.5)], page: 2, hasMore: true, total: 26 }, t0)

      const leida = repo.read(ANIME, 2, t0)

      expect(leida).not.toBeNull()
      if (leida === null) return
      expect(leida.value.episodes[0]?.number).toBe(12.5)
      expect(leida.value.page).toBe(2)
      expect(leida.value.hasMore).toBe(true)
      expect(leida.value.total).toBe(26)
      expect(leida.stale).toBe(false)
      expect(leida.ttlS).toBe(TTL_SECONDS.episodePage)
    })
  })

  test('los cinco minutos son los del enunciado, ni uno más', () => {
    expect(TTL_SECONDS.episodePage).toBe(300)
  })

  test('pasada la ventana, la página queda vieja', async () => {
    await withDb((db) => {
      const repo = createEpisodePageRepository(db)
      const t0 = 1_700_000_000_000

      repo.write(ANIME, 1, { episodes: [episodio(1)], page: 1, hasMore: true }, t0)

      expect(repo.read(ANIME, 1, t0 + 299_000)?.stale).toBe(false)
      expect(repo.read(ANIME, 1, t0 + 300_000)?.stale).toBe(true)
    })
  })

  test('una página que nunca se escribió es un MISS, no una lista vacía', async () => {
    await withDb((db) => {
      expect(createEpisodePageRepository(db).read(ANIME, 7)).toBeNull()
    })
  })

  test('la página de un título que no está en la base es un MISS', async () => {
    await withDb((db) => {
      expect(createEpisodePageRepository(db).read(FANTASMA, 1)).toBeNull()
    })
  })

  test('escribir la página de un título que no existe lo dice, en vez de fallar por la clave foránea', async () => {
    await withDb((db) => {
      const repo = createEpisodePageRepository(db)

      expect(() =>
        repo.write(FANTASMA, 1, { episodes: [episodio(1)], page: 1, hasMore: false }),
      ).toThrow(/no-existe/)
    })
  })

  test('una página guardada con una forma que no se entiende se denuncia', async () => {
    await withDb((db) => {
      const animeId = db.query<{ id: number }, []>('SELECT id FROM anime').get()?.id
      if (animeId === undefined) throw new Error('la prueba no encontró el título')

      // Se escribe a mano lo que el repositorio nunca escribiría: la caché es una
      // frontera más, y una fila que no cumple el schema no puede salir como si
      // fuera una página.
      db.query(
        `INSERT INTO episode_page (anime_id, page, episodes_json, has_more, total, fetched_at, ttl_s)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(animeId, 1, '{"no":"es una lista"}', 0, null, Date.now(), TTL_SECONDS.episodePage)

      expect(() => createEpisodePageRepository(db).read(ANIME, 1)).toThrow(/no se entiende/)
    })
  })

  test('la página 2 no pisa a la 1: la clave es el título y la página', async () => {
    await withDb((db) => {
      const repo = createEpisodePageRepository(db)
      const t0 = 1_700_000_000_000

      repo.write(ANIME, 1, { episodes: [episodio(1)], page: 1, hasMore: true }, t0)
      repo.write(ANIME, 2, { episodes: [episodio(2)], page: 2, hasMore: false }, t0)

      expect(repo.read(ANIME, 1, t0)?.value.episodes[0]?.number).toBe(1)
      expect(repo.read(ANIME, 2, t0)?.value.episodes[0]?.number).toBe(2)
    })
  })
})
