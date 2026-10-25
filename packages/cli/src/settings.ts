/**
 * Aplicación del entorno y de `config.json` sobre la línea de comandos.
 *
 * La precedencia la fija el spec: **las banderas ganan sobre el archivo**. El
 * entorno se coloca en medio: lo que el despliegue fija por variable
 * (`NN_ANIME_PORT`, `NN_ANIME_NO_OPEN`) no lo pisa un `config.json` que viaja en
 * el volumen, y una bandera explícita sigue ganando sobre los dos.
 *
 * `open` es el único caso con matiz: su ausencia y su valor por defecto son
 * indistinguibles en las opciones ya analizadas, así que se consulta si la
 * bandera se indicó. Sin eso, un `"open": false` en el archivo no se podría
 * respetar y un `--no-open` no podría ganarle a un `"open": true`.
 */

import type { Settings } from '@nn-anime/core'
import type { CliOptions } from './args'

/** Lo que el entorno fija y compite con el archivo. */
export interface SettingsEnvironment {
  readonly port?: number | undefined
  readonly noOpen?: boolean | undefined
}

export function applySettings(
  options: CliOptions,
  settings: Settings | undefined,
  env: SettingsEnvironment = {},
): CliOptions {
  // Sin archivo y sin entorno no hay nada que aplicar: devolver el mismo objeto
  // deja la prueba de identidad y evita marcar `open` como si se hubiera dicho.
  if (settings === undefined && env.port === undefined && env.noOpen !== true) return options

  return {
    ...options,
    port: options.port ?? env.port ?? settings?.port,
    open: options.openSpecified
      ? options.open
      : env.noOpen === true
        ? false
        : (settings?.open ?? options.open),
    // A partir de aquí el valor de `open` ya es definitivo y no ambiguo.
    openSpecified: true,
    providers: options.providers.length > 0 ? options.providers : (settings?.providers ?? []),
    lang: options.lang ?? settings?.lang,
    verbose: options.verbose || (settings?.verbose ?? false),
  }
}
