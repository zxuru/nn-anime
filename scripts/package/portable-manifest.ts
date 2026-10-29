#!/usr/bin/env bun
/**
 * Añade la entrada del `.exe` portable a `latest.json`.
 *
 * `tauri-action` escribe el manifiesto con el instalador NSIS, que es lo que usa
 * la copia instalada. La copia portable no ejecuta instaladores: se reemplaza a
 * sí misma, así que necesita su propia entrada, `windows-x86_64-portable`, con la
 * URL del archivo único y la firma minisign que `publicar` ya tiene en `release/`.
 *
 * Se hace aquí y no en `tauri-action` porque el `.exe` único lo sube `publicar`
 * (el trabajo de Windows sólo lo compila y lo firma), y el manifiesto se puede
 * modificar en el borrador antes de publicarlo.
 *
 * Uso:
 *   bun run scripts/package/portable-manifest.ts <latest.json> <firma.sig> <url>
 */

import { readFile, writeFile } from 'node:fs/promises'
import { isRecord } from '../workspaces'

/** La clave que busca el anfitrión portable (`tauri.conf.json` + `actualizacion.rs`). */
export const CLAVE_PORTABLE = 'windows-x86_64-portable'

/**
 * Devuelve el manifiesto con la entrada del portable.
 *
 * No toca las demás plataformas: el instalador de Windows y los bundles de
 * macOS/Linux siguen como los dejó `tauri-action`.
 */
export function agregarPortable(
  latest: unknown,
  firma: string,
  url: string,
): Record<string, unknown> {
  if (!isRecord(latest) || !isRecord(latest.platforms)) {
    throw new Error('latest.json no tiene un objeto platforms')
  }

  if (firma === '' || url === '') {
    throw new Error('faltan la firma o la URL del .exe portable')
  }

  return {
    ...latest,
    platforms: {
      ...latest.platforms,
      [CLAVE_PORTABLE]: { signature: firma, url },
    },
  }
}

if (import.meta.main) {
  const [ruta, firmaRuta, url] = Bun.argv.slice(2)

  if (ruta === undefined || firmaRuta === undefined || url === undefined) {
    process.stderr.write('uso: portable-manifest.ts <latest.json> <firma.sig> <url>\n')
    process.exitCode = 2
  } else {
    try {
      const latest: unknown = JSON.parse(await readFile(ruta, 'utf8'))
      const firma = await readFile(firmaRuta, 'utf8')

      await writeFile(ruta, `${JSON.stringify(agregarPortable(latest, firma, url), null, 2)}\n`)
      process.stdout.write(`${CLAVE_PORTABLE} -> ${url}\n`)
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    }
  }
}
