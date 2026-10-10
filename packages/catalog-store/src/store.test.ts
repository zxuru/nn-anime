import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnimeDetail, Episode, ProviderRef, WatchEventInput } from '@nn-anime/core'
import { z } from 'zod'
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
    await store.close().catch(() => {})
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
      const fila = reabierta.query('SELECT COUNT(*) AS total FROM setting').get() as {
        total: number
      }
      reabierta.close()

      expect(fila.total).toBe(50)
    } finally {
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
      await rm(dir, { recursive: true, force: true })
    }
  })
})
