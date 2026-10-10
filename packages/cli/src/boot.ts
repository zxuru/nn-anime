/**
 * Arranque del servidor local.
 *
 * `boot` recibe todas sus dependencias inyectadas —escuchar, migrar, abrir el
 * navegador— porque es la única forma de verificar, sin abrir sockets ni lanzar
 * navegadores, que una migración fallida sale con 3 y que `--no-open` no abre
 * nada.
 *
 * El único puerto que se prueba en serio, con socket de verdad, es el de la
 * caída a puerto libre.
 */

import {
  AppError,
  type ConfigEnvironment,
  type ConfigPaths,
  ensureDirs,
  type Locale,
  loadConfig,
} from '@nn-anime/core'
import { BOOT_PARAM, type RunningServer, type Session, startServer } from '@nn-anime/server'
import type { CliOptions } from './args'
import { t } from './i18n'
import type { Lifecycle } from './lifecycle'
import type { CliIO } from './run'

/** Puerto por defecto del spec. */
export const DEFAULT_PORT = 7717

/** Código de salida cuando la base de datos no se pudo preparar. */
export const MIGRATION_FAILED = 3

export type MigrationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }

export type Migrate = (config: ConfigPaths) => Promise<MigrationOutcome>

export interface ListenOptions {
  readonly session: Session
  readonly bootToken: string
  readonly version: string
}

export interface StartOutcome {
  readonly server: RunningServer
  /** Puerto pedido, cuando hubo que cambiar de puerto por estar ocupado. */
  readonly fellBackFrom: number | undefined
}

export type Listen = (requestedPort: number, options: ListenOptions) => StartOutcome | undefined

/**
 * Escucha en el puerto pedido y, si está ocupado, deja que el sistema elija uno.
 *
 * No se puede saber si un puerto está libre antes de intentarlo: preguntarlo y
 * luego usarlo tiene una carrera. Aquí se intenta y se reacciona al fallo.
 */
export function listenOnFreePort(
  requestedPort: number,
  options: ListenOptions,
): StartOutcome | undefined {
  const attempt = (port: number): RunningServer | undefined => {
    try {
      return startServer({ ...options, port })
    } catch {
      return undefined
    }
  }

  const direct = attempt(requestedPort)
  if (direct !== undefined) return { server: direct, fellBackFrom: undefined }

  const fallback = attempt(0)
  if (fallback === undefined) return undefined

  return { server: fallback, fellBackFrom: requestedPort }
}

export interface BootDeps {
  readonly io: CliIO
  readonly version: string
  readonly locale: Locale
  readonly lifecycle: Lifecycle
  readonly env: ConfigEnvironment
  readonly migrate: Migrate
  readonly listen: Listen
  readonly openUrl: (url: string) => Promise<boolean>
  readonly createSession: () => Session
  readonly createBootToken: () => string
}

export interface BootResult {
  readonly code: number
  /**
   * Dirección de arranque con el token, para abrir el navegador o imprimirla.
   *
   * **No se registra en el log.** La URL lleva el token de arranque, y un log
   * se copia, se guarda y se comparte; la línea que ve el usuario y el
   * navegador que se abre son los dos únicos destinos legítimos.
   */
  readonly url: string | undefined
  /** Puerto real de escucha, que sí es seguro de registrar. */
  readonly port: number | undefined
}

export async function boot(options: CliOptions, deps: BootDeps): Promise<BootResult> {
  const { io, locale } = deps

  let config: ConfigPaths
  try {
    config = loadConfig({
      env: deps.env,
      overrides: { dataDir: options.dataDir, configDir: options.configDir },
    })
  } catch (error) {
    // `loadConfig` ya devuelve el mensaje traducido en el AppError.
    io.err(error instanceof AppError ? error.message : String(error))
    return { code: 1, url: undefined, port: undefined }
  }

  await ensureDirs(config)

  const migration = await deps.migrate(config)
  if (!migration.ok) {
    io.err(t(locale, 'cli.migration.failed', { message: migration.message }))
    return { code: MIGRATION_FAILED, url: undefined, port: undefined }
  }

  const session = deps.createSession()
  const bootToken = deps.createBootToken()

  const outcome = deps.listen(options.port ?? DEFAULT_PORT, {
    session,
    bootToken,
    version: deps.version,
  })

  if (outcome === undefined) {
    io.err(t(locale, 'cli.server.failed'))
    return { code: 1, url: undefined, port: undefined }
  }

  if (outcome.fellBackFrom !== undefined) {
    io.out(t(locale, 'cli.port.busy', { port: outcome.fellBackFrom, chosen: outcome.server.port }))
  }

  const url = `${outcome.server.url}/?${BOOT_PARAM}=${bootToken}`
  io.out(t(locale, 'cli.url', { url }))

  // Se registra antes de abrir el navegador: si abrir falla, el servidor ya
  // tiene que cerrarse igual.
  deps.lifecycle.onShutdown(() => outcome.server.stop())

  if (options.open) {
    const opened = await deps.openUrl(url)
    if (!opened) io.err(t(locale, 'cli.open.failed', { url }))
  }

  return { code: 0, url, port: outcome.server.port }
}
