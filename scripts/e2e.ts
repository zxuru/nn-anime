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
 *
 * Los argumentos de la orden se reenvían a Playwright. Sin eso, `bun run e2e
 * --shard=1/2` corría la suite entera y los dos trabajos del CI sumaban el doble
 * de pruebas: el `--shard` se quedaba en `process.argv` y nadie lo leía.
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const raiz = join(import.meta.dir, '..')
const cache = join(raiz, '.tmp', 'playwright-cache')

/**
 * La orden de Playwright con los argumentos que llegan del `bun run`.
 *
 * El filtro del proveedor caído va primero y el usuario no puede quitarlo: esa
 * prueba necesita `e2e:fallo`, otro puerto y otro modo de fallo, y en la suite
 * normal se quedaría esperando a un proveedor que no falla.
 *
 * Un `--` suelto se descarta porque `bun run` lo conserva cuando se escribe
 * `bun run e2e -- --shard=1/2`, y Playwright no lo entiende.
 */
export function argumentosDePlaywright(argumentos: readonly string[]): string[] {
  return [
    'test',
    '--grep-invert',
    'proveedor que falla',
    ...argumentos.filter((argumento) => argumento !== '--'),
  ]
}

export async function lanzar(
  argumentos: readonly string[] = process.argv.slice(2),
): Promise<number> {
  await mkdir(cache, { recursive: true })

  const proceso = Bun.spawn(['bunx', 'playwright', ...argumentosDePlaywright(argumentos)], {
    cwd: raiz,
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env, PLAYWRIGHT_TRANSFORM_CACHE_DIR: cache },
  })

  return proceso.exited
}

if (import.meta.main) {
  process.exit(await lanzar())
}
