#!/usr/bin/env bun
/**
 * Punto de entrada del CLI.
 *
 * Cablea el arranque real: base de datos, sesión, servidor en `127.0.0.1`,
 * apertura del navegador y cierre ordenado ante una señal.
 *
 * La migración es un marcador que devuelve éxito. La implementación real llega
 * en T16 con `catalog-store`; el contrato ya está aquí para que el código de
 * salida 3 esté verificado desde ahora.
 */

import { type ConfigEnvironment, createLogger, resolveLocale } from '@nn-anime/core'
import { createBootToken, createSession } from '@nn-anime/server'
import { version } from '../package.json'
import { boot, listenOnFreePort, type Migrate } from './boot'
import { createLifecycle, signalExitCode, waitForSignal } from './lifecycle'
import { openInBrowser } from './open-browser'
import { type CliIO, run } from './run'

const io: CliIO = {
  out: (line) => {
    process.stdout.write(`${line}\n`)
  },
  err: (line) => {
    process.stderr.write(`${line}\n`)
  },
}

/** Marcador hasta T16: todavía no hay base de datos que migrar. */
const migrate: Migrate = async () => ({ ok: true })

/**
 * Enumera las variables que lee la aplicación.
 *
 * Se copian a mano en lugar de pasar `process.env` entero: así el contrato del
 * entorno es explícito y no se cuela una variable nueva por accidente.
 */
function configEnvironment(env: NodeJS.ProcessEnv): ConfigEnvironment {
  return {
    HOME: env.HOME,
    XDG_DATA_HOME: env.XDG_DATA_HOME,
    XDG_CONFIG_HOME: env.XDG_CONFIG_HOME,
    XDG_CACHE_HOME: env.XDG_CACHE_HOME,
    NN_ANIME_DATA_DIR: env.NN_ANIME_DATA_DIR,
    NN_ANIME_CONFIG_DIR: env.NN_ANIME_CONFIG_DIR,
    NN_ANIME_CACHE_DIR: env.NN_ANIME_CACHE_DIR,
    NN_ANIME_LANG: env.NN_ANIME_LANG,
  }
}

const envLang = process.env.NN_ANIME_LANG

const code = await run(Bun.argv.slice(2), {
  io,
  version,
  envLang,
  start: async (options) => {
    const locale = resolveLocale(options.lang ?? envLang)
    const logger = createLogger({ level: options.verbose ? 'debug' : 'info' })
    const lifecycle = createLifecycle({
      onError: (error) => logger.warn('falló una tarea de cierre', { cause: error }),
    })

    const result = await boot(options, {
      io,
      version,
      locale,
      lifecycle,
      env: configEnvironment(process.env),
      migrate,
      listen: listenOnFreePort,
      createSession,
      createBootToken,
      openUrl: (url) =>
        openInBrowser(url, {
          spawn: (argv) =>
            Bun.spawn([...argv], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }),
        }),
    })

    if (result.code !== 0) return result.code

    // Se registra el puerto, nunca la URL: lleva el token de arranque.
    logger.info('servidor en marcha', { port: result.port })

    const signal = await waitForSignal(process)
    logger.info('cerrando', { signal })
    await lifecycle.shutdown()

    return signalExitCode(signal)
  },
}).catch((error: unknown) => {
  io.err(error instanceof Error ? error.message : String(error))
  return 1
})

process.exit(code)
