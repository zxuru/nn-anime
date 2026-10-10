#!/usr/bin/env bun
/**
 * Comando `bun run db:prune`.
 *
 * La limpieza de huérfanos, a mano. Es la misma función que usa el arranque
 * cuando la base pasa de 200 MB: un comando manual que hiciera algo distinto que
 * la tarea automática sería una forma silenciosa de tener dos limpiezas.
 *
 * Informa **por tabla**. «Borré 120 filas» no dice si tocó el historial del
 * usuario o sólo la caché de streams, y esa diferencia es la que importa antes
 * de dejar que borre datos ajenos.
 */

import { openDb, pruneOrphans } from '@nn-anime/catalog-store'
import type { PruneReport } from '@nn-anime/core'
import {
  type ConfigEnvironment,
  DEFAULT_LOCALE,
  ensureDirs,
  type Locale,
  loadConfig,
} from '@nn-anime/core'
import type { MigrationTarget } from './db-migrate'
import { configEnvironment } from './env'
import { t } from './i18n'
import type { CliIO } from './run'

export interface PruneDeps {
  readonly io: CliIO
  readonly env: ConfigEnvironment
  readonly locale: Locale
  readonly open: (path: string) => MigrationTarget
  readonly prune: (db: MigrationTarget, now?: Date) => PruneReport
  readonly now?: () => Date
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function prune(deps: PruneDeps): Promise<number> {
  const { io, locale } = deps

  let config: ReturnType<typeof loadConfig>
  try {
    config = loadConfig({ env: deps.env })
  } catch (error) {
    io.err(t(locale, 'cli.prune.failed', { message: describe(error) }))

    return 1
  }

  await ensureDirs(config)
  const db = deps.open(config.dbPath)

  try {
    const informe = deps.prune(db, deps.now?.() ?? new Date())
    const total = Object.values(informe.deleted).reduce((suma, filas) => suma + filas, 0)

    io.out(t(locale, 'cli.prune.total', { total }))

    for (const [tabla, filas] of Object.entries(informe.deleted)) {
      io.out(t(locale, 'cli.prune.table', { table: tabla, rows: filas }))
    }

    return 0
  } catch (error) {
    io.err(t(locale, 'cli.prune.failed', { message: describe(error) }))

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
    await prune({
      io,
      env: configEnvironment(process.env),
      locale: DEFAULT_LOCALE,
      open: openDb,
      prune: (db, now) => pruneOrphans(db, now),
    }),
  )
}
