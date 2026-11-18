import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnimeDetail, Episode, ProviderRef, WatchEventInput } from '@rona/core'
import { z } from 'zod'
import { openDb } from './db'
import { runMigrations } from './migrations/runner'
import {
  PRUNE_AFTER_DAYS,
  PRUNE_SIZE_THRESHOLD_BYTES,
  PRUNED_TABLES,
  pruneOrphans,
  shouldPrune,
} from './prune'
import { createAnimeRepository } from './repositories/anime'
import { createEpisodesRepository } from './repositories/episodes'
import { createFavoritesRepository } from './repositories/favorites'
import { createPlanToWatchRepository } from './repositories/plan-to-watch'
import { createSettingsRepository } from './repositories/settings'
import { createStreamRepository } from './repositories/stream'
import { createWatchRepository } from './repositories/watch'
import { createWatchedTitlesRepository } from './repositories/watched-titles'

const DAY = 24 * 60 * 60 * 1000
const AHORA = new Date('2026-10-10T12:00:00.000Z').getTime()

function ref(valor: string): ProviderRef {
  return { providerId: 'fixture', value: valor }
}

function detalle(providerRef: ProviderRef): AnimeDetail {
  return {
    ref: providerRef,
    title: `Título ${providerRef.value}`,
    year: 2019,
    kind: 'tv',
    genres: ['Acción', 'Fantasía'],
    studios: ['Estudio Cobre'],
  }
}

function episodio(providerRef: ProviderRef): Episode {
  return {
    ref: { providerId: 'fixture', value: `${providerRef.value}#1` },
    animeRef: providerRef,
    number: 1,
    mode: 'sub',
  }
}

function visionado(providerRef: ProviderRef, cuando: number): WatchEventInput {
  return {
    animeRef: providerRef,
    episodeRef: { providerId: 'fixture', value: `${providerRef.value}#1` },
    mode: 'sub',
    positionS: 10,
    durationS: 1440,
    startedAt: new Date(cuando),
  }
}

interface Store {
  readonly db: Database
  readonly anime: ReturnType<typeof createAnimeRepository>
  readonly episodios: ReturnType<typeof createEpisodesRepository>
}

/** Cierra la base sin lanzar: algún test la cierra por su cuenta. */
function cerrarBase(db: Database): void {
  try {
    db.close()
  } catch {
    // Ya estaba cerrada: no hay nada que hacer.
  }
}

async function withStore<T>(body: (store: Store) => Promise<T> | T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'rona-prune-'))
  const db = openDb(join(dir, 'rona.db'))

  try {
    runMigrations(db)
    return await body({
      db,
      anime: createAnimeRepository(db),
      episodios: createEpisodesRepository(db),
    })
  } finally {
    // Windows no deja borrar un archivo abierto, y SQLite mantiene la base y sus
    // `-wal`/`-shm` hasta el cierre: cerrarla antes del `rm` es lo que permite
    // borrar el directorio sin un EBUSY que tape el resultado del test.
    cerrarBase(db)
    await rm(dir, { recursive: true, force: true })
  }
}

/** Deja un título con su episodio y un stream cacheados en la fecha indicada. */
function sembrar(store: Store, providerRef: ProviderRef, cuando: number): void {
  store.anime.write(providerRef, detalle(providerRef), cuando)
  store.episodios.write(providerRef, [episodio(providerRef)], cuando)
  createStreamRepository(store.db).write(
    { episodeRef: { providerId: 'fixture', value: `${providerRef.value}#1` }, mode: 'sub' },
    [{ url: `https://fixture.invalid/${providerRef.value}.m3u8`, kind: 'hls' }],
    cuando,
  )
}

function cuenta(db: Database, tabla: string): number {
  const fila = db.query(`SELECT COUNT(*) AS total FROM ${tabla}`).get() as { total: number }

  return fila.total
}

describe('ajustes', () => {
  test('sin fila devuelve el valor por defecto', async () => {
    await withStore((store) => {
      const ajustes = createSettingsRepository(store.db)

      expect(ajustes.get('tema', z.enum(['oscuro', 'claro']), 'oscuro')).toBe('oscuro')
      expect(ajustes.get('limite', z.number(), 20)).toBe(20)
    })
  })

  test('guarda y lee JSON de cualquier forma', async () => {
    await withStore((store) => {
      const ajustes = createSettingsRepository(store.db)
      ajustes.set('tema', 'claro')
      ajustes.set('limite', 50)
      ajustes.set('filas', ['una', 'dos'])
      ajustes.set('objeto', { anidado: true })

      expect(ajustes.get('tema', z.enum(['oscuro', 'claro']), 'oscuro')).toBe('claro')
      expect(ajustes.get('limite', z.number(), 20)).toBe(50)
      expect(ajustes.get('filas', z.array(z.string()), [])).toEqual(['una', 'dos'])
      expect(ajustes.get('objeto', z.object({ anidado: z.boolean() }), { anidado: false })).toEqual(
        {
          anidado: true,
        },
      )
    })
  })

  test('escribir dos veces la misma clave actualiza', async () => {
    await withStore((store) => {
      const ajustes = createSettingsRepository(store.db)
      ajustes.set('tema', 'oscuro')
      ajustes.set('tema', 'claro')

      expect(cuenta(store.db, 'setting')).toBe(1)
      expect(ajustes.get('tema', z.string(), '')).toBe('claro')
    })
  })

  test('un valor con otra forma devuelve el valor por defecto, no una mentira', async () => {
    await withStore((store) => {
      const ajustes = createSettingsRepository(store.db)
      ajustes.set('limite', 'cincuenta')

      expect(ajustes.get('limite', z.number(), 20)).toBe(20)
    })
  })

  test('un JSON ilegible no impide arrancar', async () => {
    await withStore((store) => {
      const ajustes = createSettingsRepository(store.db)
      store.db.query("INSERT INTO setting (key, value_json) VALUES ('roto', '{no es json')").run()

      expect(ajustes.get('roto', z.number(), 7)).toBe(7)
    })
  })
})

describe('umbral de tamaño', () => {
  test('por debajo del umbral no se limpia', () => {
    expect(shouldPrune(0)).toBe(false)
    expect(shouldPrune(PRUNE_SIZE_THRESHOLD_BYTES)).toBe(false)
  })

  test('por encima sí, y el umbral es el del spec', () => {
    expect(shouldPrune(PRUNE_SIZE_THRESHOLD_BYTES + 1)).toBe(true)
    expect(PRUNE_SIZE_THRESHOLD_BYTES).toBe(200 * 1024 * 1024)
  })

  test('con la base de verdad, el tamaño se mide en disco', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rona-prune-'))
    const path = join(dir, 'rona.db')
    const db = openDb(path)

    try {
      runMigrations(db)
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      const info = await stat(path)

      // Una base recién creada cabe de sobra: lo que se comprueba es que el
      // umbral se aplica sobre bytes reales y no sobre una suposición.
      expect(shouldPrune(info.size)).toBe(false)
    } finally {
      cerrarBase(db)
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('limpieza de huérfanos', () => {
  test('borra el stream vencido hace más de un día', async () => {
    await withStore((store) => {
      sembrar(store, ref('viejo'), AHORA - 2 * DAY)

      const informe = pruneOrphans(store.db, new Date(AHORA))

      // El stream tiene TTL de 600 s, así que venció hace dos días.
      expect(informe.deleted.stream_cache).toBe(1)
      expect(cuenta(store.db, 'stream_cache')).toBe(0)
    })
  })

  test('poda las demás cachés TTL y devuelve el disco con VACUUM', async () => {
    await withStore((store) => {
      const insertar = store.db.query(
        `INSERT INTO search_cache (provider_id, query, results_json, fetched_at, ttl_s)
         VALUES (?, ?, ?, ?, ?)`,
      )
      const relleno = JSON.stringify([{ title: 'x'.repeat(1024) }])

      for (let indice = 0; indice < 400; indice += 1) {
        insertar.run('fixture', `consulta-${indice}`, relleno, AHORA - 2 * DAY, 600)
      }

      store.db
        .query(
          `INSERT INTO aniskip_cache (cache_key, intervals_json, found, fetched_at, ttl_s)
           VALUES ('k', '[]', 0, ?, 600)`,
        )
        .run(AHORA - 2 * DAY)
      store.db
        .query(
          `INSERT INTO search_history (query, provider_id, hits, created_at)
           VALUES ('vieja', 'fixture', 1, ?)`,
        )
        .run(AHORA - (PRUNE_AFTER_DAYS + 1) * DAY)

      const paginas = (): number => {
        const fila = store.db.query<{ page_count: number }, []>('PRAGMA page_count').get()

        return fila?.page_count ?? 0
      }

      const antes = paginas()
      const informe = pruneOrphans(store.db, new Date(AHORA))

      expect(informe.deleted.search_cache).toBe(400)
      expect(informe.deleted.aniskip_cache).toBe(1)
      expect(informe.deleted.search_history).toBe(1)
      expect(cuenta(store.db, 'search_cache')).toBe(0)
      expect(paginas()).toBeLessThan(antes)
    })
  })

  test('las portadas conocidas caducan con el mismo plazo que el detalle', async () => {
    await withStore((store) => {
      const insertar = store.db.query(
        `INSERT INTO known_cover (provider_id, provider_ref, url, updated_at)
         VALUES ('fixture', ?, 'https://fixture.invalid/p.webp', ?)`,
      )
      insertar.run('antigua', AHORA - (PRUNE_AFTER_DAYS + 1) * DAY)
      insertar.run('reciente', AHORA - DAY)

      const informe = pruneOrphans(store.db, new Date(AHORA))

      expect(informe.deleted.known_cover).toBe(1)
      expect(cuenta(store.db, 'known_cover')).toBe(1)
      expect(store.db.query('SELECT provider_ref FROM known_cover').get()).toEqual({
        provider_ref: 'reciente',
      })
    })
  })

  test('los títulos conocidos caducan con el mismo plazo que la portada', async () => {
    await withStore((store) => {
      const insertar = store.db.query(
        `INSERT INTO known_title
           (provider_id, provider_ref, title, title_alt, cover_url, year, kind, updated_at)
         VALUES ('fixture', ?, 'T', NULL, NULL, NULL, NULL, ?)`,
      )
      insertar.run('antigua', AHORA - (PRUNE_AFTER_DAYS + 1) * DAY)
      insertar.run('reciente', AHORA - DAY)

      const informe = pruneOrphans(store.db, new Date(AHORA))

      // La tabla que evita el barrido no puede crecer sin tope: la consulta de
      // relacionados la recorre entera.
      expect(informe.deleted.known_title).toBe(1)
      expect(cuenta(store.db, 'known_title')).toBe(1)
      expect(store.db.query('SELECT provider_ref FROM known_title').get()).toEqual({
        provider_ref: 'reciente',
      })
    })
  })

  test('no borra un stream vencido hace unas horas: el margen es de un día', async () => {
    await withStore((store) => {
      // El título está fresco, pero su stream venció hace dos horas: dentro del
      // margen de un día. Sin el margen, esta fila se borraría.
      sembrar(store, ref('reciente'), AHORA)
      createStreamRepository(store.db).write(
        { episodeRef: { providerId: 'fixture', value: 'reciente#1' }, mode: 'sub' },
        [{ url: 'https://fixture.invalid/reciente.m3u8', kind: 'hls' }],
        AHORA - 2 * 60 * 60 * 1000 - 600 * 1000,
      )

      const informe = pruneOrphans(store.db, new Date(AHORA))

      expect(informe.deleted.stream_cache).toBe(0)
      expect(cuenta(store.db, 'stream_cache')).toBe(1)
    })
  })

  test('borra un detalle sin actividad en 90 días, con sus episodios y géneros', async () => {
    await withStore((store) => {
      sembrar(store, ref('antiguo'), AHORA - (PRUNE_AFTER_DAYS + 1) * DAY)

      const informe = pruneOrphans(store.db, new Date(AHORA))

      expect(informe.deleted.anime).toBe(1)
      expect(informe.deleted.episode).toBe(1)
      expect(informe.deleted.genre).toBe(2)
      expect(cuenta(store.db, 'anime')).toBe(0)
      expect(cuenta(store.db, 'episode')).toBe(0)
    })
  })

  test('no toca un anime visto hace 5 días', async () => {
    await withStore((store) => {
      // El detalle se cacheó hace 100 días, pero se vio hace 5.
      sembrar(store, ref('visto'), AHORA - 100 * DAY)
      const watch = createWatchRepository(store.db)
      watch.recordWatch(visionado(ref('visto'), AHORA - 5 * DAY))

      const informe = pruneOrphans(store.db, new Date(AHORA))

      expect(informe.deleted.anime).toBe(0)
      expect(cuenta(store.db, 'anime')).toBe(1)
      expect(cuenta(store.db, 'watch_event')).toBe(1)
    })
  })

  test('un visionado viejo no protege: 91 días no es «sin actividad» reciente', async () => {
    await withStore((store) => {
      sembrar(store, ref('olvidado'), AHORA - 200 * DAY)
      createWatchRepository(store.db).recordWatch(visionado(ref('olvidado'), AHORA - 91 * DAY))

      const informe = pruneOrphans(store.db, new Date(AHORA))

      expect(informe.deleted.anime).toBe(1)
      expect(informe.deleted.watch_event).toBe(1)
    })
  })

  test('un favorito nunca se limpia, aunque no se haya visto nunca', async () => {
    await withStore((store) => {
      sembrar(store, ref('favorito'), AHORA - 500 * DAY)
      createFavoritesRepository(store.db).setFavorite(ref('favorito'), true)

      const informe = pruneOrphans(store.db, new Date(AHORA))

      expect(informe.deleted.anime).toBe(0)
      expect(cuenta(store.db, 'anime')).toBe(1)
      expect(cuenta(store.db, 'favorite')).toBe(1)
    })
  })

  test('un detalle reciente de 89 días se queda', async () => {
    await withStore((store) => {
      sembrar(store, ref('justo'), AHORA - (PRUNE_AFTER_DAYS - 1) * DAY)

      const informe = pruneOrphans(store.db, new Date(AHORA))

      expect(informe.deleted.anime).toBe(0)
    })
  })

  test('una obra marcada como vista nunca se limpia, aunque no tenga un solo visionado', async () => {
    await withStore((store) => {
      // Una película vista fuera de la aplicación: nadie reprodujo nada aquí, así
      // que la única cosa que la protege es la marca.
      sembrar(store, ref('vista-fuera'), AHORA - 500 * DAY)
      createWatchedTitlesRepository(store.db).setWatchedTitle(ref('vista-fuera'), true)

      const informe = pruneOrphans(store.db, new Date(AHORA))

      expect(informe.deleted.anime).toBe(0)
      expect(cuenta(store.db, 'anime')).toBe(1)
      expect(cuenta(store.db, 'watched_title')).toBe(1)
    })
  })

  test('una obra pendiente nunca se limpia, aunque lleve meses sin reproducirse', async () => {
    await withStore((store) => {
      // El caso extremo de la protección: algo guardado para verlo más adelante
      // puede llevar mucho tiempo sin un solo visionado, y es justo lo que no se
      // puede perder. Sin la guarda, la poda se lo lleva con el detalle.
      sembrar(store, ref('pendiente'), AHORA - 500 * DAY)
      createPlanToWatchRepository(store.db).setPlanToWatch(ref('pendiente'), true)

      const informe = pruneOrphans(store.db, new Date(AHORA))

      expect(informe.deleted.anime).toBe(0)
      expect(cuenta(store.db, 'anime')).toBe(1)
      expect(cuenta(store.db, 'plan_to_watch')).toBe(1)
    })
  })

  test('el informe lleva todas las tablas, con cero las que no tocó', async () => {
    await withStore((store) => {
      sembrar(store, ref('antiguo'), AHORA - 400 * DAY)

      const informe = pruneOrphans(store.db, new Date(AHORA))

      expect(Object.keys(informe.deleted).sort()).toEqual([...PRUNED_TABLES].sort())
      expect(informe.deleted.anime).toBe(1)
      expect(informe.deleted.watch_event).toBe(0)
      expect(informe.deleted.favorite).toBe(0)
      expect(informe.deleted.watched_title).toBe(0)
    })
  })

  test('sin nada que limpiar devuelve ceros y no falla', async () => {
    await withStore((store) => {
      const informe = pruneOrphans(store.db, new Date(AHORA))

      expect(informe.deleted.stream_cache).toBe(0)
      expect(informe.deleted.anime).toBe(0)
      expect(Object.values(informe.deleted).every((total) => total === 0)).toBe(true)
    })
  })

  test('limpia varios a la vez y conserva lo que sigue vivo', async () => {
    await withStore((store) => {
      sembrar(store, ref('viejo-1'), AHORA - 200 * DAY)
      sembrar(store, ref('viejo-2'), AHORA - 300 * DAY)
      sembrar(store, ref('vivo'), AHORA - 2 * DAY)

      const informe = pruneOrphans(store.db, new Date(AHORA))

      expect(informe.deleted.anime).toBe(2)
      expect(cuenta(store.db, 'anime')).toBe(1)
      expect(cuenta(store.db, 'episode')).toBe(1)
    })
  })

  test('borra también los streams de los episodios que se van', async () => {
    await withStore((store) => {
      // El stream se cachea con la fecha del detalle, muy antigua.
      sembrar(store, ref('antiguo'), AHORA - 400 * DAY)
      // Y se renueva justo antes de limpiar: vencido, pero dentro del margen.
      createStreamRepository(store.db).write(
        { episodeRef: { providerId: 'fixture', value: 'antiguo#1' }, mode: 'sub' },
        [{ url: 'https://fixture.invalid/renovado.m3u8', kind: 'hls' }],
        AHORA - 2 * 60 * 60 * 1000,
      )

      const informe = pruneOrphans(store.db, new Date(AHORA))

      expect(informe.deleted.stream_cache).toBe(1)
      expect(cuenta(store.db, 'stream_cache')).toBe(0)
      expect(cuenta(store.db, 'anime')).toBe(0)
    })
  })
})
