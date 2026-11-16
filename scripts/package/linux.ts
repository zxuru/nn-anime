#!/usr/bin/env bun
/**
 * El artefacto portable de Linux: el AppImage.
 *
 * Un solo archivo que no se instala: se descarga, se le da permiso de ejecución y
 * se lanza. No toca el sistema y no necesita un gestor de paquetes, que es lo que
 * lo hace portable entre distribuciones.
 *
 * `appimagetool` no viene con la imagen de GitHub; lo descarga el workflow **con
 * su SHA256 comprobado**, y aquí sólo se usa. Se pasa como ruta y no se busca para
 * que el fallo, si falta, hable de la ruta que falta.
 */

import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ROOT } from '../workspaces'
import { hostFileName } from './desktop'

/** El icono de 512 px, que es el que quiere el AppImage. */
export const ICON = join(ROOT, 'packaging', 'icons', 'icon-512.png')

export const DESKTOP = join(ROOT, 'packaging', 'linux', 'nn-anime.desktop')

/**
 * El lanzador del AppImage.
 *
 * Es un guion de verdad guardado como archivo y no una cadena que se escribe
 * desde aquí: dentro lleva sintaxis de `sh` —`${APPDIR:-…}`— que en un archivo
 * TypeScript se lee como una interpolación olvidada, y el linter tiene razón en
 * avisar.
 */
export const APPRUN = join(ROOT, 'packaging', 'linux', 'AppRun')

/**
 * El anfitrión de ventana, que `stageDesktop` deja **al lado** del servidor.
 *
 * Se comprueba aquí y no se deja a `appimagetool`: sin esta comprobación, el
 * paquete saldría con un `AppRun` que apunta a un ejecutable que no está.
 */
export function hostBeside(binary: string): string {
  const host = join(dirname(binary), hostFileName('linux'))

  if (!existsSync(host)) {
    throw new Error(`no hay anfitrión junto al servidor en ${host}: es lo que abre la ventana`)
  }

  return host
}

/** AppImage nombra las suyas como el kernel. */
export function appImageArch(arch: string): string {
  return arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : arch
}

export interface LinuxOptions {
  readonly version: string
  /** El ejecutable ya compilado. */
  readonly binary: string
  /** Dónde queda el AppImage: es lo que se publica. */
  readonly releaseDir: string
  /**
   * Dónde se trabaja: el AppDir.
   *
   * Va aparte de `releaseDir` porque lo de ahí no se publica: el AppDir es un
   * árbol entero de directorios.
   */
  readonly workDir: string
  readonly arch: string
}

async function run(
  argv: readonly string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<void> {
  const proceso = Bun.spawn([...argv], {
    cwd,
    env: env === undefined ? process.env : { ...process.env, ...env },
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const code = await proceso.exited
  if (code !== 0) throw new Error(`\`${argv[0]} ${argv.slice(1).join(' ')}\` falló con ${code}`)
}

/**
 * El AppImage.
 *
 * Un AppDir es un directorio con `AppRun`, el `.desktop` y el icono en la raíz, y
 * el resto donde quiera quien lo arma. `AppRun` es un guion y no el ejecutable
 * copiado porque necesita saber dónde quedó montado: dentro del AppImage el
 * directorio es de sólo lectura y su ruta la dice `$APPDIR`.
 */
export async function linuxAppImage(options: LinuxOptions, appimagetool: string): Promise<string> {
  const appDir = join(options.workDir, 'nn-anime.AppDir')
  const target = join(
    options.releaseDir,
    `nn-anime-${options.version}-linux-${options.arch}.AppImage`,
  )

  await rm(appDir, { recursive: true, force: true })
  await mkdir(join(appDir, 'usr', 'bin'), { recursive: true })

  await copyFile(options.binary, join(appDir, 'usr', 'bin', 'nn-anime'))
  await chmod(join(appDir, 'usr', 'bin', 'nn-anime'), 0o755)

  // El anfitrión, en el mismo `usr/bin`: `AppRun` lo lanza sin argumentos y el
  // servidor con ellos.
  const host = hostBeside(options.binary)

  await copyFile(host, join(appDir, 'usr', 'bin', hostFileName('linux')))
  await chmod(join(appDir, 'usr', 'bin', hostFileName('linux')), 0o755)

  await copyFile(DESKTOP, join(appDir, 'nn-anime.desktop'))
  await copyFile(APPRUN, join(appDir, 'AppRun'))
  await chmod(join(appDir, 'AppRun'), 0o755)

  if (await Bun.file(ICON).exists()) await copyFile(ICON, join(appDir, 'nn-anime.png'))

  // `--appimage-extract-and-run` evita FUSE, que en un runner de CI no está: sin
  // él, `appimagetool` falla al montarse a sí mismo.
  await run([appimagetool, '--appimage-extract-and-run', appDir, target], options.workDir, {
    ARCH: appImageArch(options.arch),
  })

  await rm(appDir, { recursive: true, force: true })

  return target
}
