/**
 * Runner de migraciones.
 *
 * Las migraciones son archivos `NNNN-nombre.sql` numerados, y el runner aplica
 * **sólo los que faltan**, cada uno dentro de su propia transacción, y registra
 * cada versión en `schema_version`.
 *
 * Una transacción por migración y no una para todas: así una migración que falla
 * deja el esquema exactamente como estaba antes de ella, y las anteriores siguen
 * aplicadas y registradas. Con una sola transacción para el lote, un fallo en la
 * tercera borraría también el efecto de las dos primeras, y `schema_version`
 * quedaría diciendo que no se aplicó nada aunque el archivo sí se ejecutó.
 *
 * El error nombra el archivo. «Error near CREATE» sin decir cuál de las
 * migraciones lo causó obliga a mirarlas todas.
 */

import type { Database } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { StoreError } from '@nn-anime/core'

/** Nombre de archivo de una migración: cuatro dígitos, guion y nombre. */
const MIGRATION_NAME = /^(\d{4})-([a-z0-9-]+)\.sql$/

export interface MigrationFile {
  readonly version: number
  readonly name: string
  readonly file: string
  readonly sql: string
}

export interface MigrationReport {
  /** Versiones aplicadas en esta llamada, en orden. Vacío si no había ninguna. */
  readonly applied: readonly number[]
  /** Versión del esquema al terminar. */
  readonly version: number
}

const DEFAULT_DIR = join(import.meta.dir)

/** Los archivos de migración del directorio, en orden de versión. */
export function listMigrations(directory: string = DEFAULT_DIR): readonly MigrationFile[] {
  const encontradas: MigrationFile[] = []

  for (const name of readdirSync(directory).sort()) {
    const match = MIGRATION_NAME.exec(name)
    if (match === null) continue

    const version = Number(match[1])
    encontradas.push({
      version,
      name: match[2] ?? name,
      file: join(directory, name),
      sql: readFileSync(join(directory, name), 'utf8'),
    })
  }

  encontradas.sort((a, b) => a.version - b.version)

  const repetidas = encontradas.filter(
    (migration, index) => index > 0 && encontradas[index - 1]?.version === migration.version,
  )
  if (repetidas.length > 0) {
    throw new StoreError({
      message: `hay dos migraciones con la misma versión: ${repetidas.map((m) => m.file).join(', ')}`,
      scope: 'catalog-store',
      op: 'listMigrations',
    })
  }

  return encontradas
}

function createVersionTable(db: Database): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
  )
}

/** Versión aplicada más alta, o 0 si no hay ninguna. */
export function schemaVersion(db: Database): number {
  createVersionTable(db)
  const row = db.query('SELECT MAX(version) AS version FROM schema_version').get()

  return typeof row === 'object' && row !== null && 'version' in row ? Number(row.version ?? 0) : 0
}

/**
 * Aplica las migraciones pendientes y devuelve qué se hizo.
 *
 * Se pueden inyectar las migraciones para probar un archivo que falla sin dejar
 * un `.sql` roto en el repositorio.
 */
export function runMigrations(
  db: Database,
  migrations: readonly MigrationFile[] = listMigrations(),
): MigrationReport {
  const applied: number[] = []
  const pendientes = [...migrations].sort((a, b) => a.version - b.version)

  for (const migration of pendientes) {
    if (migration.version <= schemaVersion(db)) continue

    const apply = db.transaction(() => {
      db.exec(migration.sql)
      db.query('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        Date.now(),
      )
    })

    try {
      apply()
    } catch (cause) {
      throw new StoreError({
        message: `la migración ${migration.file} falló: ${cause instanceof Error ? cause.message : String(cause)}`,
        scope: 'catalog-store',
        op: 'runMigrations',
        cause,
      })
    }

    applied.push(migration.version)
  }

  return { applied, version: schemaVersion(db) }
}
