#!/usr/bin/env bun
/**
 * El entregable de Windows: **un solo `.exe`**.
 *
 * El anfitrión ya lleva el servidor dentro (lo mete `build.rs` con
 * `include_bytes!`), así que aquí no hay nada que compilar: se copia el binario
 * del anfitrión con el nombre que descarga un usuario.
 *
 * El orden importa y por eso el script lo comprueba: el anfitrión sólo puede
 * embeberse **después** de que exista `nn-anime.exe`, y aquí se verifica que el
 * binario del anfitrión sea más reciente que el del servidor. Si no lo es, el
 * `.exe` que se entregaría lleva un servidor viejo dentro —o ninguno—, y eso es
 * exactamente la clase de fallo silencioso que este proyecto ya ha pagado caro.
 *
 * Uso:
 *   bun run package:unico                 # deja release/nn-anime-<v>-windows-x64.exe
 *   bun run package:unico --out=otra/ruta # deja el archivo en otra carpeta
 */

import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ROOT } from '../workspaces'
import { CRATE_DIR, hostBinary, MANIFEST } from './desktop'

/** El nombre del archivo que se descarga: `nn-anime-1.2.3-windows-x64.exe`. */
export function unicoNombre(version: string): string {
  return `nn-anime-${version}-windows-x64.exe`
}

/** La versión de la raíz, que es la única que manda. */
export async function version(): Promise<string> {
  const manifiesto = (await Bun.file(join(ROOT, 'package.json')).json()) as { version?: unknown }

  if (typeof manifiesto.version !== 'string') {
    throw new Error('package.json de la raíz no declara versión')
  }

  return manifiesto.version
}

/** El servidor que `build.rs` tiene que haber embebido. */
export function servidor(): string {
  return join(ROOT, 'build', 'package', 'windows-x64', 'nn-anime.exe')
}

/**
 * Comprueba que el anfitrión se compiló **después** del servidor.
 *
 * Sin esto, un `cargo build` anterior deja dentro del `.exe` un servidor viejo, y
 * el resultado arranca con la versión de ayer sin que nadie lo note.
 */
export async function comprobarOrden(anfitrion: string, servidorCrudo: string): Promise<void> {
  const [a, s] = await Promise.all([stat(anfitrion), stat(servidorCrudo)])

  if (a.mtimeMs < s.mtimeMs) {
    throw new Error(
      `el anfitrión (${anfitrion}) es más viejo que el servidor (${servidorCrudo}):\n` +
        '  vuelve a compilarlo con `bun run desktop:build` para que lo lleve dentro',
    )
  }
}

export async function unico(options: { out?: string } = {}): Promise<string> {
  const numero = await version()
  const servidorCrudo = servidor()
  const anfitrion = hostBinary('windows', 'x64')

  if (!(await Bun.file(servidorCrudo).exists())) {
    throw new Error(
      `no hay servidor en ${servidorCrudo}: ejecuta antes \`bun run package --skip-installer\``,
    )
  }

  if (!(await Bun.file(anfitrion).exists())) {
    throw new Error(`no hay anfitrión en ${anfitrion}: ejecuta antes \`bun run desktop:build\``)
  }

  await comprobarOrden(anfitrion, servidorCrudo)

  const destino = options.out ?? join(ROOT, 'release', unicoNombre(numero))

  await mkdir(dirname(destino), { recursive: true })
  await copyFile(anfitrion, destino)

  return destino
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2)
  const out = argv.find((arg) => arg.startsWith('--out='))?.slice('--out='.length)

  try {
    const archivo = await unico(out === undefined ? {} : { out })
    const tamano = (await stat(archivo)).size

    process.stdout.write(`único: ${archivo}\n`)
    process.stdout.write(
      `  ${tamano.toLocaleString('es-ES')} bytes (${(tamano / 1024 / 1024).toFixed(1)} MB)\n`,
    )
    process.stdout.write(`  manifiesto: ${MANIFEST}\n`)
    process.stdout.write(`  crate:      ${CRATE_DIR}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
