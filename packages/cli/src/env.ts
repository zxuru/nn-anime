/**
 * Variables de entorno que lee la aplicación.
 *
 * Se enumeran a mano en lugar de pasar `process.env` entero: así el contrato del
 * entorno es explícito y no se cuela una variable nueva por accidente. Vive en
 * su propio archivo y no en `index.ts` porque hay dos procesos que la necesitan
 * —el arranque y `db:migrate`— y `index.ts` hace trabajo al importarse, así que
 * importarlo para esto ejecutaría el CLI.
 */

import type { ConfigEnvironment } from '@nn-anime/core'

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
    NN_ANIME_DATA_DIR: env.NN_ANIME_DATA_DIR,
    NN_ANIME_CONFIG_DIR: env.NN_ANIME_CONFIG_DIR,
    NN_ANIME_CACHE_DIR: env.NN_ANIME_CACHE_DIR,
    NN_ANIME_LANG: env.NN_ANIME_LANG,
  }
}
