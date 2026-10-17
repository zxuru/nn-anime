#!/usr/bin/env bun
/**
 * El anfitrión de ventana: compilarlo, comprobarlo y dejarlo donde el instalador
 * lo espera.
 *
 * **No se usa el CLI de Tauri.** `tauri-build` lee `tauri.conf.json` en el guion
 * de compilación y genera el contexto, así que `cargo build --release` produce el
 * binario entero. Eso deja el empaquetado donde ya estaba —`scripts/package.ts` y
 * `packaging/`, los que producen los instaladores probados— y añade un paso, en
 * vez de estrenar una segunda cadena de empaquetado que habría que volver a
 * verificar en las tres plataformas.
 *
 * Uso:
 *   bun run desktop:check      fmt, clippy y pruebas del árbol de Rust
 *   bun run desktop:build      compila el anfitrión de esta plataforma
 */

import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ROOT } from '../workspaces'

/** El manifiesto del árbol de Rust. `cargo` recibe siempre esta ruta. */
export const MANIFEST = join(ROOT, 'desktop', 'src-tauri', 'Cargo.toml')

/** El directorio del árbol de Rust. */
export const CRATE_DIR = dirname(MANIFEST)

/** El nombre del anfitrión. **Distinto** del servidor, que se instala al lado. */
export const HOST_NAME = 'nn-anime-desktop'

/** El nombre del servidor, tal y como lo busca `sidecar.rs`. */
export const SERVER_NAME = 'nn-anime'

/**
 * Dónde deja `cargo build --release` el binario del anfitrión.
 *
 * La plataforma se puede decir para poder afirmar la **ruta** de otro sistema sin
 * fingir que se compiló: es lo que usan las pruebas de empaquetado.
 */
export function hostBinary(platform: string = process.platform): string {
  const nombre = platform === 'win32' ? `${HOST_NAME}.exe` : HOST_NAME

  return join(CRATE_DIR, 'target', 'release', nombre)
}

export interface RunOptions {
  /** Directorio de trabajo del comando. */
  readonly cwd?: string
}

/**
 * Ejecuta un comando con la salida heredada.
 *
 * `inherit` y no una tubería: la salida de `cargo` son cientos de líneas que
 * interesa ver en vivo, y capturarla para volcarla después deja el fallo sin
 * contexto cuando el proceso muere a mitad.
 */
export async function run(argv: readonly string[], options: RunOptions = {}): Promise<void> {
  const proceso = Bun.spawn([...argv], {
    cwd: options.cwd ?? ROOT,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const code = await proceso.exited

  if (code !== 0) {
    throw new Error(`\`${argv.join(' ')}\` falló con código ${code}`)
  }
}

/** Compila el anfitrión de esta plataforma y devuelve su ruta. */
export async function buildDesktop(): Promise<string> {
  await run(['cargo', 'build', '--release', '--manifest-path', MANIFEST])

  const binario = hostBinary()

  if (!(await Bun.file(binario).exists())) {
    throw new Error(`cargo terminó bien y no hay binario en ${binario}`)
  }

  return binario
}

/**
 * El listón del árbol de Rust.
 *
 * Existe porque `bun test` no mira ni una línea de Rust: sin este comando, el
 * módulo sería el único del repositorio sin nadie que lo midiera.
 */
export async function checkDesktop(): Promise<void> {
  await run(['cargo', 'fmt', '--manifest-path', MANIFEST, '--', '--check'])
  await run([
    'cargo',
    'clippy',
    '--manifest-path',
    MANIFEST,
    '--all-targets',
    '--',
    '-D',
    'warnings',
  ])
  await run(['cargo', 'test', '--manifest-path', MANIFEST])
}

/**
 * Copia el anfitrión al directorio donde el instalador lo recoge.
 *
 * Se copia y no se compila ahí porque `cargo` escribe en su `target/`, que está
 * ignorado: el directorio de trabajo del paquete tiene que quedarse con los dos
 * ejecutables juntos y nada más.
 */
export async function stageDesktop(
  outDir: string,
  platform: string = process.platform,
): Promise<string> {
  const origen = hostBinary(platform)

  if (!(await Bun.file(origen).exists())) {
    throw new Error(`no hay anfitrión que preparar en ${origen}: compílalo antes`)
  }

  await mkdir(outDir, { recursive: true })

  const destino = join(outDir, platform === 'win32' ? `${HOST_NAME}.exe` : HOST_NAME)
  await copyFile(origen, destino)

  return destino
}

/**
 * La versión del `[package]` de un `Cargo.toml`.
 *
 * Pura y exportada porque la usa una prueba: la versión del anfitrión tiene que
 * ser la misma que la de los diez `package.json`, y `release-please` no sabe
 * tocar un `Cargo.toml`. Esa prueba es la que avisa el día que se desvíen.
 */
export function cargoVersion(text: string): string | undefined {
  const lineas = text.split(/\r?\n/)
  let enPackage = false

  for (const linea of lineas) {
    const limpia = linea.trim()

    if (limpia.startsWith('[')) {
      enPackage = limpia === '[package]'
      continue
    }

    if (!enPackage) continue

    const coincidencia = /^version\s*=\s*"([^"]+)"/.exec(limpia)
    if (coincidencia !== null) return coincidencia[1]
  }

  return undefined
}

/** La versión del manifiesto del anfitrión. */
export async function manifestVersion(): Promise<string | undefined> {
  return cargoVersion(await Bun.file(MANIFEST).text())
}

if (import.meta.main) {
  const orden = Bun.argv[2]

  try {
    if (orden === 'check') {
      await checkDesktop()
      process.stdout.write('el árbol de Rust pasa fmt, clippy y sus pruebas\n')
    } else if (orden === 'build') {
      const binario = await buildDesktop()
      process.stdout.write(`anfitrión: ${binario}\n`)
    } else {
      process.stderr.write('uso: desktop.ts <check|build>\n')
      process.exitCode = 2
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
