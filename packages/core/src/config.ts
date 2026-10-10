/**
 * Configuración del proceso: rutas de datos, configuración y caché.
 *
 * Precedencia, de mayor a menor: overrides de línea de comandos, variables
 * `NN_ANIME_*`, variables `XDG_*`, valores por defecto bajo `HOME`.
 *
 * Este módulo sólo calcula rutas. No crea nada en disco salvo que se llame a
 * `ensureDirs` de forma explícita, para que los tests puedan calcular rutas sin
 * tocar el sistema de archivos.
 */

import { chmod, mkdir } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { AppError } from './errors'
import { DEFAULT_LOCALE, t } from './i18n'

/** Nombre del directorio de la aplicación dentro de cada raíz XDG. */
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
}

/** Una variable vacía o con sólo espacios no es una respuesta. */
function usable(value: string | undefined): string | undefined {
  if (value === undefined) return undefined

  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Deja la ruta absoluta y sin barras finales. La raíz se conserva entera. */
function normalize(path: string): string {
  const absolute = isAbsolute(path) ? path : resolve(path)
  const stripped = absolute.replace(/\/+$/, '')

  return stripped === '' ? '/' : stripped
}

interface DirInputs {
  readonly override: string | undefined
  readonly fromEnv: string | undefined
  readonly xdgRoot: string | undefined
  readonly fallback: string | undefined
}

/** Aplica la precedencia para un solo directorio. `undefined` significa que falta HOME. */
function resolveDir(inputs: DirInputs): string | undefined {
  const override = usable(inputs.override)
  if (override !== undefined) return normalize(override)

  const fromEnv = usable(inputs.fromEnv)
  if (fromEnv !== undefined) return normalize(fromEnv)

  const xdgRoot = usable(inputs.xdgRoot)
  if (xdgRoot !== undefined) return join(normalize(xdgRoot), APP_DIR_NAME)

  return inputs.fallback
}

export function loadConfig(options: LoadConfigOptions = {}): ConfigPaths {
  const env = options.env ?? {}
  const overrides = options.overrides ?? {}
  const home = usable(env.HOME)

  const underHome = (suffix: string): string | undefined =>
    home === undefined ? undefined : join(home, suffix, APP_DIR_NAME)

  const dataDir = resolveDir({
    override: overrides.dataDir,
    fromEnv: env.NN_ANIME_DATA_DIR,
    xdgRoot: env.XDG_DATA_HOME,
    fallback: underHome('.local/share'),
  })

  const configDir = resolveDir({
    override: overrides.configDir,
    fromEnv: env.NN_ANIME_CONFIG_DIR,
    xdgRoot: env.XDG_CONFIG_HOME,
    fallback: underHome('.config'),
  })

  const cacheDir = resolveDir({
    override: overrides.cacheDir,
    fromEnv: env.NN_ANIME_CACHE_DIR,
    xdgRoot: env.XDG_CACHE_HOME,
    fallback: underHome('.cache'),
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
 * datos a la vista de otros usuarios.
 */
export async function ensureDirs(config: ConfigPaths): Promise<readonly string[]> {
  const dirs = [config.dataDir, config.configDir, config.cacheDir, config.providersDir]

  for (const dir of dirs) {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await chmod(dir, 0o700)
  }

  return dirs
}
