/**
 * Orquestación del CLI, separada de `index.ts` para poder testearla.
 *
 * `start` se inyecta: así el arranque real del servidor (T7) no impide
 * verificar que `--help` no arranca nada y que un error de uso sale con 2.
 */

import { resolveLocale } from '@nn-anime/core'
import { type CliOptions, parseArgs } from './args'
import { t } from './i18n'

export interface CliIO {
  readonly out: (line: string) => void
  readonly err: (line: string) => void
}

export interface RunDeps {
  readonly io: CliIO
  /** Arranca el servidor y devuelve el código de salida final. */
  readonly start: (options: CliOptions) => Promise<number>
  readonly version: string
}

/**
 * Extrae el idioma pedido sin analizar el resto de la línea.
 *
 * Hace falta para traducir un error de uso: cuando el análisis falla no hay
 * opciones, pero el idioma puede estar ahí y el error debe salir traducido.
 */
function requestedLocale(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === undefined) break
    if (arg.startsWith('--lang=')) return arg.slice('--lang='.length)
    if (arg === '--lang') return argv[index + 1]
  }

  return undefined
}

export async function run(argv: readonly string[], deps: RunDeps): Promise<number> {
  const locale = resolveLocale(requestedLocale(argv))
  const parsed = parseArgs(argv)

  if (!parsed.ok) {
    deps.io.err(t(locale, parsed.error.key, parsed.error.params))
    return parsed.error.exitCode
  }

  const options = parsed.value
  const chosen = resolveLocale(options.lang)

  if (options.help) {
    deps.io.out(t(chosen, 'cli.help.body'))
    return 0
  }

  if (options.version) {
    deps.io.out(t(chosen, 'cli.version', { version: deps.version }))
    return 0
  }

  return deps.start(options)
}
