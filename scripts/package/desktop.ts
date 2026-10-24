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
 *   bun run desktop:check                          fmt, clippy y pruebas del árbol de Rust
 *   bun run desktop:build                          compila el anfitrión de esta máquina
 *   bun run desktop:build --target=darwin-x64      lo compila cruzado para otro objetivo
 */

import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ROOT } from '../workspaces'
import { TARGETS } from './binary'

/** El manifiesto del árbol de Rust. `cargo` recibe siempre esta ruta. */
export const MANIFEST = join(ROOT, 'desktop', 'src-tauri', 'Cargo.toml')

/** El directorio del árbol de Rust. */
export const CRATE_DIR = dirname(MANIFEST)

/** El nombre del anfitrión. **Distinto** del servidor, que se instala al lado. */
export const HOST_NAME = 'nn-anime-desktop'

/** El nombre del servidor, tal y como lo busca `sidecar.rs`. */
export const SERVER_NAME = 'nn-anime'

/**
 * El nombre del archivo del anfitrión en una plataforma.
 *
 * Se aceptan los dos nombres de Windows a propósito: `process.platform` dice
 * `win32` y el nombre del artefacto dice `windows`. Confundirlos buscaría un
 * `.exe` como si no lo fuera y el empaquetado fallaría por un archivo que sí está.
 */
export function hostFileName(platform: string): string {
  return platform === 'win32' || platform === 'windows' ? `${HOST_NAME}.exe` : HOST_NAME
}

/** El nombre de plataforma del artefacto a partir del de `process`. */
export function platformName(platform: string = process.platform): string {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'

  return platform
}

/**
 * El triple de Rust de un objetivo.
 *
 * Existe porque el empaquetado **no** puede dar por hecho que compila para la
 * máquina en la que corre: `macos-latest` es arm64 y de ahí salen los dos `.dmg`,
 * el de Apple Silicon y el de Intel. Sin el triple, el `.dmg` de Intel llevaría
 * dentro un anfitrión arm64 —un ejecutable que no arranca— y se descubriría al
 * instalarlo.
 */
export function rustTriple(platform: string, arch: string): string | undefined {
  const normal = platformName(platform)

  if (normal === 'windows') {
    if (arch === 'x64') return 'x86_64-pc-windows-msvc'
    if (arch === 'arm64') return 'aarch64-pc-windows-msvc'
  }

  if (normal === 'macos') {
    if (arch === 'x64') return 'x86_64-apple-darwin'
    if (arch === 'arm64') return 'aarch64-apple-darwin'
  }

  if (normal === 'linux') {
    if (arch === 'x64') return 'x86_64-unknown-linux-gnu'
    if (arch === 'arm64') return 'aarch64-unknown-linux-gnu'
  }

  return undefined
}

/** La clave de `TARGETS` de una plataforma y una arquitectura, si está publicada. */
export function targetKey(platform: string, arch: string): string | undefined {
  const normal = platformName(platform)

  return Object.keys(TARGETS).find((clave) => {
    const spec = TARGETS[clave]

    return spec !== undefined && spec.platform === normal && spec.arch === arch
  })
}

/** `true` si el objetivo es el de la máquina en la que corre esto. */
export function isNative(platform: string, arch: string): boolean {
  return platformName(platform) === platformName() && arch === process.arch
}

/**
 * Dónde deja `cargo` el binario del anfitrión.
 *
 * **Siempre** bajo el directorio del triple, y no en `target/release`, porque
 * `buildDesktop` pasa `--target` en todas las compilaciones: con una sola forma de
 * la ruta, no hay dos sitios donde buscar ni una rama que se olvide de probar.
 */
export function hostBinary(
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  const triple = rustTriple(platform, arch)

  if (triple === undefined) {
    throw new Error(`no hay objetivo de Rust para ${platform}-${arch}`)
  }

  return join(CRATE_DIR, 'target', triple, 'release', hostFileName(platform))
}

export interface RunOptions {
  /** Directorio de trabajo del comando. */
  readonly cwd?: string
  /** Entorno del proceso, si hay que añadirle algo. */
  readonly env?: Record<string, string | undefined>
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
    ...(options.env === undefined ? {} : { env: options.env }),
  })

  const code = await proceso.exited

  if (code !== 0) {
    throw new Error(`\`${argv.join(' ')}\` falló con código ${code}`)
  }
}

/** Compila el anfitrión y devuelve su ruta. */
export interface BuildDesktopOptions {
  /** Clave de `TARGETS` (`darwin-x64`). Por defecto, el de esta máquina. */
  readonly target?: string
  /**
   * Compila el anfitrión **sin exigir** el servidor embebido.
   *
   * Es para el trabajo `desktop` del CI, que compila el anfitrión para medir el
   * árbol de Rust y no está empaquetando nada. El empaquetado y la release **no**
   * lo usan: allí el servidor tiene que estar, o el `.exe` arranca sin interfaz.
   */
  readonly sinServidor?: boolean
}

/**
 * Compila el anfitrión, del objetivo que se le diga.
 *
 * Se pasa `--target` **siempre**, también cuando el objetivo es el de esta
 * máquina: así la ruta del binario es una sola y no hay un caso que se pruebe y
 * otro que no.
 */
export async function buildDesktop(options: BuildDesktopOptions = {}): Promise<string> {
  const spec = options.target === undefined ? undefined : TARGETS[options.target]

  if (options.target !== undefined && spec === undefined) {
    throw new Error(
      `objetivo desconocido: ${options.target}. Los que hay: ${Object.keys(TARGETS).join(', ')}`,
    )
  }

  const platform = spec?.platform ?? platformName()
  const arch = spec?.arch ?? process.arch
  const triple = rustTriple(platform, arch)

  if (triple === undefined) {
    throw new Error(`no hay objetivo de Rust para ${platform}-${arch}`)
  }

  // Una compilación cruzada necesita el objetivo en el toolchain. Se añade aquí
  // en vez de comprobarlo: `rustup target add` sobre uno que ya está no descarga
  // nada, y sin `rustup` el error que sale es el de `cargo`, que dice lo mismo.
  if (!isNative(platform, arch)) {
    process.stdout.write(`compilación cruzada: se añade el objetivo ${triple}\n`)
    await run(['rustup', 'target', 'add', triple])
  }

  // `--locked`: el `Cargo.lock` está versionado y la release tiene que usar
  // exactamente ese árbol, no el que resuelva cargo ese día.
  // `NN_ANIME_EXIGIR_SERVIDOR`: en Windows, cuando lo compila el empaquetado,
  // `build.rs` **falla** si no encuentra el servidor en vez de generar un
  // anfitrión vacío. Un `.exe` sin servidor dentro arranca, enseña el aviso de
  // fallo y parece un problema del instalador; el fallo tiene que estar aquí, con
  // la ruta delante. En macOS y Linux no se exige: allí el servidor viaja al lado.
  // El trabajo `desktop` del CI pasa `sinServidor`: compila para medir el árbol de
  // Rust, no para entregar.
  const exigir = platform === 'windows' && options.sinServidor !== true

  await run(
    ['cargo', 'build', '--release', '--locked', '--target', triple, '--manifest-path', MANIFEST],
    exigir ? { env: { ...process.env, NN_ANIME_EXIGIR_SERVIDOR: '1' } } : {},
  )

  const binario = hostBinary(platform, arch)

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
    '--locked',
    '--manifest-path',
    MANIFEST,
    '--all-targets',
    '--',
    '-D',
    'warnings',
  ])
  await run(['cargo', 'test', '--locked', '--manifest-path', MANIFEST])
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
  arch: string = process.arch,
): Promise<string> {
  // El binario del objetivo, y no el de esta máquina: en la matriz de la release
  // `macos-latest` arma los dos `.dmg` y cada uno tiene que llevarse el suyo. Si
  // no está, es que no se compiló para ese objetivo, y se dice cuál falta.
  const origen = hostBinary(platform, arch)

  if (!(await Bun.file(origen).exists())) {
    const clave = targetKey(platform, arch)

    throw new Error(
      `no hay anfitrión que preparar en ${origen}: compílalo antes con ` +
        `\`bun run desktop:build${clave === undefined ? '' : ` --target=${clave}`}\``,
    )
  }

  await mkdir(outDir, { recursive: true })

  const destino = join(outDir, hostFileName(platform))
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
  const argv = Bun.argv.slice(2)
  const orden = argv[0]
  const flag = (nombre: string): string | undefined =>
    argv.find((arg) => arg.startsWith(`--${nombre}=`))?.slice(nombre.length + 3)

  try {
    if (orden === 'check') {
      await checkDesktop()
      process.stdout.write('el árbol de Rust pasa fmt, clippy y sus pruebas\n')
    } else if (orden === 'build') {
      const target = flag('target')
      const binario = await buildDesktop({
        ...(target === undefined ? {} : { target }),
        ...(argv.includes('--sin-servidor') ? { sinServidor: true } : {}),
      })
      process.stdout.write(`anfitrión: ${binario}\n`)
    } else {
      process.stderr.write('uso: desktop.ts <check|build> [--target=darwin-x64] [--sin-servidor]\n')
      process.exitCode = 2
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
