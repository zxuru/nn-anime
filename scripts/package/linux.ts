#!/usr/bin/env bun
/**
 * Los paquetes de Linux: AppImage, `.deb` y `.rpm`.
 *
 * Tres formatos porque son tres usuarios distintos: el AppImage no se instala
 * —se descarga, se le da permiso de ejecución y se lanza, y sirve para probar sin
 * tocar el sistema—, y el `.deb` y el `.rpm` cubren Debian/Ubuntu y Fedora/RHEL,
 * que es donde se instala de verdad.
 *
 * El `.deb` y el `.rpm` salen del **mismo** `nfpm.yaml`: dos descripciones del
 * mismo paquete serían dos sitios donde olvidarse de subir la versión.
 *
 * La herramienta `nfpm` y `appimagetool` no vienen con la imagen de GitHub; las
 * descarga el workflow **con su SHA256 comprobado**, y aquí sólo se usan. Se
 * pasan como rutas y no se buscan para que el fallo, si falta una, hable de la
 * ruta que falta.
 */

import { chmod, copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ROOT } from '../workspaces'
import { render, template } from './render'

/** El icono de 512 px, que es el que quieren el AppImage y hicolor. */
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

/** nfpm nombra las arquitecturas como Debian. */
export function nfpmArch(arch: string): string {
  return arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : arch
}

/** AppImage nombra las suyas como el kernel. */
export function appImageArch(arch: string): string {
  return arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : arch
}

export interface LinuxOptions {
  readonly version: string
  /** El ejecutable ya compilado. */
  readonly binary: string
  /** Dónde quedan los paquetes: es lo que se publica. */
  readonly releaseDir: string
  /**
   * Dónde se trabaja: el `nfpm.yaml` generado y el AppDir.
   *
   * Va aparte de `releaseDir` porque lo de ahí no se publica. Un `nfpm.yaml` con
   * la versión dentro acabó en la release en la primera prueba, y el AppDir es un
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
 * El `.deb` y el `.rpm`, con nfpm.
 *
 * La configuración se **genera** sustituyendo marcadores en lugar de dejar que
 * nfpm lea variables de entorno: una versión que no se sustituye por lo que sea
 * da un paquete con la versión equivocada y no un error, y eso no se descubre
 * hasta que alguien compara el `.deb` con la release.
 */
export async function linuxPackages(
  options: LinuxOptions,
  nfpm: string,
): Promise<readonly string[]> {
  const configPath = join(options.workDir, 'nfpm.yaml')
  const arch = nfpmArch(options.arch)

  await writeFile(
    configPath,
    render(await template('linux/nfpm.yaml'), {
      ARCH: arch,
      VERSION: options.version,
      BINARY: options.binary,
      DESKTOP: DESKTOP,
      ICON: ICON,
    }),
  )

  const salidas: string[] = []

  for (const [packager, extension] of [
    ['deb', 'deb'],
    ['rpm', 'rpm'],
  ] as const) {
    const target = join(
      options.releaseDir,
      `nn-anime-${options.version}-linux-${options.arch}.${extension}`,
    )

    await run(
      [nfpm, 'package', '--config', configPath, '--packager', packager, '--target', target],
      options.workDir,
    )
    salidas.push(target)
  }

  return salidas
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
