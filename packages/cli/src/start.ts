/**
 * Arranque del CLI, separado de `index.ts` para poder testearlo.
 *
 * `index.ts` queda como cableado de dependencias reales: procesos, señales y
 * rutas del sistema. Aquí vive la lógica, con todo inyectado, y eso es lo que
 * permite comprobar cosas que de otro modo sólo se pueden razonar — como que la
 * espera de señal se registra **antes** de arrancar el servidor.
 */

import type { ConfigPaths } from '@nn-anime/core'
import { type ConfigEnvironment, type Locale, type Logger, resolveLocale } from '@nn-anime/core'
import type { Session } from '@nn-anime/server'
import type { CliOptions } from './args'
import type {
  BootDeps,
  BootResult,
  Listen,
  LoadPlugins,
  Migrate,
  OpenContainer,
  ReadSettings,
} from './boot'
import { type Lifecycle, signalExitCode, type TerminatingSignal } from './lifecycle'
import type { CliIO } from './run'

export interface StartDeps {
  readonly io: CliIO
  readonly version: string
  /** Idioma del entorno. La bandera `--lang` gana sobre él. */
  readonly envLang: string | undefined
  readonly env: ConfigEnvironment
  /** Origen donde vive la interfaz cuando no es el del server. */
  readonly publicOrigin: string | undefined
  readonly webRoot: string | undefined
  readonly listen: Listen
  readonly migrate: Migrate
  readonly readSettings: ReadSettings
  readonly loadProviders: LoadPlugins
  readonly openContainer: OpenContainer
  /** Versión de mpv detectada al arrancar, si la hay. */
  readonly mpvVersion?: string
  /** Excepción de loopback del proxy, sólo para el e2e. */
  readonly allowLoopback?: boolean
  readonly openUrl: (url: string) => Promise<boolean>
  readonly createSession: () => Session
  readonly createBootToken: () => string
  readonly createLogger: (verbose: boolean) => Logger
  readonly createLifecycle: (onError: (error: unknown) => void) => Lifecycle
  readonly boot: (options: CliOptions, deps: BootDeps) => Promise<BootResult>
  readonly waitForSignal: () => Promise<TerminatingSignal>
}

export function createStarter(deps: StartDeps): (options: CliOptions) => Promise<number> {
  return async (options: CliOptions): Promise<number> => {
    const locale: Locale = resolveLocale(options.lang ?? deps.envLang)
    const logger = deps.createLogger(options.verbose)
    const lifecycle = deps.createLifecycle((error) => {
      logger.warn('falló una tarea de cierre', { cause: error })
    })

    // La espera se registra antes de arrancar nada. Registrarla después deja una
    // ventana en la que un Ctrl+C usa la acción por defecto y se salta el cierre
    // ordenado: hoy no habría daño, pero en T29 dejaría un mpv vivo.
    const signal = deps.waitForSignal()

    const result = await deps.boot(options, {
      io: deps.io,
      version: deps.version,
      locale,
      lifecycle,
      env: deps.env,
      migrate: deps.migrate,
      readSettings: deps.readSettings,
      loadProviders: deps.loadProviders,
      openContainer: deps.openContainer,
      ...(deps.mpvVersion === undefined ? {} : { mpvVersion: deps.mpvVersion }),
      ...(deps.allowLoopback === undefined ? {} : { allowLoopback: deps.allowLoopback }),
      listen: deps.listen,
      createSession: deps.createSession,
      createBootToken: deps.createBootToken,
      openUrl: deps.openUrl,
      publicOrigin: deps.publicOrigin,
      // En desarrollo el proxy apunta a un puerto fijo: mudarse en silencio
      // dejaría la interfaz cargando y la API inalcanzable.
      allowPortFallback: deps.publicOrigin === undefined,
      webRoot: deps.webRoot,
    })

    if (result.code !== 0) return result.code

    // Se registra el puerto, nunca la URL: lleva el token de arranque.
    logger.info('servidor en marcha', { port: result.port })

    const received = await signal
    logger.info('cerrando', { signal: received })
    await lifecycle.shutdown()

    return signalExitCode(received)
  }
}
