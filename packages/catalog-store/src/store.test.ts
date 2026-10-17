import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnimeDetail, Episode, ProviderRef, WatchEventInput } from '@nn-anime/core'
import { z } from 'zod'
import { TTL_SECONDS } from './cache-policy'
import { openDb } from './db'
import { createRevalidator, markRevalidateError } from './revalidate'
import { createCatalogStore } from './store'
import { createWriteQueue } from './write-queue'

const AURORA: ProviderRef = { providerId: 'fixture', value: 'aurora-nocturna' }
const MAR: ProviderRef = { providerId: 'fixture', value: 'mar-de-cristal' }

function detalle(ref: ProviderRef): AnimeDetail {
  return {
    ref,
    title: `Título ${ref.value}`,
    year: 2019,
    kind: 'tv',
    coverUrl: `https://fixture.invalid/${ref.value}.webp`,
    synopsis: 'Una sinopsis.',
    status: 'finished',
    episodeCount: 2,
    genres: ['Acción', 'Fantasía'],
    studios: ['Estudio Cobre'],
  }
}

function episodios(ref: ProviderRef): readonly Episode[] {
  return [1, 2].map((numero) => ({
    ref: { providerId: 'fixture', value: `${ref.value}#${numero}` },
    animeRef: ref,
    number: numero,
    title: `Episodio ${numero}`,
    mode: 'sub',
  }))
}

function visionado(ref: ProviderRef): WatchEventInput {
  return {
    animeRef: ref,
    episodeRef: { providerId: 'fixture', value: `${ref.value}#1` },
    mode: 'sub',
    positionS: 0,
    durationS: 1440,
    startedAt: new Date(1_000_000),
  }
}

/** Cierra la base sin lanzar: algún test la cierra por su cuenta. */
function cerrarBase(db: Database): void {
  try {
    db.close()
  } catch {
    // Ya estaba cerrada: no hay nada que hacer.
  }
}

async function withStore<T>(
  body: (context: {
    store: ReturnType<typeof createCatalogStore>
    queue: ReturnType<typeof createWriteQueue>
    dir: string
  }) => Promise<T> | T,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-fachada-'))
  const db = openDb(join(dir, 'nn-anime.db'))
  const queue = createWriteQueue()
  const store = createCatalogStore(db, { queue })

  try {
    await store.runMigrations()
    return await body({ store, queue, dir })
  } finally {
    // Windows no deja borrar un archivo abierto: hay que cerrar la base (y sus
    // `-wal`/`-shm`) antes del `rm`, o el EBUSY del `finally` tapa el resultado
    // del test. `store.close()` ya la cierra; el cierre defensivo cubre el caso
    // de que el test la haya cerrado antes.
    await store.close().catch(() => {})
    cerrarBase(db)
    await rm(dir, { recursive: true, force: true })
  }
}

describe('lecturas y escrituras', () => {
  test('escribe y lee un detalle con géneros y estudios', async () => {
    await withStore(async ({ store }) => {
      await store.writeAnime(AURORA, detalle(AURORA))

      const hit = await store.readAnime(AURORA)

      expect(hit?.value.genres).toEqual(['Acción', 'Fantasía'])
      expect(hit?.value.studios).toEqual(['Estudio Cobre'])
      expect(hit?.value.ref).toEqual(AURORA)
      expect(hit?.stale).toBe(false)
    })
  })

  test('un MISS es null, no una excepción', async () => {
    await withStore(async ({ store }) => {
      expect(await store.readAnime(AURORA)).toBeNull()
      expect(await store.readEpisodes(AURORA)).toBeNull()
      expect(await store.readSearch('fixture', 'aurora')).toBeNull()
      expect(await store.readFeed('fixture')).toBeNull()
      expect(await store.readStream({ providerId: 'fixture', value: 'x#1' }, 'sub')).toBeNull()
    })
  })

  test('detalle y episodios juntos, y la lista se lee entera', async () => {
    await withStore(async ({ store }) => {
      await store.writeAnimeWithEpisodes(AURORA, detalle(AURORA), episodios(AURORA))

      expect(await store.readAnime(AURORA)).not.toBeNull()
      expect((await store.readEpisodes(AURORA))?.value).toHaveLength(2)
    })
  })

  test('el feed va y vuelve por la fachada, con sus fechas', async () => {
    await withStore(async ({ store }) => {
      await store.writeFeed('fixture', [
        { ref: AURORA, title: 'Aurora Nocturna', publishedAt: '2026-10-01T12:00:00.000Z' },
      ])

      const hit = await store.readFeed('fixture')

      expect(hit?.value[0]?.publishedAt).toBe('2026-10-01T12:00:00.000Z')
      expect(hit?.ttlS).toBe(TTL_SECONDS.feed)
    })
  })

  test('las búsquedas y los streams también van y vuelven', async () => {
    await withStore(async ({ store }) => {
      await store.writeAnimeWithEpisodes(AURORA, detalle(AURORA), episodios(AURORA))
      await store.writeSearch('fixture', 'aurora', [{ ref: AURORA, title: 'Aurora Nocturna' }])
      await store.writeStream(
        { episodeRef: { providerId: 'fixture', value: 'aurora-nocturna#1' }, mode: 'sub' },
        [{ url: 'https://fixture.invalid/a.m3u8', kind: 'hls' }],
      )

      expect((await store.readSearch('fixture', '  AURORA '))?.value).toHaveLength(1)
      expect(
        (await store.readStream({ providerId: 'fixture', value: 'aurora-nocturna#1' }, 'sub'))
          ?.kind,
      ).toBe('hls')
      expect(
        await store.invalidateStream({ providerId: 'fixture', value: 'aurora-nocturna#1' }, 'sub'),
      ).toBe(1)
      expect(
        await store.readStream({ providerId: 'fixture', value: 'aurora-nocturna#1' }, 'sub'),
      ).toBeNull()
    })
  })

  test('el historial y los favoritos, de punta a punta', async () => {
    await withStore(async ({ store }) => {
      await store.writeAnimeWithEpisodes(AURORA, detalle(AURORA), episodios(AURORA))
      const id = await store.recordWatch(visionado(AURORA))
      await store.updateWatchPosition(id, 300, 1440)
      await store.setFavorite(AURORA, true)
      await store.recordSearch('aurora', 'fixture', 1)

      expect((await store.listRecentlyWatched(10))[0]?.positionS).toBe(300)
      expect((await store.listFavorites())[0]?.title).toBe('Título aurora-nocturna')
      expect((await store.listRecentSearches(10))[0]?.query).toBe('aurora')
    })
  })

  /**
   * Las dos lecturas nuevas del Perfil, por la fachada.
   *
   * La fachada es el único camino de escritura del sistema, así que probar el
   * repositorio por su cuenta no basta: lo que hay que medir es que las dos rutas
   * existen en el contrato que usa el server y que escriben donde se lee.
   */
  test('la marca de quiero ver y el historial paginado, por la fachada', async () => {
    await withStore(async ({ store }) => {
      await store.writeAnimeWithEpisodes(AURORA, detalle(AURORA), episodios(AURORA))
      for (let indice = 0; indice < 3; indice++) await store.recordWatch(visionado(AURORA))
      await store.setPlanToWatch(AURORA, true)

      expect((await store.listPlanToWatch())[0]?.title).toBe('Título aurora-nocturna')
      expect((await store.listWatchHistory(2, 0))[0]?.anime.title).toBe('Título aurora-nocturna')

      // El troceado es de verdad: la segunda página trae la fila que queda.
      expect(await store.listWatchHistory(2, 0)).toHaveLength(2)
      expect(await store.listWatchHistory(2, 2)).toHaveLength(1)

      await store.setPlanToWatch(AURORA, false)

      expect(await store.listPlanToWatch()).toEqual([])
      // Y quitarla de pendientes no ha tocado el historial.
      expect(await store.listWatchHistory(10, 0)).toHaveLength(3)
    })
  })

  test('los ajustes se guardan con JSON y se validan al leer', async () => {
    await withStore(async ({ store }) => {
      await store.setSetting('tema', 'claro')

      expect(await store.getSetting('tema', z.enum(['oscuro', 'claro']), 'oscuro')).toBe('claro')
      expect(await store.getSetting('tema', z.number(), 20)).toBe(20)
      expect(await store.getSetting('otra', z.string(), 'por defecto')).toBe('por defecto')
    })
  })
})

describe('un solo escritor', () => {
  test('todas las escrituras de la fachada pasan por la cola', async () => {
    await withStore(async ({ store, queue }) => {
      const vistas: number[] = []
      const original = queue.run.bind(queue)

      // Se envuelve la cola para contar lo que pasa por ella: si alguna escritura
      // se saltara la cola, el contador no la vería.
      queue.run = <T>(tarea: () => T | Promise<T>): Promise<T> => {
        vistas.push(1)
        return original(tarea)
      }

      await store.writeAnime(AURORA, detalle(AURORA))
      await store.setFavorite(AURORA, true)
      await store.recordSearch('aurora', 'fixture', 1)
      await store.pruneOrphans()
      await store.runMigrations()

      expect(vistas.length).toBe(5)
    })
  })

  test('cincuenta escrituras simultáneas se serializan y no fallan', async () => {
    await withStore(async ({ store }) => {
      await store.writeAnimeWithEpisodes(AURORA, detalle(AURORA), episodios(AURORA))

      await Promise.all(
        Array.from({ length: 50 }, (_item, indice) =>
          store.setSetting(`clave-${indice}`, { indice }),
        ),
      )

      expect(
        await store.getSetting('clave-49', z.object({ indice: z.number() }), { indice: -1 }),
      ).toEqual({
        indice: 49,
      })
    })
  })
})

describe('cierre', () => {
  test('cierra la revalidación, vacía la cola y cierra la base', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nn-anime-fachada-'))
    const db = openDb(join(dir, 'nn-anime.db'))
    const queue = createWriteQueue()
    const revalidator = createRevalidator()
    const store = createCatalogStore(db, { queue, revalidator })

    try {
      await store.runMigrations()
      revalidator.schedule('algo', async () => {})

      await store.close()

      expect(revalidator.closed()).toBe(true)
      expect(queue.closed()).toBe(true)
      // Y la base queda cerrada de verdad: consultarla ahora falla.
      expect(() => db.query('SELECT 1').get()).toThrow(/closed|cerrada/)
    } finally {
      cerrarBase(db)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('después de cerrar, escribir falla en vez de tocar una base cerrada', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nn-anime-fachada-'))
    const db = openDb(join(dir, 'nn-anime.db'))
    const store = createCatalogStore(db)

    try {
      await store.runMigrations()
      await store.close()

      await expect(store.writeAnime(AURORA, detalle(AURORA))).rejects.toThrow(/cerrada/)
    } finally {
      cerrarBase(db)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('lo que quedaba en la cola se escribe antes de cerrar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nn-anime-fachada-'))
    const db = openDb(join(dir, 'nn-anime.db'))
    const store = createCatalogStore(db)

    try {
      await store.runMigrations()

      // Cincuenta escrituras encoladas y se cierra sin esperarlas. Si la base se
      // cerrara antes de vaciar la cola, las últimas fallarían por «base
      // cerrada» y no estarían al reabrir: lo que se mide es el orden de los
      // pasos del cierre, no la escritura en sí.
      const pendientes = Array.from({ length: 50 }, (_item, indice) =>
        store.setSetting(`clave-${indice}`, indice),
      )
      await store.close()
      await Promise.all(pendientes.map((promesa) => promesa.catch(() => {})))

      const reabierta = openDb(join(dir, 'nn-anime.db'))

      try {
        const fila = reabierta.query('SELECT COUNT(*) AS total FROM setting').get() as {
          total: number
        }

        expect(fila.total).toBe(50)
      } finally {
        // La reapertura es del test, no del helper: se cierra aquí para que el
        // `rm` de fuera no se encuentre el archivo todavía abierto.
        cerrarBase(reabierta)
      }
    } finally {
      cerrarBase(db)
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('mantenimiento desde la fachada', () => {
  test('runMigrations es idempotente', async () => {
    await withStore(async ({ store }) => {
      const segunda = await store.runMigrations()

      expect(segunda.applied).toEqual([])
      expect(segunda.version).toBeGreaterThan(0)
    })
  })

  test('pruneOrphans informa por tabla y no toca lo vivo', async () => {
    await withStore(async ({ store }) => {
      await store.writeAnimeWithEpisodes(AURORA, detalle(AURORA), episodios(AURORA))
      await store.writeAnimeWithEpisodes(MAR, detalle(MAR), episodios(MAR))
      await store.setFavorite(MAR, true)

      const informe = await store.pruneOrphans(new Date(Date.now() + 400 * 24 * 60 * 60 * 1000))

      expect(informe.deleted.anime).toBe(1)
      expect(informe.deleted.favorite).toBe(0)
      expect(await store.readAnime(AURORA)).toBeNull()
      expect(await store.readAnime(MAR)).not.toBeNull()
    })
  })

  test('los avisos de revalidación se leen desde el mismo sitio', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nn-anime-fachada-'))
    const db = openDb(join(dir, 'nn-anime.db'))
    const store = createCatalogStore(db)

    try {
      await store.runMigrations()
      markRevalidateError(db, 'anime', 'fixture/aurora', 'el proveedor falló')

      expect(db.query('SELECT COUNT(*) AS total FROM revalidate_error').get()).toEqual({ total: 1 })
    } finally {
      await store.close()
      cerrarBase(db)
      await rm(dir, { recursive: true, force: true })
    }
  })
})
