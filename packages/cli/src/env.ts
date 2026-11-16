/**
 * Variables de entorno que lee la aplicación.
 *
 * Se enumeran a mano en lugar de pasar `process.env` entero: así el contrato del
 * entorno es explícito y no se cuela una variable nueva por accidente. Vive en
 * su propio archivo y no en `index.ts` porque hay dos procesos que la necesitan
 * —el arranque y `db:migrate`— y `index.ts` hace trabajo al importarse, así que
 * importarlo para esto ejecutaría el CLI.
 */

import type { ConfigEnvironment } from '@rona/core'

export function configEnvironment(env: NodeJS.ProcessEnv): ConfigEnvironment {
  return {
    HOME: env.HOME,
    // Windows no define `HOME`: su equivalente es `USERPROFILE`, y los dos
    // directorios del perfil son `%APPDATA%` y `%LOCALAPPDATA%`.
    USERPROFILE: env.USERPROFILE,
    APPDATA: env.APPDATA,
    LOCALAPPDATA: env.LOCALAPPDATA,
    XDG_DATA_HOME: env.XDG_DATA_HOME,
    XDG_CONFIG_HOME: env.XDG_CONFIG_HOME,
    XDG_CACHE_HOME: env.XDG_CACHE_HOME,
    RONA_DATA_DIR: env.RONA_DATA_DIR,
    RONA_CONFIG_DIR: env.RONA_CONFIG_DIR,
    RONA_CACHE_DIR: env.RONA_CACHE_DIR,
    RONA_LANG: env.RONA_LANG,
  }
}
