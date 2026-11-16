#!/usr/bin/env bun
/**
 * Escribe el `latest.json` que consulta el auto-actualizador.
 *
 * Antes lo escribía `tauri-action` a partir del instalador NSIS. Ya no hay
 * instalador: la única entrega de Windows es el `.exe` portable, que se reemplaza
 * a sí mismo, así que el manifiesto se arma aquí con la URL y la firma minisign de
 * ese archivo.
 *
 * Se anuncian **dos** entradas con el mismo `.exe`: `windows-x86_64` es la que
 * resuelve `check()` al preguntar por la plataforma, y `windows-x86_64-portable`
 * es la que lee la ventana para saber qué descargar. Las dos apuntan al portable
 * porque no hay ningún otro binario que ofrecer.
 *
 * Uso:
 *   bun run scripts/package/portable-manifest.ts <versión> <firma.sig> <url> <salida>
 */

import { readFile, writeFile } from 'node:fs/promises'

/** La clave que busca el anfitrión portable (`actualizacion.rs`). */
export const CLAVE_PORTABLE = 'windows-x86_64-portable'

/** La clave que resuelve `check()` en Windows. */
export const CLAVE_PLATAFORMA = 'windows-x86_64'

/**
 * Devuelve el manifiesto con las dos entradas de Windows apuntando al portable.
 *
 * `pubDate` se puede pasar para que la prueba no dependa del reloj; el CLI usa la
 * hora actual en UTC.
 */
export function manifiestoPortable(
  version: string,
  firma: string,
  url: string,
  pubDate: string,
): Record<string, unknown> {
  if (version === '' || firma === '' || url === '') {
    throw new Error('faltan la versión, la firma o la URL del .exe portable')
  }

  const entrada = { signature: firma.trim(), url }

  return {
    version,
    pub_date: pubDate,
    platforms: {
      [CLAVE_PLATAFORMA]: entrada,
      [CLAVE_PORTABLE]: entrada,
    },
  }
}

if (import.meta.main) {
  const [version, firmaRuta, url, salida] = Bun.argv.slice(2)

  if (version === undefined || firmaRuta === undefined || url === undefined) {
    process.stderr.write(
      'uso: portable-manifest.ts <versión> <firma.sig> <url> [salida=release/latest.json]\n',
    )
    process.exitCode = 2
  } else {
    try {
      const firma = await readFile(firmaRuta, 'utf8')
      const manifiesto = manifiestoPortable(version, firma, url, new Date().toISOString())
      const destino = salida ?? 'release/latest.json'

      await writeFile(destino, `${JSON.stringify(manifiesto, null, 2)}\n`)
      process.stdout.write(`${destino}: ${CLAVE_PLATAFORMA} y ${CLAVE_PORTABLE} -> ${url}\n`)
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    }
  }
}
