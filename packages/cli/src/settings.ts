/**
 * Aplicación de `config.json` sobre las opciones de la línea de comandos.
 *
 * La precedencia la fija el spec: **las banderas ganan sobre el archivo**. El
 * archivo sólo rellena lo que no se dijo.
 *
 * `open` es el único caso con matiz: su ausencia y su valor por defecto son
 * indistinguibles en las opciones ya analizadas, así que se consulta si la
 * bandera se indicó. Sin eso, un `"open": false` en el archivo no se podría
 * respetar y un `--no-open` no podría ganarle a un `"open": true`.
 */

import type { Settings } from '@nn-anime/core'
import type { CliOptions } from './args'

export function applySettings(options: CliOptions, settings: Settings | undefined): CliOptions {
  if (settings === undefined) return options

  return {
    ...options,
    port: options.port ?? settings.port,
    open: options.openSpecified ? options.open : (settings.open ?? options.open),
    // A partir de aquí el valor de `open` ya es definitivo y no ambiguo.
    openSpecified: true,
    providers: options.providers.length > 0 ? options.providers : (settings.providers ?? []),
    lang: options.lang ?? settings.lang,
    verbose: options.verbose || (settings.verbose ?? false),
  }
}
