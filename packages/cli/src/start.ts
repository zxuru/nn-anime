/**
 * Arranque del CLI, separado de `index.ts` para poder testearlo.
 *
 * `index.ts` queda como cableado de dependencias reales: procesos, señales y
 * rutas del sistema. Aquí vive la lógica, con todo inyectado, y eso es lo que
 * permite comprobar cosas que de otro modo sólo se pueden razonar — como que la
 * espera de señal se registra **antes** de arrancar el servidor.
 */

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
import { t } from './i18n'
import { type ClosingReason, exitCodeFor, type Lifecycle } from './lifecycle'
import type { CliIO } from './run'
import { isLoopbackHost, type ServerEnvResult } from './server-env'

export interface StartDeps {
  readonly io: CliIO
  readonly version: string
  /** Idioma del entorno. La bandera `--lang` gana sobre él. */
  readonly envLang: string | undefined
  readonly env: ConfigEnvironment
  /** El entorno del modo servidor, ya resuelto antes de tocar disco. */
  readonly serverEnv: ServerEnvResult
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
  /**
   * Espera a que alguien pida el cierre: una señal o la línea `shutdown` por la
   * entrada estándar. En Windows lo segundo no es un adorno: no hay `SIGTERM`.
   */
  readonly waitForClose: () => Promise<ClosingReason>
}

export function createStarter(deps: StartDeps): (options: CliOptions) => Promise<number> {
  return async (options: CliOptions): Promise<number> => {
    const locale: Locale = resolveLocale(options.lang ?? deps.envLang)

    // El entorno se valida antes de registrar señales o de tocar la base: un
    // host fuera de loopback sin token no debe llegar ni a migrar. Configurar
    // mal el despliegue y descubrirlo con el servidor ya escuchando es peor.
    if (!deps.serverEnv.ok) {
      deps.io.err(t(locale, deps.serverEnv.error.key, deps.serverEnv.error.params))

      return 1
    }

    const server = deps.serverEnv.value

    // `NN_ANIME_ALLOW_LOOPBACK` abre loopback y redes privadas en la lista
    // blanca del proxy: es una excepción de desarrollo y en un servidor deja la
    // mitigación de SSRF en el suelo. Ahí se niega, no se avisa.
    if (deps.allowLoopback === true && !isLoopbackHost(server.host)) {
      deps.io.err(t(locale, 'cli.env.loopbackOnServer'))

      return 1
    }

    const logger = deps.createLogger(options.verbose)
    const lifecycle = deps.createLifecycle((error) => {
      logger.warn('falló una tarea de cierre', { cause: error })
    })

    // La espera se registra antes de arrancar nada. Registrarla después deja una
    // ventana en la que un Ctrl+C usa la acción por defecto y se salta el cierre
    // ordenado: hoy no habría daño, pero en T29 dejaría un mpv vivo.
    const closing = deps.waitForClose()

    const result = await deps.boot(options, {
      io: deps.io,
      version: deps.version,
      locale,
      lifecycle,
      env: deps.env,
      server,
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
      // En desarrollo el proxy apunta a un puerto fijo; en un servidor el
      // puerto lo fija el despliegue (variable, origen público o Docker). En
      // los dos casos, mudarse de puerto en silencio rompe algo de fuera.
      allowPortFallback:
        deps.publicOrigin === undefined &&
        server.publicOrigin === undefined &&
        server.port === undefined &&
        isLoopbackHost(server.host),
      webRoot: deps.webRoot,
    })

    if (result.code !== 0) return result.code

    // Se registra el puerto, nunca la URL: lleva el token de arranque.
    logger.info('servidor en marcha', {
      port: result.port,
      host: server.host,
      auth: server.token === undefined ? 'local' : 'token',
    })

    const received = await closing
    logger.info('cerrando', { reason: received })
    await lifecycle.shutdown()

    return exitCodeFor(received)
  }
}
