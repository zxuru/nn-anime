#!/usr/bin/env bun
/**
 * Comando `bun run db:migrate`.
 *
 * Aplica las migraciones pendientes sobre el directorio de datos real y dice qué
 * hizo. Es el mismo runner que usará el arranque, no una copia: un comando de
 * migración que se comporta distinto que el arranque es una forma silenciosa de
 * tener dos esquemas.
 *
 * Sale con 1 si algo falla, y el error nombra el archivo de la migración. Salir
 * con 0 sin haber migrado nada sería peor que fallar.
 *
 * La lógica vive en `migrate` con todo inyectado, para poder probarla contra un
 * directorio temporal sin tocar el de verdad.
 */

import {
  type MigrateDatabaseOutcome,
  type MigrationReport,
  migrateDatabase,
  openDb,
  runMigrations,
} from '@nn-anime/catalog-store'
import {
  type ConfigEnvironment,
  DEFAULT_LOCALE,
  ensureDirs,
  type Locale,
  loadConfig,
} from '@nn-anime/core'
import { configEnvironment } from './env'
import { t } from './i18n'
import type { CliIO } from './run'

/**
 * La conexión que el store sabe migrar.
 *
 * Se toma de la firma de `runMigrations` en lugar de nombrar el driver: este
 * paquete no importa el módulo de SQLite de Bun, y hay un test que lo comprueba
 * recorriendo todos los paquetes —incluso esta línea, que nombra el módulo sin
 * escribirlo—. Que la base sea un detalle del store es lo que permitiría
 * cambiarla sin tocar el CLI.
 */
export type MigrationTarget = Parameters<typeof runMigrations>[0]

export interface MigrateDeps {
  readonly io: CliIO
  readonly env: ConfigEnvironment
  readonly locale: Locale
  readonly open: (path: string) => MigrationTarget
  readonly migrate: (db: MigrationTarget) => MigrationReport
  /**
   * La migración completa del CLI real: copia antes de migrar y restauración si
   * una falla.
   *
   * Es opcional para que las pruebas sigan pudiendo inyectar un runner de
   * mentira sin una base de verdad. Cuando está, manda sobre `open` y `migrate`,
   * y es lo que usa `bun run db:migrate`: un comando de mantenimiento sin copia
   * sería justo el que más la necesita.
   */
  readonly migratePath?: (dbPath: string) => MigrateDatabaseOutcome
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function migrate(deps: MigrateDeps): Promise<number> {
  const { io, locale } = deps

  let config: ReturnType<typeof loadConfig>
  try {
    config = loadConfig({ env: deps.env })
  } catch (error) {
    io.err(t(locale, 'cli.migrate.failed', { message: describe(error) }))

    return 1
  }

  // Los directorios primero, y esperados: abrir la base en una carpeta que no
  // existe falla con un error que habla de SQLite y no de la carpeta que falta.
  await ensureDirs(config)

  /*
   * El camino real usa `migrateDatabase`: copia antes de migrar y, si una
   * migración falla, restaura la copia. El camino inyectado se queda para las
   * pruebas que no quieren tocar disco y para el error controlado del runner.
   */
  if (deps.migratePath !== undefined) {
    try {
      const resultado = deps.migratePath(config.dbPath)

      if (!resultado.ok) {
        io.err(t(locale, 'cli.migrate.failed', { message: resultado.message }))

        return 1
      }

      const { report } = resultado
      io.out(
        report.applied.length === 0
          ? t(locale, 'cli.migrate.none', { version: report.version })
          : t(locale, 'cli.migrate.applied', {
              versions: report.applied.join(', '),
              version: report.version,
            }),
      )

      if (resultado.backupPath !== undefined) {
        io.out(t(locale, 'cli.migrate.backup', { path: resultado.backupPath }))
      }

      return 0
    } catch (error) {
      io.err(t(locale, 'cli.migrate.failed', { message: describe(error) }))

      return 1
    }
  }

  const db = deps.open(config.dbPath)

  try {
    const informe = deps.migrate(db)

    io.out(
      informe.applied.length === 0
        ? t(locale, 'cli.migrate.none', { version: informe.version })
        : t(locale, 'cli.migrate.applied', {
            versions: informe.applied.join(', '),
            version: informe.version,
          }),
    )

    return 0
  } catch (error) {
    io.err(t(locale, 'cli.migrate.failed', { message: describe(error) }))

    return 1
  } finally {
    db.close()
  }
}

const io: CliIO = {
  out: (line) => {
    process.stdout.write(`${line}\n`)
  },
  err: (line) => {
    process.stderr.write(`${line}\n`)
  },
}

if (import.meta.main) {
  process.exit(
    await migrate({
      io,
      env: configEnvironment(process.env),
      locale: DEFAULT_LOCALE,
      open: openDb,
      migrate: (db) => runMigrations(db),
      migratePath: (dbPath) => migrateDatabase({ dbPath }),
    }),
  )
}
