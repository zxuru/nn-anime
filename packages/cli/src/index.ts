#!/usr/bin/env bun
/**
 * Punto de entrada del CLI.
 *
 * Fase 1: analiza la línea de comandos y resuelve la ayuda, la versión y los
 * errores de uso. El arranque del servidor se cablea en T7, que sustituye el
 * `start` de abajo.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core'
import { version } from '../package.json'
import { t } from './i18n'
import { type CliIO, run } from './run'

const io: CliIO = {
  out: (line) => {
    process.stdout.write(`${line}\n`)
  },
  err: (line) => {
    process.stderr.write(`${line}\n`)
  },
}

const code = await run(Bun.argv.slice(2), {
  io,
  version,
  start: async () => {
    io.err(t(DEFAULT_LOCALE, 'cli.notImplemented'))
    return 1
  },
})

process.exit(code)
