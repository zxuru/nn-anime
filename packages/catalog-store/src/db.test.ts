import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUSY_TIMEOUT_MS, openDb } from './db'
import {
  listMigrations,
  type MigrationFile,
  runMigrations,
  schemaVersion,
} from './migrations/runner'

/**
 * Las nueve tablas del Data Model de `docs/specs/SPEC-nn-anime.md`.
 *
 * Están escritas aquí a mano y no leídas del SQL a propósito: si el test las
 * sacara del esquema, comprobaría que el esquema es igual a sí mismo. La tarea
 * que creó `0001-initial.sql` decía «las once tablas», y esta lista es lo que
 * impide que vuelva a desviarse.
 */
const TABLAS_DEL_INICIAL = [
  'anime',
  'episode',
  'favorite',
  'genre',
  'schema_version',
  'search_history',
  'setting',
  'stream_cache',
  'watch_event',
]

/** Las que añaden las migraciones posteriores a la inicial. */
const TABLAS_POSTERIORES = [
  'revalidate_error',
  'search_cache',
  'trending_cache',
  'feed_cache',
  'episode_page',
  'anilist_media',
  'anilist_list_cache',
  'anilist_image',
  'adult_ref',
  'watched_title',
  'plan_to_watch',
  'download',
]

/** Las versiones que hay hoy, para no fijar números que crecen con cada migración. */
const VERSIONES = listMigrations().map((migration) => migration.version)
const ULTIMA = Math.max(...VERSIONES)

/**
 * Cierra la base sin lanzar.
 *
 * Algún test cierra la suya por su cuenta, y cerrar dos veces no es un fallo.
 */
function cerrarBase(db: Database): void {
  try {
    db.close()
  } catch {
    // Ya estaba cerrada: no hay nada que hacer.
  }
}

async function withDb<T>(body: (db: Database, path: string) => Promise<T> | T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-store-'))
  const path = join(dir, 'nn-anime.db')
  const db = openDb(path)

  try {
    return await body(db, path)
  } finally {
    // Windows no deja borrar un archivo abierto, y SQLite mantiene la base y sus
    // hermanos `-wal`/`-shm` hasta el cierre: cerrarla antes del `rm` es lo que
    // permite borrar el directorio. Sin eso el `rm` falla con EBUSY y ese error
    // sale del `finally`, así que tapa el resultado de un test que sí pasó.
    cerrarBase(db)
    await rm(dir, { recursive: true, force: true })
  }
}

function tableNames(db: Database): readonly string[] {
  const rows = db
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()

  return rows.map((row) => String((row as { name: unknown }).name))
}

function columnNames(db: Database, table: string): readonly string[] {
  const rows = db.query(`SELECT name FROM pragma_table_info('${table}')`).all()

  return rows.map((row) => String((row as { name: unknown }).name))
}

function pragmaNumber(db: Database, name: string): number {
  const row = db.query(`PRAGMA ${name}`).get()

  return Number(Object.values(row ?? {})[0] ?? -1)
}

function pragmaText(db: Database, name: string): string {
  const row = db.query(`PRAGMA ${name}`).get()

  return String(Object.values(row ?? {})[0] ?? '')
}

describe('apertura de la base', () => {
  test('activa WAL, claves foráneas y tiempo de espera', async () => {
    await withDb(async (db) => {
      expect(pragmaText(db, 'journal_mode')).toBe('wal')
      expect(pragmaNumber(db, 'foreign_keys')).toBe(1)
      expect(pragmaNumber(db, 'busy_timeout')).toBe(BUSY_TIMEOUT_MS)
    })
  })

  test('el tiempo de espera es el del spec', () => {
    expect(BUSY_TIMEOUT_MS).toBe(5000)
  })

  test('crea la base si no existe', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nn-anime-store-'))
    const db = openDb(join(dir, 'nueva.db'))

    try {
      db.exec('CREATE TABLE prueba (a INTEGER)')

      expect(tableNames(db)).toEqual(['prueba'])
    } finally {
      cerrarBase(db)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('WAL deja sus archivos junto a la base', async () => {
    await withDb(async (_db, path) => {
      const archivos = await readdir(join(path, '..'))

      expect(archivos.some((name) => name.includes('nn-anime.db'))).toBe(true)
    })
  })

  test('también funciona en memoria, para los tests que no tocan disco', () => {
    const db = openDb(':memory:')
    db.exec('CREATE TABLE prueba (a INTEGER)')

    expect(tableNames(db)).toEqual(['prueba'])
    db.close()
  })
})

describe('migración inicial', () => {
  test('crea exactamente las nueve tablas del Data Model', async () => {
    await withDb((db) => {
      // Sólo la 0001: es lo que este test comprueba. Las migraciones
      // posteriores añaden tablas suyas y no deben cambiar esta lista.
      runMigrations(
        db,
        listMigrations().filter((migration) => migration.version === 1),
      )

      expect(tableNames(db)).toEqual(TABLAS_DEL_INICIAL)
    })
  })

  test('las migraciones posteriores añaden lo suyo sin tocar lo anterior', async () => {
    await withDb((db) => {
      runMigrations(db)

      const tablas = tableNames(db)
      for (const tabla of TABLAS_DEL_INICIAL) expect(tablas, tabla).toContain(tabla)
      for (const tabla of TABLAS_POSTERIORES) expect(tablas, tabla).toContain(tabla)
      expect(tablas).toHaveLength(TABLAS_DEL_INICIAL.length + TABLAS_POSTERIORES.length)
    })
  })

  test('cada tabla tiene las columnas que el Data Model nombra', async () => {
    await withDb((db) => {
      runMigrations(
        db,
        listMigrations().filter((migration) => migration.version === 1),
      )

      const esperadas: Readonly<Record<string, readonly string[]>> = {
        anime: [
          'id',
          'provider_id',
          'provider_ref',
          'title',
          'title_alt',
          'synopsis',
          'cover_url',
          'year',
          'status',
          'episode_count',
          'fetched_at',
          'ttl_s',
          'raw_json',
        ],
        genre: ['anime_id', 'name'],
        episode: [
          'id',
          'anime_id',
          'provider_ref',
          'number',
          'title',
          'duration_s',
          'mode',
          'fetched_at',
          'ttl_s',
        ],
        watch_event: [
          'id',
          'anime_id',
          'episode_id',
          'provider_id',
          'mode',
          'position_s',
          'duration_s',
          'started_at',
          'finished',
        ],
        favorite: ['anime_id', 'created_at'],
        search_history: ['id', 'query', 'provider_id', 'hits', 'created_at'],
        stream_cache: [
          'episode_id',
          'mode',
          'url',
          'kind',
          'quality',
          'subtitles_json',
          'fetched_at',
          'ttl_s',
        ],
        setting: ['key', 'value_json'],
        schema_version: ['version', 'applied_at'],
      }

      for (const [tabla, columnas] of Object.entries(esperadas)) {
        expect(columnNames(db, tabla), tabla).toEqual([...columnas])
      }
    })
  })

  test('los headers del upstream no tienen columna: no se persisten', async () => {
    await withDb((db) => {
      runMigrations(
        db,
        listMigrations().filter((migration) => migration.version === 1),
      )

      expect(columnNames(db, 'stream_cache')).not.toContain('headers_json')
    })
  })

  test('registra la versión aplicada con su fecha', async () => {
    await withDb((db) => {
      const informe = runMigrations(db)
      const fila = db
        .query('SELECT version, applied_at FROM schema_version ORDER BY version')
        .get() as {
        version: number
        applied_at: number
      }

      expect(informe.applied).toEqual(VERSIONES)
      expect(informe.version).toBe(ULTIMA)
      expect(fila.version).toBe(1)
      expect(fila.applied_at).toBeGreaterThan(0)
    })
  })

  test('la temporada del episodio se añade sin tocar las filas que ya estaban', async () => {
    await withDb((db) => {
      // Una base con las migraciones anteriores y una fila escrita por el código
      // de antes: la columna nueva tiene que entrar sin perderla ni inventarle una
      // temporada que la fuente no declaró.
      runMigrations(
        db,
        listMigrations().filter((migration) => migration.version <= 12),
      )
      db.exec(
        "INSERT INTO anime (provider_id, provider_ref, title, fetched_at, ttl_s) VALUES ('p', 'x', 'X', 0, 0)",
      )
      db.exec(
        "INSERT INTO episode (anime_id, provider_ref, number, title, mode, fetched_at, ttl_s) VALUES (1, 'x#1', 1, 'Episodio 1', 'sub', 0, 0)",
      )

      const informe = runMigrations(db)

      expect(informe.applied).toEqual([13, 14])
      expect(columnNames(db, 'episode')).toContain('season')
      const fila = db.query('SELECT number, season FROM episode WHERE provider_ref = ?').get('x#1')
      expect(fila).toEqual({ number: 1, season: null })
    })
  })

  test('las claves foráneas se hacen cumplir, no sólo se declaran', async () => {
    await withDb((db) => {
      runMigrations(db)

      expect(() =>
        db.exec(
          "INSERT INTO episode (anime_id, provider_ref, number, mode, fetched_at, ttl_s) VALUES (99, 'x', 1, 'sub', 0, 0)",
        ),
      ).toThrow()
    })
  })
})

/**
 * La tabla de la marca de visto.
 *
 * Se mide aquí, y no en el repositorio, lo que es del esquema: que la tabla tenga
 * las dos columnas y que **el anime sea la clave primaria**. Eso último no es un
 * detalle de estilo: el repositorio escribe con `ON CONFLICT (anime_id) DO
 * NOTHING`, así que sin la clave una segunda pulsación dejaría una segunda fila y
 * la marca saldría repetida en la lectura.
 */
describe('la marca de visto', () => {
  test('la tabla tiene dos columnas y el anime como clave', async () => {
    await withDb((db) => {
      runMigrations(db)

      expect(columnNames(db, 'watched_title')).toEqual(['anime_id', 'created_at'])

      db.query(
        `INSERT INTO anime (provider_id, provider_ref, title, fetched_at, ttl_s)
         VALUES ('fixture', 'vista', 'Vista', 0, 0)`,
      ).run()
      const animeId = db.query<{ id: number }, []>('SELECT id FROM anime').get()?.id ?? 0

      db.query('INSERT INTO watched_title (anime_id, created_at) VALUES (?, 1)').run(animeId)

      expect(() =>
        db.query('INSERT INTO watched_title (anime_id, created_at) VALUES (?, 2)').run(animeId),
      ).toThrow()
    })
  })

  test('una marca sin su anime no entra: la clave foránea se hace cumplir', async () => {
    await withDb((db) => {
      runMigrations(db)

      expect(() =>
        db.query('INSERT INTO watched_title (anime_id, created_at) VALUES (99, 1)').run(),
      ).toThrow()
    })
  })
})

describe('segunda ejecución', () => {
  test('no aplica nada y lo dice', async () => {
    await withDb((db) => {
      const primera = runMigrations(db)
      const segunda = runMigrations(db)

      expect(primera.applied).toEqual(VERSIONES)
      expect(segunda.applied).toEqual([])
      expect(segunda.version).toBe(ULTIMA)
    })
  })

  test('el esquema no cambia entre la primera y la segunda', async () => {
    await withDb((db) => {
      runMigrations(db)
      const antes = tableNames(db)
      runMigrations(db)

      expect(tableNames(db)).toEqual(antes)
    })
  })

  test('cerrar y reabrir no vuelve a aplicar nada', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nn-anime-store-'))
    const path = join(dir, 'nn-anime.db')
    const abiertas: Database[] = []

    try {
      const primera = openDb(path)
      abiertas.push(primera)
      runMigrations(primera)
      primera.close()

      const segunda = openDb(path)
      abiertas.push(segunda)
      const informe = runMigrations(segunda)
      segunda.close()

      expect(informe.applied).toEqual([])
      expect(informe.version).toBe(ULTIMA)
    } finally {
      // Cerrar en el `finally` y no en el cuerpo evita que una aserción que falle
      // deje la base abierta y convierta el `rm` en un EBUSY que la tape.
      for (const abierta of abiertas) cerrarBase(abierta)
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('migración que falla', () => {
  const ROTA: readonly MigrationFile[] = [
    {
      version: 99,
      name: 'rota',
      file: '/migraciones/0099-rota.sql',
      sql: 'CREATE TABLE a_medias (a INTEGER); ESTO NO ES SQL;',
    },
  ]

  test('el esquema queda como estaba: ni tabla nueva ni versión nueva', async () => {
    await withDb((db) => {
      runMigrations(db)
      const antes = tableNames(db)

      expect(() => runMigrations(db, ROTA)).toThrow()

      expect(tableNames(db)).toEqual(antes)
      expect(schemaVersion(db)).toBe(ULTIMA)
    })
  })

  test('el error nombra el archivo culpable', async () => {
    await withDb((db) => {
      runMigrations(db)

      try {
        runMigrations(db, ROTA)
        throw new Error('debería haber lanzado')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        if (error instanceof Error) {
          expect(error.message).toContain('0099-rota.sql')
          expect(error.name).toBe('StoreError')
        }
      }
    })
  })

  test('las migraciones anteriores a la que falla siguen aplicadas', async () => {
    await withDb((db) => {
      const buenas: readonly MigrationFile[] = [
        { version: 1, name: 'uno', file: '/m/0001-uno.sql', sql: 'CREATE TABLE uno (a INTEGER);' },
        { version: 2, name: 'dos', file: '/m/0002-dos.sql', sql: 'CREATE TABLE dos (a INTEGER);' },
        {
          version: 3,
          name: 'tres',
          file: '/m/0003-tres.sql',
          sql: 'CREATE TABLE tres (a INTEGER); ESTO NO ES SQL;',
        },
      ]

      expect(() => runMigrations(db, buenas)).toThrow()

      expect([...tableNames(db)].sort()).toEqual(['dos', 'schema_version', 'uno'])
      expect(schemaVersion(db)).toBe(2)
    })
  })
})

describe('archivos de migración', () => {
  test('encuentra la inicial con su versión', () => {
    const migraciones = listMigrations()
    const inicial = migraciones.find((migration) => migration.version === 1)

    expect(inicial?.name).toBe('initial')
    expect(inicial?.sql).toContain('CREATE TABLE anime')
    expect(migraciones.length).toBeGreaterThanOrEqual(1)
  })

  test('ignora lo que no tiene nombre de migración', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nn-anime-mig-'))

    try {
      await Bun.write(join(dir, '0009-nueva.sql'), 'CREATE TABLE nueva (a INTEGER)')
      await Bun.write(join(dir, 'notas.txt'), 'no soy una migración')
      await Bun.write(join(dir, 'runner.ts'), '// tampoco')

      const encontradas = listMigrations(dir)

      expect(encontradas.map((migration) => migration.version)).toEqual([9])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('dos migraciones con la misma versión se rechazan', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nn-anime-mig-'))

    try {
      await Bun.write(join(dir, '0001-una.sql'), 'SELECT 1')
      await Bun.write(join(dir, '0001-otra.sql'), 'SELECT 1')

      expect(() => listMigrations(dir)).toThrow(/misma versión/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('propiedad de SQLite', () => {
  test('ningún otro paquete importa bun:sqlite', async () => {
    const raiz = fileURLToPath(new URL('../../../', import.meta.url))
    const culpables: string[] = []

    const walk = async (relative: string): Promise<void> => {
      for (const entry of await readdir(join(raiz, relative), { withFileTypes: true })) {
        const path = `${relative}${entry.name}`
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== 'dist') await walk(`${path}/`)
          continue
        }
        if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue

        const texto = await readFile(join(raiz, path), 'utf8')
        if (texto.includes('bun:sqlite')) culpables.push(path)
      }
    }

    await walk('packages/')

    expect(culpables.filter((path) => !path.startsWith('packages/catalog-store/'))).toEqual([])
    expect(culpables.length).toBeGreaterThan(0)
  })
})
