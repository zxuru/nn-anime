/**
 * El alcance de las lecturas locales, en el módulo.
 *
 * La prueba de integración mide las superficies por HTTP; aquí se mide lo que
 * allí no se puede montar: que el alcance se **recalcule en cada lectura**. El
 * registro de proveedores es vivo —habilitar una casilla en Ajustes no reinicia
 * el proceso—, así que un plugin que llega después tiene que devolver sus filas
 * al instante, y uno que se va, esconderlas.
 *
 * Las siete lecturas se miden **con** el proveedor ausente cargado y sin él: sin
 * el control, una lectura rota que devolviera vacío pasaría por buena.
 */

import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type CatalogStore,
  openDb,
  runMigrations,
  type StoreConnection,
} from '@nn-anime/catalog-store'
import type { Provider } from '@nn-anime/provider-sdk'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { createContainer } from './container'
import { acotarAlmacen } from './provider-scope'

/** El proveedor que se desmarca en Ajustes. Sus filas siguen en la base. */
const AUSENTE = 'ausente'

/** El que sigue cargado, y el que pide las dos lecturas de la ficha. */
const CARGADO = 'cargado'

/** Un instante fijo: las filas no dependen del reloj de la máquina. */
const AHORA = 1_800_000_000_000

/** Una lectura que puede ofrecer una tarjeta, con las referencias que devuelve. */
interface Lectura {
  readonly nombre: string
  readonly ids: (store: CatalogStore) => Promise<readonly string[]>
}

const LECTURAS: readonly Lectura[] = [
  {
    nombre: 'listCandidates',
    ids: async (store) => (await store.listCandidates(50)).map((fila) => fila.ref.providerId),
  },
  {
    nombre: 'listRecentSummaries',
    ids: async (store) => (await store.listRecentSummaries(50)).map((item) => item.ref.providerId),
  },
  {
    nombre: 'searchByGenre',
    ids: async (store) =>
      (await store.searchByGenre('accion', 50)).map((item) => item.ref.providerId),
  },
  {
    nombre: 'listFavorites',
    ids: async (store) => (await store.listFavorites()).map((item) => item.ref.providerId),
  },
  {
    nombre: 'listRecentlyWatched',
    ids: async (store) =>
      (await store.listRecentlyWatched(50)).map((fila) => fila.anime.ref.providerId),
  },
  {
    nombre: 'listRelated',
    ids: async (store) =>
      (await store.listRelated({ providerId: CARGADO, value: 'dandadan' }, 50)).map(
        (item) => item.ref.providerId,
      ),
  },
  {
    nombre: 'listSources',
    ids: async (store) =>
      (await store.listSources({ providerId: CARGADO, value: 'dandadan' }, 50)).map(
        (item) => item.ref.providerId,
      ),
  },
]

/** Un proveedor con el identificador pedido: al alcance sólo le importa el id. */
function proveedor(id: string): Provider {
  return { ...createFixtureProvider(), id }
}

function insertarAnime(
  db: StoreConnection,
  providerId: string,
  ref: string,
  title: string,
  year: number,
  fetchedAt: number,
): number {
  const fila = db
    .query<{ id: number }, [string, string, string, number, number]>(
      `INSERT INTO anime (provider_id, provider_ref, title, year, fetched_at, ttl_s)
       VALUES (?, ?, ?, ?, ?, 3600) RETURNING id`,
    )
    .get(providerId, ref, title, year, fetchedAt)

  return fila?.id ?? 0
}

/**
 * Las filas de las dos fuentes, escritas a mano.
 *
 * Cada lectura tiene con qué: la misma obra en las dos fuentes —«otras fuentes»
 * empareja por título y año—, una tercera entrega que sólo tiene el ausente
 * —«relacionados» empareja por saga—, un género, un visionado a medias y un
 * favorito.
 */
function sembrar(db: StoreConnection): void {
  const cargado = insertarAnime(db, CARGADO, 'dandadan', 'Dandadan', 2024, AHORA)
  const ausenteCompartido = insertarAnime(db, AUSENTE, 'dandadan', 'Dandadan', 2024, AHORA - 1000)
  const cargadoSaga = insertarAnime(
    db,
    CARGADO,
    'dandadan-2',
    'Dandadan 2nd Season',
    2025,
    AHORA - 2000,
  )
  const ausenteSaga = insertarAnime(
    db,
    AUSENTE,
    'dandadan-3',
    'Dandadan 3rd Season',
    2026,
    AHORA - 3000,
  )
  const ausenteSolo = insertarAnime(
    db,
    AUSENTE,
    'koori-no-jouheki',
    'The Ramparts of Ice',
    2026,
    AHORA - 4000,
  )

  for (const animeId of [cargado, ausenteCompartido, cargadoSaga, ausenteSaga, ausenteSolo]) {
    db.query('INSERT INTO genre (anime_id, name) VALUES (?, ?)').run(animeId, 'Acción')
  }

  for (const [animeId, providerId] of [
    [cargado, CARGADO],
    [ausenteSolo, AUSENTE],
  ] as const) {
    const episodio = db
      .query<{ id: number }, [number, string, number]>(
        `INSERT INTO episode (anime_id, provider_ref, number, mode, fetched_at, ttl_s)
         VALUES (?, ?, 1, 'sub', ?, 3600) RETURNING id`,
      )
      .get(animeId, `${providerId}#1`, AHORA)

    db.query(
      `INSERT INTO watch_event
         (anime_id, episode_id, provider_id, mode, position_s, duration_s, started_at, finished)
       VALUES (?, ?, ?, 'sub', 300, 1440, ?, 0)`,
    ).run(animeId, episodio?.id ?? 0, providerId, AHORA)

    db.query('INSERT INTO favorite (anime_id, created_at) VALUES (?, ?)').run(animeId, AHORA)
  }

  // Un título que sólo salió en una búsqueda, sin ficha abierta.
  db.query(
    `INSERT INTO search_cache (provider_id, query, results_json, fetched_at, ttl_s)
     VALUES (?, ?, ?, ?, 3600)`,
  ).run(
    AUSENTE,
    'Sólo por búsqueda',
    JSON.stringify([
      {
        ref: { providerId: AUSENTE, value: 'solo-busqueda' },
        title: 'Sólo por búsqueda',
        year: 2026,
      },
    ]),
    AHORA - 5000,
  )
}

async function conAlmacen<T>(body: (store: CatalogStore) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-alcance-'))
  const db = openDb(join(dir, 'nn-anime.db'))
  runMigrations(db)
  const container = createContainer({ db })
  sembrar(db)

  try {
    return await body(container.store)
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

/** Los proveedores que ofrece cada lectura, ya sin repetir. */
async function idsPorLectura(store: CatalogStore): Promise<Record<string, readonly string[]>> {
  const vistos: Record<string, readonly string[]> = {}

  for (const lectura of LECTURAS) vistos[lectura.nombre] = [...new Set(await lectura.ids(store))]

  return vistos
}

/** Las lecturas donde sale el proveedor pedido. */
function dondeSale(
  vistos: Record<string, readonly string[]>,
  providerId: string,
): readonly string[] {
  return Object.entries(vistos)
    .filter(([, ids]) => ids.includes(providerId))
    .map(([nombre]) => nombre)
}

describe('el alcance de las lecturas locales', () => {
  test('el control: con el proveedor cargado, las siete ofrecen sus filas', async () => {
    await conAlmacen(async (store) => {
      const acotado = acotarAlmacen(store, [proveedor(CARGADO), proveedor(AUSENTE)])

      expect(dondeSale(await idsPorLectura(acotado), AUSENTE)).toEqual(
        LECTURAS.map((l) => l.nombre),
      )
    })
  })

  test('sin el proveedor cargado, ninguna de las siete ofrece sus filas', async () => {
    await conAlmacen(async (store) => {
      const acotado = acotarAlmacen(store, [proveedor(CARGADO)])

      expect(dondeSale(await idsPorLectura(acotado), AUSENTE)).toEqual([])
      // Y no es que las lecturas devuelvan vacío: el cargado sigue saliendo.
      expect(dondeSale(await idsPorLectura(acotado), CARGADO)).toContain('listCandidates')
    })
  })

  test('el alcance se recalcula: cargarlo después devuelve sus filas al instante', async () => {
    await conAlmacen(async (store) => {
      const activos: Provider[] = [proveedor(CARGADO)]
      const acotado = acotarAlmacen(store, activos)

      expect(dondeSale(await idsPorLectura(acotado), AUSENTE)).toEqual([])

      // Es lo que hace `PATCH /api/provider-repos`: el registro se rellena sin
      // reiniciar, y el alcance tiene que verlo en la lectura siguiente.
      activos.push(proveedor(AUSENTE))

      expect(dondeSale(await idsPorLectura(acotado), AUSENTE)).toEqual(
        LECTURAS.map((l) => l.nombre),
      )
    })
  })
})
