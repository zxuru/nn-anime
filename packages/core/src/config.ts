/**
 * Configuración del proceso: rutas de datos, configuración y caché.
 *
 * Precedencia, de mayor a menor: overrides de línea de comandos, variables
 * `NN_ANIME_*`, variables `XDG_*`, valores por defecto de la plataforma.
 *
 * Los valores por defecto **no son los de XDG a secas**: XDG es la convención de
 * Linux y en Windows no existe. Bun no define `HOME` en Windows —sólo
 * `USERPROFILE`—, así que con la convención de Linux no se encontraba ninguna
 * raíz y la aplicación no arrancaba: salía con «no se pudo determinar el
 * directorio personal». En Windows los datos y la caché van a `%LOCALAPPDATA%` y
 * la configuración a `%APPDATA%`, que es donde el sistema dice que van.
 *
 * Este módulo sólo calcula rutas. No crea nada en disco salvo que se llame a
 * `ensureDirs` de forma explícita, para que los tests puedan calcular rutas sin
 * tocar el sistema de archivos.
 */

import { chmod, mkdir } from 'node:fs/promises'
import { isAbsolute, join, parse, resolve } from 'node:path'
import { AppError } from './errors'
import { DEFAULT_LOCALE, t } from './i18n'

/** Nombre del directorio de la aplicación dentro de cada raíz del sistema. */
export const APP_DIR_NAME = 'nn-anime'

export interface ConfigPaths {
  readonly dataDir: string
  readonly configDir: string
  readonly cacheDir: string
  /** Directorio donde el usuario coloca sus plugins de proveedor. */
  readonly providersDir: string
  readonly dbPath: string
  readonly configFile: string
}

export interface ConfigEnvironment {
  readonly HOME?: string | undefined
  /** Lo que Windows define en lugar de `HOME`. */
  readonly USERPROFILE?: string | undefined
  /** Configuración del usuario en Windows: `%APPDATA%`. */
  readonly APPDATA?: string | undefined
  /** Datos locales del usuario en Windows: `%LOCALAPPDATA%`. */
  readonly LOCALAPPDATA?: string | undefined
  readonly XDG_DATA_HOME?: string | undefined
  readonly XDG_CONFIG_HOME?: string | undefined
  readonly XDG_CACHE_HOME?: string | undefined
  readonly NN_ANIME_DATA_DIR?: string | undefined
  readonly NN_ANIME_CONFIG_DIR?: string | undefined
  readonly NN_ANIME_CACHE_DIR?: string | undefined
  readonly NN_ANIME_LANG?: string | undefined
}

export interface ConfigOverrides {
  readonly dataDir?: string | undefined
  readonly configDir?: string | undefined
  readonly cacheDir?: string | undefined
}

export interface LoadConfigOptions {
  readonly env?: ConfigEnvironment
  readonly overrides?: ConfigOverrides
  /**
   * Plataforma cuyas convenciones se aplican. Se inyecta para poder medir las
   * dos desde cualquier máquina; por defecto, la de verdad.
   */
  readonly platform?: string
}

/** Una variable vacía o con sólo espacios no es una respuesta. */
function usable(value: string | undefined): string | undefined {
  if (value === undefined) return undefined

  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * El separador final que sobra, según la plataforma. En Windows una ruta llega
 * con `\` y a veces con `/`; en POSIX, una barra invertida final es parte del
 * nombre del directorio y no se toca.
 */
const TRAILING_SEPARATOR = process.platform === 'win32' ? /[\\/]+$/ : /\/+$/

/**
 * Deja la ruta absoluta y sin separador final. La raíz se conserva entera.
 *
 * La raíz no se toca porque quitarle el separador a `C:\` deja `C:`, que en
 * Windows es «la unidad actual» y no su raíz: la ruta dejaría de ser absoluta
 * sin que se note.
 */
function normalize(path: string): string {
  const absolute = isAbsolute(path) ? path : resolve(path)
  const root = parse(absolute).root
  if (absolute === root) return absolute

  const stripped = absolute.replace(TRAILING_SEPARATOR, '')

  return stripped === '' ? root : stripped
}

interface DirInputs {
  readonly override: string | undefined
  readonly fromEnv: string | undefined
  readonly xdgRoot: string | undefined
  readonly fallback: string | undefined
}

/** Aplica la precedencia para un solo directorio. `undefined` significa que falta la raíz. */
function resolveDir(inputs: DirInputs): string | undefined {
  const override = usable(inputs.override)
  if (override !== undefined) return normalize(override)

  const fromEnv = usable(inputs.fromEnv)
  if (fromEnv !== undefined) return normalize(fromEnv)

  const xdgRoot = usable(inputs.xdgRoot)
  if (xdgRoot !== undefined) return join(normalize(xdgRoot), APP_DIR_NAME)

  return inputs.fallback
}

/** Las raíces del sistema para los tres directorios, según la plataforma. */
interface PlatformRoots {
  readonly data: string | undefined
  readonly config: string | undefined
  readonly cache: string | undefined
}

/**
 * Dónde dice cada plataforma que van los datos, la configuración y la caché.
 *
 * En Windows `%APPDATA%` y `%LOCALAPPDATA%` pueden faltar —un servicio sin
 * perfil cargado—, así que se cuelgan de `USERPROFILE`, que es lo que documenta
 * Microsoft: `%USERPROFILE%\AppData\Roaming` y `%USERPROFILE%\AppData\Local`.
 */
function platformRoots(
  platform: string,
  env: ConfigEnvironment,
  home: string | undefined,
): PlatformRoots {
  const underHome = (suffix: string): string | undefined =>
    home === undefined ? undefined : join(home, suffix)

  if (platform === 'win32') {
    const local = usable(env.LOCALAPPDATA) ?? underHome(join('AppData', 'Local'))
    const roaming = usable(env.APPDATA) ?? underHome(join('AppData', 'Roaming'))

    return {
      data: local === undefined ? undefined : join(local, APP_DIR_NAME),
      config: roaming === undefined ? undefined : join(roaming, APP_DIR_NAME),
      // La caché es desechable y local a la máquina: no viaja con el perfil.
      cache: local === undefined ? undefined : join(local, APP_DIR_NAME, 'cache'),
    }
  }

  return {
    data: underHome(join('.local', 'share', APP_DIR_NAME)),
    config: underHome(join('.config', APP_DIR_NAME)),
    cache: underHome(join('.cache', APP_DIR_NAME)),
  }
}

export function loadConfig(options: LoadConfigOptions = {}): ConfigPaths {
  const env = options.env ?? {}
  const overrides = options.overrides ?? {}
  // `USERPROFILE` es el `HOME` de Windows, donde Bun no define `HOME`.
  const home = usable(env.HOME) ?? usable(env.USERPROFILE)
  const roots = platformRoots(options.platform ?? process.platform, env, home)

  const dataDir = resolveDir({
    override: overrides.dataDir,
    fromEnv: env.NN_ANIME_DATA_DIR,
    xdgRoot: env.XDG_DATA_HOME,
    fallback: roots.data,
  })

  const configDir = resolveDir({
    override: overrides.configDir,
    fromEnv: env.NN_ANIME_CONFIG_DIR,
    xdgRoot: env.XDG_CONFIG_HOME,
    fallback: roots.config,
  })

  const cacheDir = resolveDir({
    override: overrides.cacheDir,
    fromEnv: env.NN_ANIME_CACHE_DIR,
    xdgRoot: env.XDG_CACHE_HOME,
    fallback: roots.cache,
  })

  const missing = [
    dataDir === undefined ? 'dataDir' : undefined,
    configDir === undefined ? 'configDir' : undefined,
    cacheDir === undefined ? 'cacheDir' : undefined,
  ].filter((name): name is string => name !== undefined)

  if (dataDir === undefined || configDir === undefined || cacheDir === undefined) {
    const list = missing.join(', ')
    throw new AppError({
      code: 'config',
      message: t(DEFAULT_LOCALE, 'error.config.missingHome', { dirs: list }),
      context: { missing: list },
      scope: 'config',
      op: 'loadConfig',
    })
  }

  return {
    dataDir,
    configDir,
    cacheDir,
    providersDir: join(configDir, 'providers'),
    dbPath: join(dataDir, 'nn-anime.db'),
    configFile: join(configDir, 'config.json'),
  }
}

/**
 * Crea los directorios que la aplicación necesita, con modo `0700` y de forma
 * idempotente. Devuelve la lista de rutas aseguradas, en orden.
 *
 * `mkdir` no toca el modo de un directorio que ya existe, así que el modo se
 * aplica con `chmod` después. Si no se puede cerrar un directorio que estaba
 * más abierto, esto falla en lugar de seguir: la aplicación no arranca con los
 * datos a la vista de otros usuarios. **Eso vale en POSIX**, donde el modo es la
 * garantía; en Windows el `chmod` sólo toca el bit de sólo lectura y un fallo
 * ahí no se propaga (ver el `catch` de abajo).
 *
 * El `0700` es una garantía POSIX. En Windows los permisos son ACLs y `chmod`
 * sólo toca el bit de sólo lectura, así que ahí lo que se asegura es que el
 * directorio queda escribible por su dueño; quién más puede entrar lo decide la
 * ACL que hereda de `%LOCALAPPDATA%`, que ya es del usuario.
 */
export async function ensureDirs(config: ConfigPaths): Promise<readonly string[]> {
  const dirs = [config.dataDir, config.configDir, config.cacheDir, config.providersDir]

  const fallos: string[] = []

  for (const dir of dirs) {
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 })

      try {
        await chmod(dir, 0o700)
      } catch (error) {
        // En Windows `chmod` no son permisos: sólo toca el bit de sólo lectura, y
        // quién puede entrar lo decide la ACL que el directorio hereda de
        // `%LOCALAPPDATA%`, que ya es del usuario. Abortar aquí no protege nada y
        // deja la aplicación sin arrancar en cuanto el proceso no puede cambiar
        // atributos —un perfil restringido, una carpeta administrada, un contenedor—.
        // En POSIX sí se aborta: ahí el `0700` **es** la garantía de que nadie más
        // entra, y seguir con los datos a la vista sería peor que no arrancar.
        if (process.platform !== 'win32') throw error
      }
    } catch (error) {
      // Se sigue con los demás para poder decir **todas** las rutas que fallaron,
      // con su ruta absoluta y su error concreto. Quedarse en la primera obliga a
      // arreglar, reintentar y descubrir la siguiente, y en el registro del
      // anfitrión —que es donde acaba esto— no hay consola donde preguntar.
      fallos.push(`${dir}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (fallos.length > 0) {
    throw new Error(`no se pudieron preparar directorios:\n  ${fallos.join('\n  ')}`)
  }

  return dirs
}
