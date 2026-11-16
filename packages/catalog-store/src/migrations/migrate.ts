/**
 * Migrar con copia de seguridad y restauración.
 *
 * `runMigrations` aplica migraciones, pero no puede hacer la copia ni restaurar:
 * para restaurar hay que cerrar la conexión y reemplazar el archivo, y el runner
 * sólo recibe una conexión abierta. Esta es la pieza que sí tiene la ruta y
 * puede hacer las dos cosas.
 *
 * El orden es la garantía:
 *
 * 1. Se mira la versión. Si la base es **más nueva** que este binario, no se
 *    toca: un binario viejo migrando una base nueva le quitaría a la aplicación
 *    lo que la actualización añadió.
 * 2. Si hay migraciones pendientes, se copia la base. Si la copia falla, **no se
 *    migra**: migrar sin red es exactamente lo que este módulo existe para
 *    evitar.
 * 3. Se aplican. Si una falla, se cierra la conexión, se restaura la copia y se
 *    comprueba que abre. La base queda como estaba antes de empezar, con la
 *    versión y los datos anteriores.
 *
 * El resultado no lanza en los fallos esperados: devuelve un valor para que
 * quien arranca decida qué contar. Lo que sí lanza es un fallo al copiar, porque
 * ahí no hay nada que decidir: sin copia no se migra.
 */

import type { Database } from 'bun:sqlite'
import { openDb } from '../db'
import { backupDatabase, restoreBackup, verifyDatabase } from './backup'
import {
  listMigrations,
  type MigrationFile,
  type MigrationReport,
  runMigrations,
  schemaVersion,
} from './runner'

export interface MigrateDatabaseOptions {
  /** La base que se va a migrar. */
  readonly dbPath: string
  /**
   * Las migraciones que conoce este binario. Por defecto, las del paquete.
   *
   * Se inyectan porque el ejecutable compilado las lleva dentro y no están en
   * `import.meta.dir`; y porque probar una migración rota no debe dejar un
   * `.sql` roto en el repositorio.
   */
  readonly migrations?: readonly MigrationFile[]
  /** Copia antes de migrar. Por defecto, sí, en `dataDir/backups`. */
  readonly backup?: {
    readonly enabled?: boolean
    readonly dir?: string
    readonly retention?: number
  }
  /** Apertura de la base, inyectable para poder contar aperturas en un test. */
  readonly open?: (path: string) => Database
  /** Reloj de las copias, inyectable para probar la rotación. */
  readonly now?: () => Date
}

export interface MigrateSuccess {
  readonly ok: true
  readonly report: MigrationReport
  /** La copia que se hizo antes de migrar, si hubo migraciones pendientes. */
  readonly backupPath?: string
}

export interface MigrateFailure {
  readonly ok: false
  readonly message: string
  /**
   * `true` si el fallo fue de una migración **y** se restauró la copia. La base
   * vuelve a la versión anterior con sus datos.
   */
  readonly restored: boolean
  /** La copia que se restauró, si la hubo. */
  readonly backupPath?: string
  /** Versión del esquema con la que se queda la base. */
  readonly version?: number
}

export type MigrateDatabaseOutcome = MigrateSuccess | MigrateFailure

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Aplica las migraciones pendientes con copia previa y restauración si fallan.
 *
 * Abre y cierra su propia conexión: quien necesite la base después, que la
 * abra —el arranque lo hace para el servidor—.
 */
export function migrateDatabase(options: MigrateDatabaseOptions): MigrateDatabaseOutcome {
  const abrir = options.open ?? openDb
  const migrations = [...(options.migrations ?? listMigrations())].sort(
    (a, b) => a.version - b.version,
  )
  const ultima = migrations.length === 0 ? 0 : (migrations[migrations.length - 1]?.version ?? 0)

  let db: Database | undefined = abrir(options.dbPath)

  /** Cierra la conexión y marca el hueco: se llama antes de tocar el archivo. */
  const cerrar = (): void => {
    if (db === undefined) return

    try {
      db.close()
    } catch {
      // Cerrar dos veces no es un fallo que este módulo tenga que contar.
    }

    db = undefined
  }

  try {
    const version = schemaVersion(db)

    /*
     * Una base más nueva que el binario no se migra hacia atrás.
     *
     * Pasa al abrir una copia antigua de la aplicación sobre los datos de una
     * nueva: el binario viejo sólo conoce migraciones que ya están aplicadas y,
     * si se le dejara seguir, el servidor consultaría un esquema que no
     * entiende. Decirlo es lo único honesto.
     */
    if (version > ultima) {
      return {
        ok: false,
        message: `la base está en la versión ${version} y esta aplicación sólo conoce hasta la ${ultima}; actualiza nn-anime en vez de abrir los datos con una versión anterior`,
        restored: false,
        version,
      }
    }

    const pendientes = migrations.filter((migration) => migration.version > version)
    if (pendientes.length === 0) {
      return { ok: true, report: { applied: [], version } }
    }

    let backupPath: string | undefined

    if (options.backup?.enabled !== false) {
      try {
        const copia = backupDatabase(db, {
          ...(options.backup?.dir === undefined ? {} : { dir: options.backup.dir }),
          ...(options.backup?.retention === undefined
            ? {}
            : { retention: options.backup.retention }),
          ...(options.now === undefined ? {} : { now: options.now }),
          dbPath: options.dbPath,
        })
        backupPath = copia?.path
      } catch (cause) {
        return {
          ok: false,
          message: `no se migra sin copia de seguridad: ${describe(cause)}`,
          restored: false,
          version,
        }
      }
    }

    try {
      const report = runMigrations(db, migrations)
      cerrar()

      return backupPath === undefined ? { ok: true, report } : { ok: true, report, backupPath }
    } catch (cause) {
      const mensaje = describe(cause)
      cerrar()

      if (backupPath === undefined) {
        return { ok: false, message: mensaje, restored: false, version }
      }

      try {
        restoreBackup(options.dbPath, backupPath)
        const verificada = verifyDatabase(options.dbPath)

        if (!verificada.ok) {
          return {
            ok: false,
            message: `${mensaje}; la copia ${backupPath} no pasa la comprobación de integridad`,
            restored: false,
            version,
          }
        }

        return {
          ok: false,
          message: `${mensaje}; se restauró la copia ${backupPath} (versión ${verificada.version})`,
          restored: true,
          backupPath,
          version: verificada.version,
        }
      } catch (falloRestaurar) {
        return {
          ok: false,
          message: `${mensaje}; además falló la restauración: ${describe(falloRestaurar)}`,
          restored: false,
          version,
        }
      }
    }
  } finally {
    // Sólo se cierra si sigue abierta: los caminos que restauran ya la cerraron,
    // y cerrar una conexión cerrada taparía el resultado real.
    cerrar()
  }
}
