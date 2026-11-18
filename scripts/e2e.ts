/**
 * Lanza el e2e con sus cachés dentro de `.tmp/`.
 *
 * Playwright guarda su caché de transformación en el temporal del sistema, y en
 * un sandbox de escritura abrir un archivo ahí falla con `EPERM`: el runner ni
 * siquiera llega a recoger las pruebas. La variable hay que fijarla **antes** de
 * que arranque Playwright —su cargador transforma hasta este mismo archivo de
 * configuración—, así que no basta con ponerla en `playwright.config.ts`.
 *
 * El navegador y los datos del servidor ya viven en `.tmp/`; esto es la tercera
 * pieza que faltaba para que el e2e no dependa de escribir fuera del repositorio.
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const raiz = join(import.meta.dir, '..')
const cache = join(raiz, '.tmp', 'playwright-cache')
await mkdir(cache, { recursive: true })

const proceso = Bun.spawn(['bunx', 'playwright', 'test', '--grep-invert', 'proveedor que falla'], {
  cwd: raiz,
  stdio: ['inherit', 'inherit', 'inherit'],
  env: { ...process.env, PLAYWRIGHT_TRANSFORM_CACHE_DIR: cache },
})

process.exit(await proceso.exited)
