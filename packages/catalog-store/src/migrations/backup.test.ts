/**
 * Copias de seguridad: contenido, rotación y restauración.
 *
 * Lo que se mide aquí es lo que no se puede razonar: que la copia contiene de
 * verdad las filas, que no queda ningún temporal si algo falla y que restaurar
 * devuelve los datos anteriores. La rotación se prueba con un reloj inyectado
 * porque esperar cinco arranques de verdad no prueba nada que no pruebe esto.
 */

import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../db'
import {
  BACKUP_RETENTION,
  backupDatabase,
  backupDirOf,
  listBackups,
  restoreBackup,
  stampOf,
  verifyDatabase,
} from './backup'
import { listMigrations, runMigrations } from './runner'

const ULTIMA = Math.max(...listMigrations().map((migration) => migration.version))

function cerrar(db: Database): void {
  try {
    db.close()
  } catch {
    // Ya estaba cerrada.
  }
}

/** Un directorio temporal con una base ya migrada y una fila de progreso. */
async function conBase<T>(
  body: (db: Database, dir: string, path: string) => Promise<T> | T,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-backup-'))

  try {
    const path = join(dir, 'nn-anime.db')
    const db = openDb(path)
    runMigrations(db)

    try {
      return await body(db, dir, path)
    } finally {
      cerrar(db)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Una fila de anime + episodio + visionado, que es lo que hay que no perder. */
function sembrar(db: Database, positionS = 42): void {
  db.exec(
    "INSERT INTO anime (provider_id, provider_ref, title, fetched_at, ttl_s) VALUES ('fixture', 'aurora', 'Aurora', 0, 0)",
  )
  db.exec(
    "INSERT INTO episode (anime_id, provider_ref, number, title, mode, fetched_at, ttl_s) VALUES (1, 'aurora#1', 1, 'Episodio 1', 'sub', 0, 0)",
  )
  db.query(
    `INSERT INTO watch_event
       (anime_id, episode_id, provider_id, mode, position_s, duration_s, started_at, finished)
     VALUES (1, 1, 'fixture', 'sub', ?, 600, 1700000000000, 0)`,
  ).run(positionS)
}

function filaDeProgreso(path: string): { position_s: number } | null {
  const otra = openDb(path)

  try {
    return otra.query('SELECT position_s FROM watch_event WHERE id = 1').get() as {
      position_s: number
    } | null
  } finally {
    otra.close()
  }
}

describe('la copia antes de migrar', () => {
  test('contiene las filas y el esquema, y se puede abrir', async () => {
    await conBase(async (db, dir, path) => {
      sembrar(db)

      const copia = backupDatabase(db, { dbPath: path })
      expect(copia).toBeDefined()
      if (copia === undefined) return

      expect(join(dir, 'backups')).toBe(backupDirOf(path))
      expect(copia.path.startsWith(join(dir, 'backups'))).toBe(true)
      const archivos = await readdir(join(dir, 'backups'))
      expect(archivos).toHaveLength(1)
      expect(archivos[0]).toBe(copia.path.split(/[\\/]/).pop())

      const verificada = verifyDatabase(copia.path)
      expect(verificada.ok).toBe(true)
      expect(verificada.version).toBe(ULTIMA)

      const rotas = openDb(copia.path)
      try {
        expect(rotas.query('SELECT position_s FROM watch_event WHERE id = 1').get()).toEqual({
          position_s: 42,
        })
      } finally {
        rotas.close()
      }
    })
  })

  test('el nombre lleva la versión y una marca de tiempo ordenable', async () => {
    await conBase((db, _dir, path) => {
      const copia = backupDatabase(db, {
        dbPath: path,
        now: () => new Date('2026-11-08T03:20:00.123Z'),
      })

      expect(copia?.path.endsWith(`-v${String(ULTIMA).padStart(4, '0')}.db`)).toBe(true)
      expect(copia?.path).toContain('nn-anime-backup-20261108T032000123Z')
      expect(stampOf(new Date('2026-11-08T03:20:00.123Z'))).toBe('20261108T032000123Z')
    })
  })

  test('rota: conserva las últimas N y borra las demás', async () => {
    await conBase((db, dir, path) => {
      const horas = [0, 1, 2, 3, 4, 5].map((hora) => new Date(Date.UTC(2026, 10, 8, hora)))

      for (const fecha of horas) {
        backupDatabase(db, { dbPath: path, retention: 3, now: () => fecha })
      }

      const copias = listBackups(join(dir, 'backups'))
      expect(copias).toHaveLength(3)
      expect(copias.map((copia) => copia.stamp)).toEqual([
        '20261108T030000000Z',
        '20261108T040000000Z',
        '20261108T050000000Z',
      ])
      expect(BACKUP_RETENTION).toBe(5)
    })
  })

  test('con una retención mayor que las copias no borra ninguna', async () => {
    await conBase((db, dir, path) => {
      backupDatabase(db, { dbPath: path, retention: 10 })
      backupDatabase(db, { dbPath: path, retention: 10 })

      expect(listBackups(join(dir, 'backups'))).toHaveLength(2)
    })
  })

  test('no deja temporales: o está la copia entera o no está', async () => {
    await conBase(async (db, dir, path) => {
      await writeFile(join(dir, 'basura.tmp'), 'no soy una copia')
      backupDatabase(db, {
        dbPath: path,
        now: () => new Date('2026-11-08T00:00:00.000Z'),
      })

      const archivos = await readdir(join(dir, 'backups'))
      expect(archivos.some((nombre) => nombre.endsWith('.tmp'))).toBe(false)
      expect(archivos.some((nombre) => nombre.startsWith('.nn-anime-backup-'))).toBe(false)
    })
  })

  test('una retención que no es un entero positivo se rechaza', async () => {
    await conBase((db, _dir, path) => {
      expect(() => backupDatabase(db, { dbPath: path, retention: 0 })).toThrow(/entero positivo/)
      expect(() => backupDatabase(db, { dbPath: path, retention: 2.5 })).toThrow(/entero positivo/)
    })
  })

  test('en memoria no hay archivo que copiar', () => {
    const db = openDb(':memory:')
    runMigrations(db)

    try {
      expect(backupDatabase(db)).toBeUndefined()
    } finally {
      db.close()
    }
  })
})

describe('la restauración', () => {
  test('devuelve la base al contenido de la copia', async () => {
    await conBase((db, _dir, path) => {
      sembrar(db)
      const copia = backupDatabase(db, { dbPath: path })
      if (copia === undefined) throw new Error('debería haber copia')

      // Se cambia la base como haría una migración a medias.
      db.exec('DELETE FROM watch_event')
      db.exec('DROP TABLE adult_ref')
      db.close()

      restoreBackup(path, copia.path)

      expect(verifyDatabase(path).ok).toBe(true)
      expect(verifyDatabase(path).version).toBe(ULTIMA)
      expect(filaDeProgreso(path)).toEqual({ position_s: 42 })
    })
  })

  test('no deja el temporal de la restauración', async () => {
    await conBase(async (db, dir, path) => {
      sembrar(db)
      const copia = backupDatabase(db, { dbPath: path })
      if (copia === undefined) throw new Error('debería haber copia')

      // La restauración se hace con la conexión cerrada, como en el arranque.
      db.close()
      restoreBackup(path, copia.path)

      const archivos = await readdir(dir)
      expect(archivos.some((nombre) => nombre.includes('.restore-'))).toBe(false)
      expect(archivos.some((nombre) => nombre.endsWith('-wal'))).toBe(false)
    })
  })

  test('una copia que no es una base válida no pasa la comprobación', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nn-anime-backup-'))

    try {
      const basura = join(dir, 'nn-anime-backup-20260101T000000000Z-v0015.db')
      await writeFile(basura, 'esto no es sqlite')

      expect(() => verifyDatabase(basura)).toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
