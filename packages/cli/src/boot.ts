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
  formatBootLine,
  type Locale,
  loadConfig,
  RECOMMENDED_PROVIDER_REPO,
  type Result,
  type Settings,
} from '@nn-anime/core'
import type { LoadReport } from '@nn-anime/provider-sdk'
import {
  BOOT_PARAM,
  enabledProviderFiles,
  type PluginReport,
  type RunningServer,
  type ServerContainer,
  type Session,
  startServer,
} from '@nn-anime/server'
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
  | {
      readonly ok: true
      /** Algo que contar tras migrar, como una limpieza que se hizo al pasar. */
      readonly note?: string
    }
  | {
      readonly ok: false
      readonly message: string
      /**
       * Ruta absoluta de la base que no se pudo abrir, cuando el fallo es de ella.
       *
       * Existe para que el mensaje diga **dónde** falló y no sólo qué dijo SQLite:
       * `unable to open database file` sin la ruta no permite distinguir un
       * directorio que no existe de uno sin permisos.
       */
      readonly path?: string
    }

export type Migrate = (config: ConfigPaths) => Promise<MigrationOutcome>

/** Lee los ajustes de proceso. Se inyecta para poder probar la precedencia. */
export type ReadSettings = (path: string) => Promise<Result<Settings | undefined, AppError>>

/**
 * Carga los plugins del directorio del usuario y los archivos habilitados de los
 * repositorios.
 *
 * Se inyecta por el mismo motivo que el resto: sin esto habría que escribir
 * plugins de verdad en el disco del usuario para probar el arranque, y el
 * informe de rechazos —que es lo que el usuario necesita leer— no se podría
 * provocar desde una prueba.
 *
 * Los archivos van aparte del directorio porque son otra cosa: los elige el
 * usuario uno a uno desde Ajustes y viven en la carpeta de datos.
 */
export type LoadPlugins = (directory: string, files: readonly string[]) => Promise<LoadReport>

/**
 * Abre el store del server.
 *
 * Se inyecta porque abrir la base es del cableado real: `boot` no sabe de rutas
 * del sistema, y una prueba del arranque no tiene por qué crear una.
 */
export type OpenContainer = (config: ConfigPaths) => ServerContainer | undefined

export interface ListenOptions {
  /** Rutas en uso, para la página de ajustes. */
  readonly paths?: ConfigPaths | undefined
  /** Versión de mpv detectada al arrancar, si la hay. */
  readonly mpvVersion?: string
  /** Excepción de loopback del proxy, sólo para el e2e. */
  readonly allowLoopback?: boolean | undefined
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
  /**
   * Los plugins cargados, para que `/api/providers` y la búsqueda tengan qué
   * servir. Sin esto el server arrancaría con la lista vacía y las dos rutas
   * existirían para no devolver nada.
   */
  readonly plugins?: PluginReport | undefined
  /**
   * Directorio de plugins del usuario.
   *
   * Es lo que habilita el alta desde Ajustes: el server escribe ahí el plugin
   * generado y vuelve a leer el directorio para que quede activo sin reiniciar.
   * Sin esta ruta, la ruta de alta no se registra.
   */
  readonly providersDir?: string | undefined
  /**
   * El store del server, si hay uno.
   *
   * Sin él, las rutas de metadatos no se registran: una petición a `/api/anime`
   * sería un 404 explicable en vez de un 500 por dentro. El arranque real siempre
   * lo trae; las pruebas que no quieren una base, no.
   */
  readonly container?: ServerContainer | undefined
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
export function redirectTarget(
  query: string | undefined,
  providers: readonly string[] = [],
): string | undefined {
  const parts: string[] = []
  if (query !== undefined && query !== '') parts.push(`q=${encodeURIComponent(query)}`)
  // El filtro de proveedor viaja en la misma dirección. Sin esto, `--provider`
  // se analiza, se fusiona desde config.json y no lo usa nadie: el mismo defecto
  // que tenía la consulta posicional.
  for (const provider of providers) parts.push(`provider=${encodeURIComponent(provider)}`)

  return parts.length === 0 ? undefined : `/search?${parts.join('&')}`
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
  readonly loadProviders: LoadPlugins
  readonly openContainer: OpenContainer
  /** Versión de mpv detectada al arrancar, si la hay. */
  readonly mpvVersion?: string
  /** Excepción de loopback del proxy, sólo para el e2e. */
  readonly allowLoopback?: boolean
}

/**
 * La línea que dice qué proveedores entraron y cuáles no.
 *
 * El rechazo se imprime con su motivo y con el archivo: un plugin que no carga
 * es un problema del usuario, y lo único que puede hacer al respecto es saber
 * cuál es y por qué.
 */
function reportPlugins(io: CliIO, locale: Locale, report: LoadReport, providersDir: string): void {
  if (report.directoryError !== undefined) {
    io.err(t(locale, 'cli.providers.directory', { message: report.directoryError.message }))
  }

  const ids = report.active.map((entry) => entry.provider.id)
  io.out(
    ids.length === 0
      ? t(locale, 'cli.providers.none', {
          dir: providersDir,
          repo: RECOMMENDED_PROVIDER_REPO,
        })
      : t(locale, 'cli.providers.active', { list: ids.join(', ') }),
  )

  for (const rejected of report.rejected) {
    io.err(t(locale, 'cli.providers.rejected', { message: rejected.reason.message }))
  }
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

  try {
    await ensureDirs(config)
  } catch (error) {
    // Sin este `try`, un directorio que no se puede crear subía como rechazo sin
    // manejar y el único rastro era un volcado. El mensaje ya trae cada ruta
    // absoluta con su error, así que el registro del anfitrión lo dice entero.
    io.err(
      t(locale, 'cli.dirs.failed', {
        message: error instanceof Error ? error.message : String(error),
      }),
    )
    io.err(t(locale, 'cli.migration.failedPath', { path: config.dbPath, message: '—' }))

    return { code: 1, url: undefined, port: undefined }
  }

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

  // El orden de aquí abajo es una decisión y no una casualidad: **migrar, abrir
  // la base, leer qué repositorios están habilitados y sólo entonces cargar los
  // plugins**. La selección vive en la tabla de ajustes, así que leerla antes de
  // migrar sería consultar una tabla que puede no existir todavía; y cargar los
  // plugins antes de leerla dejaría fuera, en silencio, a todos los proveedores
  // de repositorios.
  const migration = await deps.migrate(config)
  if (!migration.ok) {
    io.err(
      migration.path === undefined
        ? t(locale, 'cli.migration.failed', { message: migration.message })
        : t(locale, 'cli.migration.failedPath', {
            path: migration.path,
            message: migration.message,
          }),
    )
    return { code: MIGRATION_FAILED, url: undefined, port: undefined }
  }

  // Lo que la migración quiera contar —una limpieza que se hizo al pasar— se
  // imprime aquí y no dentro de ella: quien migra no sabe de idiomas ni de
  // salidas.
  if (migration.note !== undefined) io.out(migration.note)

  const container = deps.openContainer(config)
  if (container !== undefined) {
    // El cierre de la base va con el del servidor: cerrarla antes deja en el aire
    // las escrituras que el server tuviera a medias.
    deps.lifecycle.onShutdown(() => container.close())
  }

  // Sin contenedor no hay ajustes que leer, y eso es lo que usan las pruebas que
  // montan el arranque sin base: se cargan los del directorio, como siempre.
  const enabled =
    container === undefined ? [] : await enabledProviderFiles(container.store, config.dataDir)

  // Paso 4 del arranque del spec: cargar los plugins. Un plugin roto se
  // reporta y se omite, pero no impide arrancar: el usuario puede seguir usando
  // la interfaz con los que sí funcionan.
  const plugins = await deps.loadProviders(config.providersDir, enabled)

  const session = deps.createSession()
  const bootToken = deps.createBootToken()

  const requestedPort = options.port ?? DEFAULT_PORT
  const outcome = deps.listen(requestedPort, {
    session,
    bootToken,
    version: deps.version,
    webRoot: deps.webRoot,
    redirectTo: redirectTarget(options.query, options.providers),
    allowPortFallback: deps.allowPortFallback,
    plugins: { active: plugins.active, rejected: plugins.rejected },
    // Las rutas las tiene `boot`, que es quien llamó a `loadConfig`.
    paths: config,
    providersDir: config.providersDir,
    ...(deps.mpvVersion === undefined ? {} : { mpvVersion: deps.mpvVersion }),
    ...(deps.allowLoopback === undefined ? {} : { allowLoopback: deps.allowLoopback }),
    ...(container === undefined ? {} : { container }),
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

  // Paso 8 del arranque del spec: la URL y la lista de proveedores activos.
  io.out(t(locale, 'cli.url', { url }))
  // Y la misma dirección en la línea que lee un programa. Va aquí, con la humana,
  // porque las dos dicen lo mismo: el formato vive en `core` y lo consume el
  // `smoke` del paquete, que es quien arranca el ejecutable y necesita saber dónde
  // escucha. No se traduce y no se registra en el log.
  io.out(formatBootLine({ port: outcome.server.port, url }))
  reportPlugins(io, locale, plugins, config.providersDir)

  // Se registra antes de abrir el navegador: si abrir falla, el servidor ya
  // tiene que cerrarse igual.
  deps.lifecycle.onShutdown(() => outcome.server.stop())

  if (options.open) {
    const opened = await deps.openUrl(url)
    if (!opened) io.err(t(locale, 'cli.open.failed', { url }))
  }

  return { code: 0, url, port: outcome.server.port }
}
