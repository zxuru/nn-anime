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
import {
  listMigrations,
  openDb,
  pruneOrphans,
  runMigrations,
  shouldPrune,
} from '@nn-anime/catalog-store'
import { createLogger, DEFAULT_LOCALE, readSettings, t } from '@nn-anime/core'
import { ALLOW_LOOPBACK_ENV, allowLoopbackFromEnv, hasMpv } from '@nn-anime/media-proxy'
import { loadProviders } from '@nn-anime/provider-sdk'
import { createBootToken, createContainer, createSession } from '@nn-anime/server'
import { version } from '../package.json'
import { boot, listenOnFreePort, type Migrate } from './boot'
import { configEnvironment } from './env'
import { createLifecycle, waitForClose } from './lifecycle'
import { openInBrowser } from './open-browser'
import { resolveResources } from './resources'
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
 * Los recursos del arranque, resueltos una sola vez.
 *
 * `Bun.embeddedFiles` está vacío fuera de un ejecutable compilado, y ese es el
 * dato que distingue los dos mundos: dentro del binario `import.meta.dir` es la
 * raíz de su sistema de archivos —donde `--asset` dejó la interfaz y las
 * migraciones—, y fuera es un directorio del árbol de fuentes. Preguntarlo en
 * vez de suponerlo deja el orden de `resolveResources` legible.
 */
const resources = resolveResources({
  env: process.env,
  embeddedRoot: Bun.embeddedFiles.length > 0 ? import.meta.dir : undefined,
  sourceDir: import.meta.dir,
  exists: existsSync,
})

/**
 * Migrar al arrancar, y limpiar si la base se ha hecho grande.
 *
 * El runner es el mismo que el de `bun run db:migrate`: uno distinto sería una
 * forma silenciosa de tener dos esquemas. Y la comprobación de tamaño es la del
 * store (`shouldPrune`), no un número escrito aquí.
 *
 * El directorio de migraciones se resuelve fuera porque dentro del binario los
 * `.sql` no están donde el runner los busca por defecto. Sin directorio —el caso
 * de `bun run start`— el runner usa el suyo, que es el camino de siempre.
 */
const migrate: Migrate = async (config) => {
  let db: ReturnType<typeof openDb> | undefined

  try {
    db = openDb(config.dbPath)
    runMigrations(
      db,
      resources.migrationsDir === undefined ? undefined : listMigrations(resources.migrationsDir),
    )

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
 * Si hay mpv, se mira **una vez** al arrancar.
 *
 * Mirarlo en cada petición es un `stat` por reproducción, y el resultado no
 * cambia mientras el proceso vive. El arranque puede esperar; una petición, no.
 */
const mpvDisponible = await hasMpv(async (binario) => Bun.which(binario) ?? undefined)

/**
 * La versión de mpv, para poder enseñarla en los ajustes.
 *
 * Se mira al arrancar, igual que la disponibilidad: `mpv --version` es un proceso
 * que no se lanza en cada carga de la página de ajustes.
 */
async function versionDeMpv(): Promise<string | undefined> {
  if (!mpvDisponible) return undefined

  try {
    const proceso = Bun.spawn(['mpv', '--version'], { stdout: 'pipe', stderr: 'ignore' })
    const salida = await new Response(proceso.stdout).text()
    await proceso.exited

    return /mpv\s+([\d.]+)/.exec(salida)?.[1]
  } catch {
    return undefined
  }
}

const mpvVersion = await versionDeMpv()

/**
 * La excepción de loopback, si el entorno la pide.
 *
 * Se dice **en voz alta** al arrancar: una excepción silenciosa es una excepción
 * que alguien deja puesta sin saberlo, y esta abre la puerta a la red local.
 */
const allowLoopback = allowLoopbackFromEnv()
if (allowLoopback) {
  // Se dice por la salida de error y no por un registro estructurado: esto pasa
  // antes de que exista el registro, y una excepción silenciosa es una excepción
  // que alguien deja puesta sin saberlo.
  process.stderr.write(
    `aviso: ${ALLOW_LOOPBACK_ENV} activa; el proxy aceptará direcciones locales\n`,
  )
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
    webRoot: resources.webRoot,
    listen: listenOnFreePort,
    migrate,
    readSettings,
    loadProviders: (directory, files) => loadProviders({ directory, files }),
    /**
     * El store del server: una conexión que vive lo que vive el proceso.
     *
     * La migración abre y cierra la suya, y ésta se abre después. Compartir una
     * sola conexión obligaría a que la migración no la cerrara, y a que el
     * cierre del server supiera si le toca cerrarla o no.
     */
    openContainer: (config) =>
      createContainer({ db: openDb(config.dbPath), mpvAvailable: mpvDisponible }),
    mpvVersion,
    allowLoopback,
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
    // Las tres formas de pedir el cierre: Ctrl+C, `SIGTERM` y la línea `shutdown`
    // por la entrada estándar. La tercera es la que puede usar un anfitrión de
    // escritorio en Windows, donde `SIGTERM` no existe de verdad.
    waitForClose: () => waitForClose(process, process.stdin),
  }),
}).catch((error: unknown) => {
  io.err(error instanceof Error ? error.message : String(error))
  return 1
})

process.exit(code)
