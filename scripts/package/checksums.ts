#!/usr/bin/env bun
/**
 * Los checksums de lo que se publica.
 *
 * Quien descarga un instalador de la página de releases no tiene forma de saber
 * que el archivo llegó entero, y «lo descargué de GitHub» es una respuesta que
 * no se puede comprobar. Con `SHA256SUMS.txt` sí:
 *
 *     sha256sum -c SHA256SUMS.txt
 *
 * El formato es el de `sha256sum`: el hash, **dos espacios** y el nombre del
 * archivo —sólo el nombre, sin directorio— para que la comprobación funcione
 * desde el directorio donde se descargó. Se escribe en orden alfabético para que
 * dos ejecuciones del mismo conjunto den el mismo archivo.
 */

import { stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { ROOT } from '../workspaces'

export const CHECKSUMS_NAME = 'SHA256SUMS.txt'

/** El hash de un archivo, en minúsculas como los escribe `sha256sum`. */
export async function hashOf(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(await Bun.file(path).arrayBuffer())

  return hasher.digest('hex')
}

/**
 * Escribe el archivo de checksums y devuelve cuántos puso.
 *
 * Falla si un archivo pesa cero: un instalador vacío produce un hash
 * perfectamente válido y un release roto, y el hash no lo delata.
 */
export async function writeChecksums(files: readonly string[], output: string): Promise<number> {
  const lineas: string[] = []

  for (const file of [...files].sort()) {
    const tamano = Bun.file(file).size
    if (tamano === 0) throw new Error(`${file} está vacío: no se publica un instalador de 0 bytes`)

    lineas.push(`${await hashOf(file)}  ${basename(file)}`)
  }

  const cabecera = [
    '# SHA256 de los archivos de esta release de nn-anime.',
    '#',
    '# Comprobar:  sha256sum -c SHA256SUMS.txt',
    '#',
    '# Cada línea es el hash del archivo que nombra, tal como se descargó. Con',
    '# esto se puede comprobar que la descarga llegó entera; sin esto, «lo bajé',
    '# de GitHub» es lo único que se puede decir.',
    '',
  ].join('\n')

  await Bun.write(output, `${cabecera}${lineas.join('\n')}\n`)

  return lineas.length
}

/** Los archivos regulares de un directorio, sin el propio resumen. */
export async function artifactsIn(directory: string): Promise<readonly string[]> {
  const glob = new Bun.Glob('*')
  const encontrados: string[] = []

  for await (const name of glob.scan({ cwd: directory })) {
    if (name === CHECKSUMS_NAME) continue

    const path = join(directory, name)
    if ((await stat(path)).isFile()) encontrados.push(path)
  }

  return encontrados.sort()
}

/**
 * Los checksums de un directorio entero.
 *
 * Se ejecuta en el trabajo que **junta** los artefactos de las tres plataformas:
 * un `SHA256SUMS.txt` por plataforma serían tres archivos con el mismo nombre en
 * la misma release, y el que quedara hablaría sólo de una.
 *
 * Uso: `bun run scripts/package/checksums.ts [directorio]`
 */
if (import.meta.main) {
  const directory = Bun.argv[2] ?? join(ROOT, 'release')

  try {
    const archivos = await artifactsIn(directory)

    if (archivos.length === 0) {
      throw new Error(`${directory} no tiene ningún archivo que resumir`)
    }

    const puestos = await writeChecksums(archivos, join(directory, CHECKSUMS_NAME))
    process.stdout.write(`${puestos} archivos resumidos en ${join(directory, CHECKSUMS_NAME)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
