#!/usr/bin/env bun
/**
 * El ejecutable autocontenido de nn-anime.
 *
 * `bun build --compile` mete el runtime, el servidor, SQLite y la interfaz en un
 * solo archivo nativo, y `--asset` añade lo que el código lee del disco en
 * marcha: el build de la interfaz y los archivos `.sql` de las migraciones. Sin
 * los dos, el binario arranca y **miente**: sirve 404 en `/` y aplica cero
 * migraciones sin decirlo.
 *
 * `--asset` no sabe renombrar: lo incrustado queda dentro del ejecutable con el
 * nombre del directorio de origen. Por eso `packages/cli/src/resources.ts` busca
 * `dist` y `migrations`, y por eso hay una prueba que compara los dos sitios: si
 * alguien mueve el build de la interfaz a `packages/web/build`, el basename
 * cambia, el ejecutable deja de encontrarlo y el fallo aparecería en la release.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../workspaces'

/** El punto de entrada. Es el mismo que el de `bun run start`. */
export const ENTRY = join(ROOT, 'packages', 'cli', 'src', 'index.ts')

/**
 * Los directorios que viajan dentro del ejecutable.
 *
 * El orden no importa; los nombres sí, y son los basenames de estas rutas.
 */
export const EMBEDDED_DIRECTORIES: readonly string[] = [
  join(ROOT, 'packages', 'web', 'dist'),
  join(ROOT, 'packages', 'catalog-store', 'src', 'migrations'),
]

/**
 * El icono de la aplicación, en el formato de Windows.
 *
 * **No se le pasa a `--windows-icon`**, y es una decisión medida, no un olvido:
 * en Bun 1.4.3 esa bandera produce un ejecutable que Windows no arranca. Con un
 * `.ico` de entradas PNG escribe 2,66 GB de basura; con uno de entradas DIB
 * —el formato clásico, que es el que se genera aquí— el archivo pesa lo que debe
 * pero Windows contesta «la configuración en paralelo no es correcta», que es un
 * manifiesto de recursos roto.
 *
 * El icono lo pone el instalador de NSIS, que sí lo admite, y los accesos del
 * menú Inicio y del escritorio lo usan. Cuando Bun lo arregle, volver a ponerlo
 * es una línea en `buildArgs`.
 */
export const WINDOWS_ICON = join(ROOT, 'packaging', 'icons', 'icon.ico')

export interface BinarySpec {
  /** Objetivo de Bun: `bun-windows-x64`, `bun-darwin-arm64`… */
  readonly target: string
  /**
   * Cómo se llama la plataforma en el nombre del artefacto.
   *
   * Es una unión y no una cadena para que el `switch` que arma el instalador sea
   * exhaustivo: con una cadena, añadir una plataforma y olvidar su instalador
   * compila igual y publica un ejecutable sin nada que lo instale.
   */
  readonly platform: 'windows' | 'macos' | 'linux'
  readonly arch: string
  /** Extensión del ejecutable, con el punto. Vacía en Linux y macOS. */
  readonly extension: string
}

/**
 * Los objetivos que se publican.
 *
 * Windows sólo x64 y Linux sólo x64 por ahora: son los objetivos que alguien ha
 * pedido. `bun-linux-arm64` y `bun-windows-arm64` existen y añadirlos es una
 * línea aquí más un `.deb` y un AppImage más, pero cada uno es una release que
 * hay que poder probar, y publicar algo que nadie instala es deuda.
 */
export const TARGETS: Readonly<Record<string, BinarySpec>> = {
  'windows-x64': { target: 'bun-windows-x64', platform: 'windows', arch: 'x64', extension: '.exe' },
  'darwin-x64': { target: 'bun-darwin-x64', platform: 'macos', arch: 'x64', extension: '' },
  'darwin-arm64': { target: 'bun-darwin-arm64', platform: 'macos', arch: 'arm64', extension: '' },
  'linux-x64': { target: 'bun-linux-x64', platform: 'linux', arch: 'x64', extension: '' },
}

export interface BuildBinaryOptions {
  readonly spec: BinarySpec
  readonly version: string
  /** Ruta de salida del ejecutable. */
  readonly outfile: string
  /** `false` deja el binario sin metadatos de Windows. Sólo se usa en las pruebas. */
  readonly metadata?: boolean
}

/**
 * La versión en la forma de números separados por puntos.
 *
 * La quieren dos sitios y por el mismo motivo: el recurso de versión de un `.exe`
 * son cuatro números y `CFBundleVersion` de macOS tampoco admite un preestreno.
 * Una versión `1.2.3-rc.1` se queda en `1.2.3.0`; recortarla es más honesto que
 * inventar el cuarto número, y la versión completa sigue viajando en
 * `CFBundleShortVersionString` y en el nombre del artefacto.
 */
export function dottedVersion(version: string): string {
  const base = version.split(/[-+]/)[0] ?? version
  const partes = base.split('.').slice(0, 4)

  while (partes.length < 4) partes.push('0')

  return partes.join('.')
}

export function buildArgs(options: BuildBinaryOptions): readonly string[] {
  const args = [
    'build',
    ENTRY,
    '--compile',
    `--target=${options.spec.target}`,
    `--outfile=${options.outfile}`,
  ]

  for (const directory of EMBEDDED_DIRECTORIES) args.push(`--asset=${directory}`)

  if (options.metadata !== false && options.spec.platform === 'windows') {
    args.push(
      `--windows-version=${dottedVersion(options.version)}`,
      '--windows-title=nn-anime',
      '--windows-description=Ver anime desde el navegador, con una interfaz que arranca en 127.0.0.1',
      '--windows-publisher=nn-anime',
      '--windows-copyright=nn-anime',
    )
  }

  return args
}

/**
 * Los recursos que faltan, si falta alguno.
 *
 * Sin el build de la interfaz el ejecutable sale igual, pero sale sin interfaz:
 * el servidor contesta 404 en `/` y quien lo instaló cree que la aplicación está
 * rota. Mejor decirlo antes de compilar.
 */
export function missingAssets(exists: (path: string) => boolean = existsSync): readonly string[] {
  return EMBEDDED_DIRECTORIES.filter((directory) => !exists(directory))
}

export async function buildBinary(options: BuildBinaryOptions): Promise<void> {
  const proceso = Bun.spawn(['bun', ...buildArgs(options)], {
    cwd: ROOT,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const code = await proceso.exited
  if (code !== 0) throw new Error(`bun build falló con código ${code}`)
}
