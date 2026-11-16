#!/usr/bin/env bun
/**
 * Imprime la versión del esquema de una base, en sólo lectura.
 *
 * Vive en `scripts/` y no en el e2e porque `packages/web/e2e/persistencia.e2e.ts`
 * lo lanza como proceso: Playwright carga las pruebas con el cargador de Node, y
 * `bun:sqlite` sólo existe dentro de Bun. Y vive fuera de `packages/` a
 * propósito: la prueba de propiedad del almacén comprueba que ningún paquete
 * fuera de `catalog-store` nombra el módulo de SQLite, y este script no es un
 * paquete.
 *
 * Uso:
 *   bun run scripts/leer-version-esquema.ts <ruta-de-la-base>
 */

import { Database } from 'bun:sqlite'

const ruta = Bun.argv[2]

if (ruta === undefined || ruta === '') {
  process.stderr.write('uso: leer-version-esquema.ts <ruta-de-la-base>\n')
  process.exit(2)
}

const db = new Database(ruta, { readonly: true })

try {
  const fila = db
    .query<{ version: number | null }, []>('SELECT MAX(version) AS version FROM schema_version')
    .get()

  process.stdout.write(`${String(fila?.version ?? 0)}\n`)
} finally {
  db.close()
}
