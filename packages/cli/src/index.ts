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

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

/**
 * Directorio del build de la interfaz, si está construido.
 *
 * Sin build, el server sólo expone la API y el desarrollo va por Vite. Con él,
 * un solo proceso sirve la interfaz y la API en el mismo origen, que es lo que
 * hace válida la cookie de sesión y evita el CORS.
 */
function webBuildRoot(): string | undefined {
  const dist = fileURLToPath(new URL('../../web/dist/', import.meta.url))

  return existsSync(dist) ? dist : undefined
}

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

    // Las señales se registran antes de arrancar nada. Registrarlas después
    // deja una ventana en la que un Ctrl+C usa la acción por defecto y se salta
    // el cierre ordenado: hoy no habría daño, pero en T29 dejaría un mpv vivo.
    const signal = waitForSignal(process)

    const publicOrigin = process.env.NN_ANIME_DEV_ORIGIN
    const result = await boot(options, {
      io,
      version,
      locale,
      lifecycle,
      env: configEnvironment(process.env),
      migrate,
      listen: listenOnFreePort,
      publicOrigin,
      // En desarrollo el proxy apunta a un puerto fijo: mudarse de puerto en
      // silencio dejaría la interfaz cargando y la API inalcanzable.
      allowPortFallback: publicOrigin === undefined,
      webRoot: webBuildRoot(),
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

    const received = await signal
    logger.info('cerrando', { signal: received })
    await lifecycle.shutdown()

    return signalExitCode(received)
  },
}).catch((error: unknown) => {
  io.err(error instanceof Error ? error.message : String(error))
  return 1
})

process.exit(code)
