/**
 * Andamiaje del e2e.
 *
 * El servidor lo levanta Playwright, pero **el primer acceso necesita el token de
 * arranque**: la aplicación no deja entrar sin canjearlo, y eso es una de las
 * mitigaciones del spec. El servidor lo publica en un archivo dentro de `.tmp/`
 * porque Playwright no le da a las pruebas su salida.
 *
 * Aquí no hay ninguna dirección de un sitio real: el plugin es el fixture del
 * repositorio y sus direcciones son `fixture.invalid`, que no resuelve.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'

/** El puerto del servidor del e2e. */
export const PORT = Number(process.env.NN_ANIME_E2E_PORT ?? '7801')
export const BASE = `http://127.0.0.1:${PORT}`

const RUTA_TOKEN = fileURLToPath(new URL('../../../.tmp/e2e-boot-token', import.meta.url))

/** Donde el `setup` deja la sesión ya canjeada. */
export const RUTA_ESTADO = fileURLToPath(new URL('../../../.tmp/e2e-state.json', import.meta.url))

/** El token de arranque, esperando a que el servidor lo publique. */
export async function bootToken(): Promise<string> {
  for (let intento = 0; intento < 100; intento++) {
    try {
      const token = (await readFile(RUTA_TOKEN, 'utf8')).trim()
      if (token !== '') return token
    } catch {
      // Todavía no está: el servidor tarda en arrancar.
    }

    await new Promise((resolver) => setTimeout(resolver, 100))
  }

  throw new Error(`el servidor del e2e no publicó su token en ${RUTA_TOKEN}`)
}

/**
 * Entra en la aplicación.
 *
 * La sesión ya está canjeada y guardada por el `setup`: aquí sólo se navega. El
 * token es de un solo uso, así que canjearlo en cada prueba haría que la segunda
 * fallara con un 401.
 */
export async function entrar(page: Page): Promise<void> {
  await page.goto(`${BASE}/`)
  await page.waitForLoadState('networkidle')
}

/** Espera a que la aplicación esté montada. */
export async function esperarApp(page: Page): Promise<void> {
  await expect(page.locator('.shell__brand')).toBeVisible()
}
