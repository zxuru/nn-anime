#!/usr/bin/env bun
/**
 * El paquete portable de macOS: un `.app` dentro de un `.zip`.
 *
 * No hay instalador ni imagen de disco: se descarga el `.zip`, se descomprime y
 * la aplicación se ejecuta desde donde quede. Es el mismo `.app` que antes viajaba
 * dentro del `.dmg`, sin el contenedor que sólo servía para arrastrarlo a
 * Aplicaciones.
 *
 * La firma es **condicional**: si no hay identidad en el entorno, el `.app` sale
 * sin firmar. Un ejecutable sin firmar de un desarrollador sin notarizar arranca
 * en macOS sólo tras el rodeo de «Abrir de todos modos», que es lo que el README
 * explica. Fingir que se firma sería peor: la release diría «firmada» y no lo
 * estaría.
 */

import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ROOT } from '../workspaces'
import { dottedVersion } from './binary'
import { HOST_NAME } from './desktop'
import { render, template } from './render'

/** El icono del paquete, dentro del repositorio. Sin él macOS pone uno genérico. */
export const ICON = join(ROOT, 'packaging', 'icons', 'icon.icns')

/** La identidad de firma, que el workflow saca del llavero temporal. */
export const IDENTITY_ENV = 'APPLE_SIGNING_IDENTITY'

export interface MacOptions {
  readonly version: string
  /** El ejecutable ya compilado. */
  readonly binary: string
  /** Dónde queda el `.zip`: es lo único que se publica. */
  readonly releaseDir: string
  /**
   * Dónde se arma el `.app`.
   *
   * **Fuera de `releaseDir`, y no es un detalle de orden**: `gh release upload
   * release/*` no sabe subir un directorio, y el `.app` es uno. Sólo el `.zip`
   * viaja.
   */
  readonly workDir: string
  /** Nombre del `.zip`, sin directorio. */
  readonly zipName: string
  /** `true` para no firmar aunque haya identidad. Sólo lo usan las pruebas. */
  readonly unsigned?: boolean
}

async function run(argv: readonly string[], cwd: string): Promise<void> {
  const proceso = Bun.spawn([...argv], {
    cwd,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const code = await proceso.exited
  if (code !== 0) throw new Error(`\`${argv[0]} ${argv.slice(1).join(' ')}\` falló con ${code}`)
}

/** Firma la ruta que se le pase, si hay identidad. Devuelve si firmó. */
export async function sign(path: string, cwd: string): Promise<boolean> {
  const identity = process.env[IDENTITY_ENV]
  if (identity === undefined || identity === '') return false

  await run(
    ['codesign', '--force', '--timestamp', '--options', 'runtime', '--sign', identity, path],
    cwd,
  )
  await run(['codesign', '--verify', '--deep', '--strict', path], cwd)

  return true
}

export interface MacBundleResult {
  readonly app: string
  readonly signed: boolean
}

/**
 * Arma `rona.app`.
 *
 * El paquete lleva **dos** ejecutables, y no es un detalle: el servidor
 * (`rona`, que es lo que la aplicación es hoy) y el anfitrión de ventana
 * (`rona-desktop`), que es a quien apunta `CFBundleExecutable` y quien lanza
 * al servidor como hermano. Los dos van en `Contents/MacOS` porque el anfitrión
 * busca al servidor **por su nombre, en su propio directorio**.
 *
 * El `Info.plist` declara `CFBundleExecutable = rona-desktop`: es lo que hace
 * que abrir la aplicación abra la ventana y no una terminal. La consola sigue
 * dentro del paquete, en `Contents/MacOS/rona`, para quien la quiera.
 *
 * No hay `Resources` con código: la interfaz y las migraciones viajan **dentro**
 * del servidor gracias a `--asset`, y tener una copia fuera sería una segunda
 * fuente que se desincroniza.
 */
export async function macBundle(options: MacOptions): Promise<MacBundleResult> {
  const app = join(options.workDir, 'rona.app')
  const macos = join(app, 'Contents', 'MacOS')

  await rm(app, { recursive: true, force: true })
  await mkdir(macos, { recursive: true })

  await copyFile(options.binary, join(macos, 'rona'))
  await chmod(join(macos, 'rona'), 0o755)

  // El anfitrión lo deja `stageDesktop` al lado del servidor, en el directorio de
  // trabajo del paquete. Si no está, `CFBundleExecutable` nombraría un archivo que
  // no existe y macOS no abriría nada: se dice aquí y no en el Mac de quien lo
  // descarga.
  const anfitrion = join(dirname(options.binary), HOST_NAME)

  if (!existsSync(anfitrion)) {
    throw new Error(`no hay anfitrión junto al servidor en ${anfitrion}: es lo que abre la ventana`)
  }

  await copyFile(anfitrion, join(macos, HOST_NAME))
  await chmod(join(macos, HOST_NAME), 0o755)

  await writeFile(
    join(app, 'Contents', 'Info.plist'),
    render(await template('macos/Info.plist'), {
      VERSION: options.version,
      BUNDLE_VERSION: dottedVersion(options.version),
    }),
  )

  if (existsSync(ICON)) {
    await mkdir(join(app, 'Contents', 'Resources'), { recursive: true })
    await copyFile(ICON, join(app, 'Contents', 'Resources', 'icon.icns'))
  }

  const signed = options.unsigned === true ? false : await sign(app, options.workDir)

  return { app, signed }
}

export interface ZipResult {
  readonly zip: string
  readonly signed: boolean
  readonly notarized: boolean
}

/**
 * Comprime el `.app` en el `.zip` que se publica, y lo firma y notariza si hay con qué.
 *
 * La notarización no falla la publicación cuando no hay credenciales —no todo el
 * mundo tiene cuenta de desarrollador—, pero tampoco se calla: devuelve qué hizo
 * y el workflow lo deja escrito en el resumen, que es donde se lee.
 *
 * `notarytool` no acepta un `.app` suelto: se le manda el `.zip`, y el ticket se
 * grapa al `.app` antes de volver a comprimirlo. Si se grapara al `.zip`, Gatekeeper
 * no lo encontraría al descomprimir.
 */
export async function macZip(options: MacOptions): Promise<ZipResult> {
  const { app, signed } = await macBundle(options)
  const zip = join(options.releaseDir, options.zipName)
  const temporal = join(options.workDir, 'rona.zip')

  await rm(zip, { force: true })
  await rm(temporal, { force: true })

  await comprimir(app, temporal, options.workDir)

  let notarized = false

  if (signed && hayCredenciales()) {
    notarized = await notarize(temporal, options.workDir)

    if (notarized) {
      // `stapler` grapa el ticket al `.app`: sin esto, la comprobación de
      // Gatekeeper necesitaría red en la máquina de quien lo descarga.
      await run(['xcrun', 'stapler', 'staple', app], options.workDir)
      await rm(temporal, { force: true })
      await comprimir(app, temporal, options.workDir)
    }
  }

  // Copia y no `rename`: `workDir` y `releaseDir` pueden acabar en volúmenes
  // distintos, y el rename sería un `EXDEV`. El temporal se borra siempre.
  await copyFile(temporal, zip)
  await rm(temporal, { force: true })

  return { zip, signed, notarized }
}

/** `ditto` y no `zip`: conserva los permisos y los recursos del `.app`. */
async function comprimir(app: string, destino: string, cwd: string): Promise<void> {
  await run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', app, destino], cwd)
}

function hayCredenciales(): boolean {
  return (
    process.env.APPLE_ID !== undefined &&
    process.env.APPLE_ID !== '' &&
    process.env.APPLE_APP_SPECIFIC_PASSWORD !== undefined &&
    process.env.APPLE_APP_SPECIFIC_PASSWORD !== '' &&
    process.env.APPLE_TEAM_ID !== undefined &&
    process.env.APPLE_TEAM_ID !== ''
  )
}

/** Envía el `.zip` a notarizar. `false` si no hay credenciales. */
async function notarize(zip: string, cwd: string): Promise<boolean> {
  const appleId = process.env.APPLE_ID
  const password = process.env.APPLE_APP_SPECIFIC_PASSWORD
  const teamId = process.env.APPLE_TEAM_ID

  if (!appleId || !password || !teamId) return false

  await run(
    [
      'xcrun',
      'notarytool',
      'submit',
      zip,
      '--apple-id',
      appleId,
      '--password',
      password,
      '--team-id',
      teamId,
      '--wait',
    ],
    cwd,
  )

  return true
}
