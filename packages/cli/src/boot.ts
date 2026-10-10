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
  type Result,
  type Settings,
} from '@nn-anime/core'
import { BOOT_PARAM, type RunningServer, type Session, startServer } from '@nn-anime/server'
import type { CliOptions } from './args'
import { t } from './i18n'
import type { Lifecycle } from './lifecycle'
import type { CliIO } from './run'
import { applySettings } from './settings'

/** Puerto por defecto del spec. */
export const DEFAULT_PORT = 7717

/** Código de salida cuando la base de datos no se pudo preparar. */
export const MIGRATION_FAILED = 3

export type MigrationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }

export type Migrate = (config: ConfigPaths) => Promise<MigrationOutcome>

/** Lee los ajustes de proceso. Se inyecta para poder probar la precedencia. */
export type ReadSettings = (path: string) => Promise<Result<Settings | undefined, AppError>>

export interface ListenOptions {
  readonly session: Session
  readonly bootToken: string
  readonly version: string
  /** Build de la interfaz, si existe. Sin él el server sólo expone la API. */
  readonly webRoot?: string | undefined
  /** Ruta local a la que ir tras canjear el token. */
  readonly redirectTo?: string | undefined
  /**
   * Si el puerto pedido está ocupado, ¿se puede usar otro?
   *
   * En desarrollo no: el proxy de Vite apunta a un puerto fijo, así que mudarse
   * de puerto en silencio dejaría la interfaz cargando y todas las llamadas a la
   * API fallando por conexión. Ahí es mejor fallar de forma ruidosa.
   */
  readonly allowPortFallback?: boolean | undefined
}

export type ListenOutcome =
  | {
      readonly ok: true
      readonly server: RunningServer
      /** Puerto pedido, cuando hubo que cambiar de puerto por estar ocupado. */
      readonly fellBackFrom: number | undefined
    }
  | {
      readonly ok: false
      readonly kind: 'port-busy' | 'other'
      readonly detail: string
    }

export type Listen = (requestedPort: number, options: ListenOptions) => ListenOutcome

/** `EADDRINUSE` es lo único que justifica reintentar en otro puerto. */
export function isPortBusy(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return false

  return cause.code === 'EADDRINUSE'
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Escucha en el puerto pedido y, si está ocupado, deja que el sistema elija uno.
 *
 * No se puede saber si un puerto está libre antes de intentarlo: preguntarlo y
 * luego usarlo tiene una carrera. Aquí se intenta y se reacciona al fallo.
 */
export function listenOnFreePort(requestedPort: number, options: ListenOptions): ListenOutcome {
  const attempt = (port: number): ListenOutcome => {
    try {
      return { ok: true, server: startServer({ ...options, port }), fellBackFrom: undefined }
    } catch (cause) {
      // No se reintenta a ciegas: un puerto fuera de rango o un fallo al montar
      // la aplicación no se arreglan cambiando de puerto, y decirlo sería mentir
      // sobre la causa. Sólo un puerto ocupado justifica probar otro.
      return {
        ok: false,
        kind: isPortBusy(cause) ? 'port-busy' : 'other',
        detail: describeCause(cause),
      }
    }
  }

  const direct = attempt(requestedPort)
  if (direct.ok) return direct
  if (direct.kind === 'other') return direct
  if (options.allowPortFallback === false) return direct

  const fallback = attempt(0)
  if (fallback.ok) return { ok: true, server: fallback.server, fellBackFrom: requestedPort }

  return fallback
}

/**
 * Destino tras el canje.
 *
 * Si el usuario arrancó con una consulta, la aplicación abre directamente su
 * búsqueda: es el caso de uso de `ani-cli` y un criterio de éxito del spec.
 * `encodeURIComponent` evita que la consulta se coma el resto de la URL.
 */
export function redirectTarget(query: string | undefined): string | undefined {
  if (query === undefined || query === '') return undefined

  return `/search?q=${encodeURIComponent(query)}`
}

export interface BootDeps {
  readonly io: CliIO
  readonly version: string
  readonly locale: Locale
  readonly lifecycle: Lifecycle
  readonly env: ConfigEnvironment
  readonly migrate: Migrate
  readonly readSettings: ReadSettings
  readonly listen: Listen
  readonly openUrl: (url: string) => Promise<boolean>
  /**
   * Origen donde vive la interfaz, cuando no es el del server.
   *
   * En desarrollo la SPA la sirve Vite en otro puerto y su proxy reenvía el
   * canje al server. El navegador debe abrir Vite, no el server, para que la
   * cookie quede en el origen que hace las peticiones.
   */
  readonly publicOrigin?: string | undefined
  /** Directorio del build de la interfaz que sirve el server. */
  readonly webRoot?: string | undefined
  /**
   * Si el puerto pedido está ocupado, ¿se puede usar otro? Por defecto sí.
   *
   * Quien fija `publicOrigin` tiene un proxy apuntando a un puerto concreto y
   * debe pasar `false`: mudarse de puerto rompería el proxy en silencio.
   */
  readonly allowPortFallback?: boolean | undefined
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

export async function boot(rawOptions: CliOptions, deps: BootDeps): Promise<BootResult> {
  const { io, locale } = deps

  let config: ConfigPaths
  try {
    config = loadConfig({
      env: deps.env,
      overrides: { dataDir: rawOptions.dataDir, configDir: rawOptions.configDir },
    })
  } catch (error) {
    // `loadConfig` ya devuelve el mensaje traducido en el AppError.
    io.err(error instanceof AppError ? error.message : String(error))
    return { code: 1, url: undefined, port: undefined }
  }

  await ensureDirs(config)

  // Paso 2 del arranque del spec: cargar `config.json` si existe, con las
  // banderas ganando sobre el archivo. Un archivo ilegible o inválido es un
  // error ruidoso: arrancar con los valores por defecto dejaría al usuario
  // preguntándose por qué no se aplicó su configuración.
  const settings = await deps.readSettings(config.configFile)
  if (!settings.ok) {
    io.err(t(locale, 'cli.settings.invalid', { message: settings.error.message }))
    return { code: 1, url: undefined, port: undefined }
  }

  const options = applySettings(rawOptions, settings.value)

  const migration = await deps.migrate(config)
  if (!migration.ok) {
    io.err(t(locale, 'cli.migration.failed', { message: migration.message }))
    return { code: MIGRATION_FAILED, url: undefined, port: undefined }
  }

  const session = deps.createSession()
  const bootToken = deps.createBootToken()

  const requestedPort = options.port ?? DEFAULT_PORT
  const outcome = deps.listen(requestedPort, {
    session,
    bootToken,
    version: deps.version,
    webRoot: deps.webRoot,
    redirectTo: redirectTarget(options.query),
    allowPortFallback: deps.allowPortFallback,
  })

  if (!outcome.ok) {
    io.err(
      outcome.kind === 'port-busy'
        ? t(locale, 'cli.port.busyBlocked', { port: requestedPort, detail: outcome.detail })
        : t(locale, 'cli.server.failed', { detail: outcome.detail }),
    )
    return { code: 1, url: undefined, port: undefined }
  }

  if (outcome.fellBackFrom !== undefined) {
    io.out(t(locale, 'cli.port.busy', { port: outcome.fellBackFrom, chosen: outcome.server.port }))
  }

  const origin = deps.publicOrigin ?? outcome.server.url
  const url = `${origin}/?${BOOT_PARAM}=${bootToken}`
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
