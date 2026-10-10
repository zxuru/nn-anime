import { expect, test } from '@playwright/test'
import { entrar, esperarApp } from './fixtures'

/**
 * Un proveedor que falla.
 *
 * El plugin del e2e falla en el método que diga `NN_ANIME_E2E_FALLO`, y esta
 * prueba comprueba que el fallo **se ve**: la interfaz dice qué pasó en vez de
 * dejar una pantalla en blanco o un esqueleto que no termina nunca.
 *
 * La prueba se salta si el arnés no levantó el servidor en modo fallo: el modo se
 * elige al arrancar el servidor, y arrancarlo dos veces por ejecución costaría más
 * de lo que aporta.
 */

const FALLO = process.env.NN_ANIME_E2E_FALLO ?? ''

test.describe('un proveedor que falla', () => {
  // El modo de fallo se elige al arrancar el servidor, así que este archivo se
  // ejecuta en su propia pasada (`bun run e2e:fallo`), con `NN_ANIME_E2E_FALLO`
  // puesta y en otro puerto. Ejecutarlo sin ella no probaría nada.
  test.skip(FALLO === '', 'el servidor no se levantó en modo fallo')

  test('el fallo se anuncia en la búsqueda', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)

    await page.goto('/search')
    await page.getByLabel('Buscar por título').fill('aurora')

    // La superficie de error de la búsqueda: un proveedor que falla tiene que
    // verse ahí, con su nombre, en vez de dejar la lista a medias sin explicación.
    const error = page.locator('.search__error').first()

    await expect(error).toBeVisible({ timeout: 10_000 })
    // El nombre del proveedor es su nombre visible, no su identificador.
    await expect(error).toContainText('Proveedor de prueba')
  })
})
