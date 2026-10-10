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
import { type ConfigEnvironment, createLogger, readSettings } from '@nn-anime/core'
import { loadProviders } from '@nn-anime/provider-sdk'
import { createBootToken, createSession } from '@nn-anime/server'
import { version } from '../package.json'
import { boot, listenOnFreePort, type Migrate } from './boot'
import { createLifecycle, waitForSignal } from './lifecycle'
import { openInBrowser } from './open-browser'
import { type CliIO, run } from './run'
import { createStarter } from './start'

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
  start: createStarter({
    io,
    version,
    envLang,
    env: configEnvironment(process.env),
    publicOrigin: process.env.NN_ANIME_DEV_ORIGIN,
    webRoot: webBuildRoot(),
    listen: listenOnFreePort,
    migrate,
    readSettings,
    loadProviders: (directory) => loadProviders({ directory }),
    createSession,
    createBootToken,
    openUrl: (url) =>
      openInBrowser(url, {
        spawn: (argv) =>
          Bun.spawn([...argv], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }),
      }),
    createLogger: (verbose) => createLogger({ level: verbose ? 'debug' : 'info' }),
    createLifecycle: (onError) => createLifecycle({ onError }),
    boot,
    waitForSignal: () => waitForSignal(process),
  }),
}).catch((error: unknown) => {
  io.err(error instanceof Error ? error.message : String(error))
  return 1
})

process.exit(code)
