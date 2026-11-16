/**
 * El motor de migración completo: copia, migración y restauración.
 *
 * Los tests fuerzan una migración rota **inyectada** —no un `.sql` roto en el
 * repositorio— y comprueban lo que importa: que la base vuelve a la versión
 * anterior con sus filas, que la copia existe y que la rotación conserva las
 * últimas. También se mide el camino que no puede fallar en silencio: una base
 * más nueva que el binario no se toca.
 */

import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../db'
import { listBackups, verifyDatabase } from './backup'
import { type MigrateDatabaseOptions, migrateDatabase } from './migrate'
import { listMigrations, type MigrationFile, runMigrations, schemaVersion } from './runner'

const REALES = listMigrations()
const ULTIMA = Math.max(...REALES.map((migration) => migration.version))

function cerrar(db: Database): void {
  try {
    db.close()
  } catch {
    // Ya estaba cerrada.
  }
}

/** Una base temporal con las migraciones hasta `hasta` y datos del usuario. */
async function conBase<T>(
  body: (dir: string, path: string) => Promise<T> | T,
  hasta: number = ULTIMA,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-migrate-db-'))

  try {
    const path = join(dir, 'nn-anime.db')
    const db = openDb(path)

    try {
      runMigrations(
        db,
        REALES.filter((migration) => migration.version <= hasta),
      )
      sembrar(db)
    } finally {
      cerrar(db)
    }

    return await body(dir, path)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function sembrar(db: Database): void {
  const existeAnime = db.query('SELECT id FROM anime WHERE provider_ref = ?').get('aurora')
  if (existeAnime === null) {
    db.exec(
      "INSERT INTO anime (provider_id, provider_ref, title, fetched_at, ttl_s) VALUES ('fixture', 'aurora', 'Aurora', 0, 0)",
    )
  }

  const existeEpisodio = db.query('SELECT id FROM episode WHERE provider_ref = ?').get('aurora#1')
  if (existeEpisodio === null) {
    db.exec(
      "INSERT INTO episode (anime_id, provider_ref, number, title, mode, fetched_at, ttl_s) VALUES (1, 'aurora#1', 1, 'Episodio 1', 'sub', 0, 0)",
    )
  }

  const existeVisionado = db.query('SELECT id FROM watch_event').get()
  if (existeVisionado === null) {
    db.query(
      `INSERT INTO watch_event
         (anime_id, episode_id, provider_id, mode, position_s, duration_s, started_at, finished)
       VALUES (1, 1, 'fixture', 'sub', 42, 600, 1700000000000, 0)`,
    ).run()
  }
}

/** Una migración nueva y buena, para el caso de actualización. */
function migracionNueva(version = ULTIMA + 1): MigrationFile {
  return {
    version,
    name: 'prueba',
    file: `/migraciones/${String(version).padStart(4, '0')}-prueba.sql`,
    sql: `CREATE TABLE prueba_migracion_${version} (id INTEGER PRIMARY KEY, valor TEXT);`,
  }
}

/** Una migración que falla después de haber hecho algo que sí se aplicaría. */
function migracionRota(version = ULTIMA + 1): MigrationFile {
  return {
    version,
    name: 'rota',
    file: `/migraciones/${String(version).padStart(4, '0')}-rota.sql`,
    sql: 'CREATE TABLE a_medias (id INTEGER); ESTO NO ES SQL;',
  }
}

function conOpciones(dir: string, path: string, extra: Partial<MigrateDatabaseOptions> = {}) {
  return migrateDatabase({
    dbPath: path,
    migrations: REALES,
    backup: { dir: join(dir, 'backups') },
    ...extra,
  })
}

describe('actualizar desde la versión anterior', () => {
  test('aplica lo pendiente, guarda la copia y conserva los datos', async () => {
    await conBase(async (dir, path) => {
      const resultado = conOpciones(dir, path)

      expect(resultado.ok).toBe(true)
      if (!resultado.ok) return

      expect(resultado.report.applied).toEqual([ULTIMA])
      expect(resultado.report.version).toBe(ULTIMA)
      expect(resultado.backupPath).toBeDefined()
      if (resultado.backupPath === undefined) return
      expect(verifyDatabase(resultado.backupPath)).toEqual({
        ok: true,
        version: ULTIMA - 1,
      })

      const db = openDb(path)
      try {
        expect(schemaVersion(db)).toBe(ULTIMA)
        expect(db.query('SELECT position_s FROM watch_event WHERE id = 1').get()).toEqual({
          position_s: 42,
        })
      } finally {
        db.close()
      }
    }, ULTIMA - 1)
  })

  test('una base ya al día no se copia', async () => {
    await conBase(async (dir, path) => {
      const resultado = conOpciones(dir, path)

      expect(resultado.ok).toBe(true)
      if (!resultado.ok) return

      expect(resultado.report.applied).toEqual([])
      expect(resultado.backupPath).toBeUndefined()
      expect(listBackups(join(dir, 'backups'))).toEqual([])
    })
  })

  test('la copia conserva la versión desde la que se venía', async () => {
    await conBase(async (dir, path) => {
      const resultado = conOpciones(dir, path, { migrations: [...REALES, migracionNueva()] })

      expect(resultado.ok).toBe(true)
      if (!resultado.ok) return

      expect(resultado.report.applied).toEqual([ULTIMA, ULTIMA + 1])
      expect(resultado.backupPath).toBeDefined()
      if (resultado.backupPath === undefined) return

      expect(verifyDatabase(resultado.backupPath)).toEqual({
        ok: true,
        version: ULTIMA - 1,
      })

      const db = openDb(path)
      try {
        expect(schemaVersion(db)).toBe(ULTIMA + 1)
        expect(db.query('SELECT position_s FROM watch_event WHERE id = 1').get()).toEqual({
          position_s: 42,
        })
      } finally {
        db.close()
      }
    }, ULTIMA - 1)
  })

  test('rota las copias entre actualizaciones', async () => {
    await conBase(async (dir, path) => {
      // Cuatro actualizaciones seguidas sobre la misma base, cada una con su
      // migración inyectada y su reloj, y retención 2.
      let siguiente = ULTIMA + 1
      const conocidas = [...REALES]

      for (let vuelta = 0; vuelta < 4; vuelta++) {
        conocidas.push(migracionNueva(siguiente))
        const resultado = migrateDatabase({
          dbPath: path,
          migrations: conocidas,
          backup: { dir: join(dir, 'backups'), retention: 2 },
          now: () => new Date(Date.UTC(2026, 10, 8, vuelta)),
        })

        expect(resultado.ok).toBe(true)
        siguiente++
      }

      const copias = listBackups(join(dir, 'backups'))
      expect(copias).toHaveLength(2)
      expect(copias.map((copia) => copia.version)).toEqual([ULTIMA + 2, ULTIMA + 3])
    }, ULTIMA)
  })
})

describe('una migración que falla', () => {
  test('restaura la copia y la base arranca con la versión y los datos anteriores', async () => {
    await conBase(async (dir, path) => {
      const resultado = conOpciones(dir, path, {
        migrations: [...REALES, migracionRota()],
      })

      expect(resultado.ok).toBe(false)
      if (resultado.ok) return

      expect(resultado.restored).toBe(true)
      expect(resultado.version).toBe(ULTIMA)
      expect(resultado.message).toContain(String(ULTIMA + 1).padStart(4, '0'))
      expect(resultado.message).toContain('rota.sql')
      expect(resultado.backupPath).toBeDefined()

      // La base tiene que abrir y estar como antes: ni tabla a medias, ni
      // versión nueva, ni datos perdidos.
      const db = openDb(path)
      try {
        expect(verifyDatabase(path).ok).toBe(true)
        expect(schemaVersion(db)).toBe(ULTIMA)
        expect(
          db
            .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'a_medias'")
            .get(),
        ).toBeNull()
        expect(db.query('SELECT position_s FROM watch_event WHERE id = 1').get()).toEqual({
          position_s: 42,
        })
      } finally {
        db.close()
      }
    })
  })

  test('revierte también lo que una migración anterior sí había aplicado', async () => {
    await conBase(async (dir, path) => {
      const buena: MigrationFile = {
        version: ULTIMA + 1,
        name: 'buena',
        file: `/migraciones/${String(ULTIMA + 1).padStart(4, '0')}-buena.sql`,
        sql: 'CREATE TABLE a_medias (id INTEGER);',
      }

      const resultado = conOpciones(dir, path, {
        migrations: [...REALES, buena, migracionRota(ULTIMA + 2)],
      })

      expect(resultado.ok).toBe(false)
      if (resultado.ok) return
      expect(resultado.restored).toBe(true)

      const db = openDb(path)
      try {
        expect(schemaVersion(db)).toBe(ULTIMA)
        expect(
          db
            .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'a_medias'")
            .get(),
        ).toBeNull()
      } finally {
        db.close()
      }
    })
  })

  test('si la copia no se puede hacer, no se migra', async () => {
    await conBase(async (dir, path) => {
      // Un archivo donde tenía que ir el directorio de copias: `mkdir` falla y
      // la migración no debe empezar.
      const noEsDirectorio = join(dir, 'backups')
      await mkdir(join(dir, 'otro'))
      await Bun.write(noEsDirectorio, 'archivo')

      const resultado = migrateDatabase({
        dbPath: path,
        migrations: [...REALES, migracionNueva()],
        backup: { dir: join(noEsDirectorio, 'imposible') },
      })

      expect(resultado.ok).toBe(false)
      if (resultado.ok) return
      expect(resultado.message).toContain('sin copia')

      const db = openDb(path)
      try {
        expect(schemaVersion(db)).toBe(ULTIMA)
      } finally {
        db.close()
      }
    })
  })

  test('un binario viejo no toca una base más nueva', async () => {
    await conBase(async (dir, path) => {
      const resultado = conOpciones(dir, path, {
        migrations: REALES.filter((migration) => migration.version < ULTIMA),
      })

      expect(resultado.ok).toBe(false)
      if (resultado.ok) return
      expect(resultado.restored).toBe(false)
      expect(resultado.version).toBe(ULTIMA)
      expect(resultado.message).toContain('versión')

      const db = openDb(path)
      try {
        expect(schemaVersion(db)).toBe(ULTIMA)
      } finally {
        db.close()
      }
    })
  })

  test('no deja temporales de la restauración en el directorio de datos', async () => {
    await conBase(async (dir, path) => {
      conOpciones(dir, path, { migrations: [...REALES, migracionRota()] })

      const archivos = await readdir(dir)
      expect(archivos.some((nombre) => nombre.includes('.restore-'))).toBe(false)
      expect(archivos.some((nombre) => nombre === 'nn-anime.db-wal')).toBe(false)
    })
  })
})

describe('la copia de seguridad es obligatoria por defecto', () => {
  test('sin copias configuradas se hace una junto a la base', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nn-anime-migrate-db-'))

    try {
      const path = join(dir, 'nn-anime.db')
      const db = openDb(path)
      runMigrations(
        db,
        REALES.filter((migration) => migration.version < ULTIMA),
      )
      db.close()

      const resultado = migrateDatabase({
        dbPath: path,
        migrations: [...REALES, migracionNueva()],
      })

      expect(resultado.ok).toBe(true)
      if (!resultado.ok) return
      expect(resultado.backupPath).toBeDefined()
      expect(listBackups(join(dir, 'backups'))).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
