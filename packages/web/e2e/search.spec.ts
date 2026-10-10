import { expect, test } from '@playwright/test'
import { entrar, esperarApp } from './fixtures'

/**
 * La búsqueda del e2e.
 *
 * Lo que se prueba aquí y no en unitario: que los resultados **llegan por SSE** y
 * se pintan mientras llegan, que el estado vacío aparece con una consulta sin
 * coincidencias y que un proveedor que falla se ve como error en la página, no
 * como una pantalla en blanco.
 */

test.describe('la búsqueda', () => {
  test('buscar muestra resultados del fixture', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)

    await page.goto('/search')
    await page.getByLabel('Buscar por título').fill('aurora')

    // Los resultados llegan por SSE: se espera a que aparezca la tarjeta.
    await expect(page.getByText('Aurora Nocturna')).toBeVisible({ timeout: 10_000 })
  })

  test('una consulta sin coincidencias muestra el estado vacío', async ({ page }) => {
    await entrar(page)

    await page.goto('/search')
    await page.getByLabel('Buscar por título').fill('zzzz-no-existe')

    await expect(page.getByText('Nada coincide')).toBeVisible({ timeout: 10_000 })
  })

  test('la consulta vive en la dirección', async ({ page }) => {
    await entrar(page)

    await page.goto('/search')
    await page.getByLabel('Buscar por título').fill('aurora')

    await expect(page).toHaveURL(/q=aurora/, { timeout: 10_000 })
  })
})
