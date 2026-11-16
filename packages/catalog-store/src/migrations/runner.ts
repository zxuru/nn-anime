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

/**
 * Lo que una migración **no** puede traer: control de transacciones.
 *
 * El runner mete cada archivo en su propia transacción. Un `BEGIN` dentro del
 * archivo abre una transacción anidada que SQLite rechaza, y un `COMMIT` cerraría
 * la del runner a la mitad: la versión se anotaría en una transacción y las
 * tablas en otra. Se detecta antes de ejecutar y se dice qué archivo es.
 */
const TRANSACTION_CONTROL = /^\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i

/** Quita comentarios de SQL para que una palabra prohibida en un comentario no cuente. */
export function sinComentarios(sql: string): string {
  return sql
    .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((linea) => {
      const corte = linea.indexOf('--')

      return corte === -1 ? linea : linea.slice(0, corte)
    })
    .join('\n')
}

/**
 * La primera sentencia de control de transacciones que trae un archivo, si la
 * trae. Pura y exportada para poder medirla sin base de datos.
 */
export function transactionControl(sql: string): string | undefined {
  for (const sentencia of sinComentarios(sql).split(';')) {
    if (TRANSACTION_CONTROL.test(sentencia)) return sentencia.trim()
  }

  return undefined
}

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

  /*
   * Las versiones tienen que empezar en 1 y no saltarse ninguna.
   *
   * Un hueco no es cosmético: el runner compara `version > schemaVersion`, así
   * que con `0001` y `0003` la 3 se aplicaría sobre un esquema al que le falta
   * la 2 y la base quedaría a medio construir. Un archivo renombrado o borrado
   * por error deja exactamente ese hueco, y es mejor decirlo al listar que
   * descubrirlo con un «no such column» dentro de una ruta.
   */
  const huecos = encontradas.filter((migration, index) => migration.version !== index + 1)
  if (huecos.length > 0) {
    const primera = huecos[0]
    throw new StoreError({
      message: `las migraciones tienen que ser 1, 2, 3… sin huecos; la primera que no cuadra es ${primera?.file ?? '(desconocida)'}`,
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
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      throw new StoreError({
        message: `la migración ${migration.file} tiene una versión que no es un entero positivo: ${migration.version}`,
        scope: 'catalog-store',
        op: 'runMigrations',
      })
    }
  }

  const maxima = pendientes.reduce((mayor, migration) => Math.max(mayor, migration.version), 0)
  const actual = schemaVersion(db)

  /*
   * Una base más nueva que las migraciones que conoce este binario no se toca.
   *
   * Es la mitad del seguro contra abrir datos de una versión nueva con un
   * binario viejo: sin esta comprobación, el binario viejo aplicaría las que le
   * faltan —ninguna— y seguiría como si la base fuera suya. El motor de
   * `migrateDatabase` lo comprueba antes y además copia; aquí queda para quien
   * llame al runner directamente.
   */
  if (actual > maxima) {
    throw new StoreError({
      message: `la base está en la versión ${actual} y estas migraciones sólo llegan a la ${maxima}; no se toca una base más nueva`,
      scope: 'catalog-store',
      op: 'runMigrations',
    })
  }

  for (const migration of pendientes) {
    if (migration.version <= schemaVersion(db)) continue

    // Antes de ejecutar: un control de transacción dentro del archivo rompería
    // la transacción por migración. Se dice el archivo y la sentencia.
    const control = transactionControl(migration.sql)
    if (control !== undefined) {
      throw new StoreError({
        message: `la migración ${migration.file} trae control de transacciones («${control}»); el runner ya envuelve cada archivo en la suya`,
        scope: 'catalog-store',
        op: 'runMigrations',
      })
    }

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
