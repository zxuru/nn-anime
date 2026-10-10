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
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { openDb, pruneOrphans, runMigrations, shouldPrune } from '@nn-anime/catalog-store'
import { createLogger, DEFAULT_LOCALE, readSettings, t } from '@nn-anime/core'
import { loadProviders } from '@nn-anime/provider-sdk'
import { createBootToken, createContainer, createSession } from '@nn-anime/server'
import { version } from '../package.json'
import { boot, listenOnFreePort, type Migrate } from './boot'
import { configEnvironment } from './env'
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

/**
 * Migrar al arrancar, y limpiar si la base se ha hecho grande.
 *
 * El runner es el mismo que el de `bun run db:migrate`: uno distinto sería una
 * forma silenciosa de tener dos esquemas. Y la comprobación de tamaño es la del
 * store (`shouldPrune`), no un número escrito aquí.
 */
const migrate: Migrate = async (config) => {
  let db: ReturnType<typeof openDb> | undefined

  try {
    db = openDb(config.dbPath)
    runMigrations(db)

    const info = await stat(config.dbPath).catch(() => undefined)
    if (info !== undefined && shouldPrune(info.size)) {
      const informe = pruneOrphans(db)
      const filas = Object.values(informe.deleted).reduce((suma, total) => suma + total, 0)

      return { ok: true, note: t(DEFAULT_LOCALE, 'cli.prune.atStartup', { rows: filas }) }
    }

    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  } finally {
    db?.close()
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
    /**
     * El store del server: una conexión que vive lo que vive el proceso.
     *
     * La migración abre y cierra la suya, y ésta se abre después. Compartir una
     * sola conexión obligaría a que la migración no la cerrara, y a que el
     * cierre del server supiera si le toca cerrarla o no.
     */
    openContainer: (config) => createContainer({ db: openDb(config.dbPath) }),
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
