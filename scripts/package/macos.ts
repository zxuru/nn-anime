#!/usr/bin/env bun

/**
 * El paquete y el `.dmg` de macOS.
 *
 * Se usa `hdiutil`, que viene con macOS, en vez de `create-dmg`: lo único que
 * aporta el segundo es el fondo de la ventana, y a cambio añade una dependencia
 * de Homebrew a la cadena de publicación. El enlace a `/Applications` —que es lo
 * que de verdad hace falta para arrastrar la aplicación— se crea aquí.
 *
 * La firma es **condicional**: si no hay identidad en el entorno, el `.app` sale
 * sin firmar. Un ejecutable sin firmar de un desarrollador sin notarizar arranca
 * en macOS sólo tras el rodeo de «Abrir de todos modos», que es lo que el README
 * explica. Fingir que se firma sería peor: la release diría «firmada» y no lo
 * estaría.
 */

import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ROOT } from '../workspaces'
import { dottedVersion } from './binary'
import { render, template } from './render'

/** El icono del paquete, dentro del repositorio. Sin él macOS pone uno genérico. */
export const ICON = join(ROOT, 'packaging', 'icons', 'icon.icns')

/** La identidad de firma, que el workflow saca del llavero temporal. */
export const IDENTITY_ENV = 'APPLE_SIGNING_IDENTITY'

export interface MacOptions {
  readonly version: string
  /** El ejecutable ya compilado. */
  readonly binary: string
  /** Dónde queda el `.dmg`: es lo único que se publica. */
  readonly releaseDir: string
  /**
   * Dónde se arma el `.app`.
   *
   * **Fuera de `releaseDir`, y no es un detalle de orden**: `gh release upload
   * release/*` no sabe subir un directorio, y el `.app` es uno. Con él ahí, la
   * release habría fallado al final, con los instaladores de las tres
   * plataformas ya compilados. Sólo el `.dmg` viaja.
   */
  readonly workDir: string
  /** Nombre del `.dmg`, sin directorio. */
  readonly dmgName: string
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

/**
 * Arma `nn-anime.app`.
 *
 * El paquete es la aplicación ejecutable y su `Info.plist`. No hay `Resources`
 * con código: la interfaz y las migraciones viajan **dentro** del ejecutable
 * gracias a `--asset`, y tener una copia fuera sería una segunda fuente que se
 * desincroniza.
 */
export async function macBundle(options: MacOptions): Promise<string> {
  const app = join(options.workDir, 'nn-anime.app')
  const macos = join(app, 'Contents', 'MacOS')

  await rm(app, { recursive: true, force: true })
  await mkdir(macos, { recursive: true })

  await copyFile(options.binary, join(macos, 'nn-anime'))
  await chmod(join(macos, 'nn-anime'), 0o755)

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

  if (options.unsigned !== true) await sign(app, options.workDir)

  return app
}

export interface DmgResult {
  readonly dmg: string
  readonly signed: boolean
  readonly notarized: boolean
}

/**
 * Mete el `.app` en un `.dmg`, y lo firma y notariza si hay con qué.
 *
 * La notarización no falla la publicación cuando no hay credenciales —no todo el
 * mundo tiene cuenta de desarrollador—, pero tampoco se calla: devuelve qué hizo
 * y el workflow lo deja escrito en el resumen, que es donde se lee.
 */
export async function macDmg(options: MacOptions): Promise<DmgResult> {
  const imagen = join(options.workDir, 'nn-anime-rw.dmg')
  const montaje = join(options.workDir, 'montaje')
  const dmg = join(options.releaseDir, options.dmgName)

  await rm(imagen, { force: true })
  await rm(dmg, { force: true })
  await rm(montaje, { recursive: true, force: true })
  await mkdir(montaje, { recursive: true })

  // El tamaño se dice **explícitamente** en vez de dejar que hdiutil lo adivine
  // con `-srcfolder`. Medido en la primera ejecución del CI: con `-srcfolder` el
  // cálculo salió mal —`hdiutil: create failed - No space left on device` y
  // después un volumen demasiado pequeño hasta para la propia aplicación—. Con un
  // tamaño fijo no hay nada que calcular, y lo que sobre se recorta al convertir
  // a UDZO, que es donde se comprime de verdad.
  await run(
    [
      'hdiutil',
      'create',
      '-size',
      imageSize(options.binary),
      '-volname',
      'nn-anime',
      '-ov',
      imagen,
    ],
    options.workDir,
  )

  await run(
    ['hdiutil', 'attach', imagen, '-mountpoint', montaje, '-nobrowse', '-noautoopen'],
    options.workDir,
  )

  try {
    // El `.app` se arma **dentro de la imagen montada**. Así no hay una copia de
    // 70 MB en el disco de trabajo, y el enlace a `/Applications` —que es el que
    // deja arrastrar la aplicación— se crea donde tiene que verse y no en el
    // árbol del que hdiutil saca el tamaño.
    await macBundle({ ...options, workDir: montaje })
    await symlink('/Applications', join(montaje, 'Applications'))
  } finally {
    // `-force` porque el volumen acaba de recibir un `.app` de 70 MB y el
    // desmontaje normal a veces lo encuentra ocupado.
    await run(['hdiutil', 'detach', montaje, '-force'], options.workDir)
  }

  await run(['hdiutil', 'convert', imagen, '-format', 'UDZO', '-ov', '-o', dmg], options.workDir)

  await rm(imagen, { force: true })
  await rm(montaje, { recursive: true, force: true })

  const firmado = options.unsigned === true ? false : await sign(dmg, options.releaseDir)
  const notarized = firmado && (await notarize(dmg, options.releaseDir))

  return { dmg, signed: firmado, notarized }
}

/**
 * El tamaño de la imagen temporal, en la forma que entiende `hdiutil`.
 *
 * Tres veces lo que ocupa el ejecutable, con un suelo de 150 MB: el `.app` es el
 * ejecutable, su `Info.plist` y un icono, así que el margen sobra y una versión
 * que crezca no rompe la release por dos megabytes. Lo que no se use no viaja: el
 * `.dmg` que se publica es el resultado de comprimir, no la imagen.
 */
export function imageSize(binary: string): string {
  const mb = Math.ceil(Bun.file(binary).size / (1024 * 1024))

  return `${Math.max(150, mb * 3)}m`
}

/** Envía el `.dmg` a notarizar y grapa el ticket. `false` si no hay credenciales. */
async function notarize(dmg: string, cwd: string): Promise<boolean> {
  const appleId = process.env.APPLE_ID
  const password = process.env.APPLE_APP_SPECIFIC_PASSWORD
  const teamId = process.env.APPLE_TEAM_ID

  if (!appleId || !password || !teamId) return false

  await run(
    [
      'xcrun',
      'notarytool',
      'submit',
      dmg,
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

  // `staple` grapa el ticket al archivo: sin esto, la comprobación de Gatekeeper
  // necesitaría red en la máquina de quien lo instala.
  await run(['xcrun', 'stapler', 'staple', dmg], cwd)

  return true
}
