#!/usr/bin/env bun
/**
 * El instalador de Windows.
 *
 * NSIS y no MSI: el `.exe` cubre el requisito, instala por usuario —sin UAC— y
 * `makensis` ya está en la imagen de GitHub. Un MSI pediría WiX, un `.wxs`
 * escrito a mano y una instalación por máquina que necesitaría administrador
 * para un programa que vive en `%LOCALAPPDATA%`.
 *
 * El script de NSIS está en `packaging/windows/nn-anime.nsi`; aquí sólo se le
 * pasan los defines y se comprueba que la herramienta esté.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../workspaces'
import { dottedVersion, WINDOWS_ICON } from './binary'

export const SCRIPT = join(ROOT, 'packaging', 'windows', 'nn-anime.nsi')

/**
 * Dónde puede estar `makensis`.
 *
 * La imagen de GitHub lo trae instalado, pero no siempre en el `PATH`: sin esta
 * lista, el fallo sería «no se encontró makensis» en una máquina que sí lo
 * tiene, que es la peor clase de error.
 */
export function candidates(): readonly string[] {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'

  return [
    'makensis',
    join(programFiles, 'NSIS', 'makensis.exe'),
    join(programFilesX86, 'NSIS', 'makensis.exe'),
  ]
}

export function findMakensis(
  which: (name: string) => string | null = (name) => Bun.which(name),
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  for (const candidate of candidates()) {
    const encontrado =
      candidate.includes('\\') || candidate.includes('/')
        ? exists(candidate)
          ? candidate
          : undefined
        : (which(candidate) ?? undefined)

    if (encontrado !== undefined) return encontrado
  }

  return undefined
}

export interface WindowsInstallerOptions {
  readonly version: string
  /** Directorio que contiene `nn-anime.exe`, ya compilado. */
  readonly sourceDir: string
  /** Ruta del instalador que hay que escribir. */
  readonly outfile: string
}

export function nsisArgs(options: WindowsInstallerOptions): readonly string[] {
  return [
    // `-V2` calla la narración y sigue enseñando avisos y errores: la salida
    // entera de NSIS son cientos de líneas que nadie lee y que esconden el
    // error cuando lo hay.
    '-V2',
    `/DVERSION=${options.version}`,
    `/DVERSION4=${dottedVersion(options.version)}`,
    `/DSOURCE=${options.sourceDir}`,
    `/DOUTFILE=${options.outfile}`,
    ...(existsSync(WINDOWS_ICON) ? [`/DICON=${WINDOWS_ICON}`] : []),
    SCRIPT,
  ]
}

export async function windowsInstaller(options: WindowsInstallerOptions): Promise<string> {
  const makensis = findMakensis()

  if (makensis === undefined) {
    throw new Error(
      'no se encontró makensis (NSIS). En Windows: choco install nsis -y. ' +
        'En las imágenes de GitHub Actions ya está instalado.',
    )
  }

  const proceso = Bun.spawn([makensis, ...nsisArgs(options)], {
    cwd: ROOT,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const code = await proceso.exited
  if (code !== 0) throw new Error(`makensis falló con código ${code}`)

  return options.outfile
}
