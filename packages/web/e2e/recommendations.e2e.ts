import { expect, test } from '@playwright/test'
import { entrar } from './fixtures'

/**
 * El panel de recomendaciones.
 *
 * La comprobación que importa: **cada recomendación visible lleva una razón con
 * texto**. Una recomendación sin explicación es lo que el spec prohíbe, y aquí se
 * mira en el navegador, sobre lo que se ve, no sobre lo que devuelve la API.
 */

test.describe('las recomendaciones', () => {
  test('cada recomendación visible tiene una razón no vacía', async ({ page }) => {
    await entrar(page)

    // Las razones del top, que es donde se ven: cada tarjeta lleva la suya en el
    // pie. El panel del score está en un desplegable y se prueba más abajo.
    // Sólo las del top: las otras filas llevan el año en el pie, y un año no es
    // una razón. La primera versión de esta prueba las contaba todas y fallaba
    // por un «2023».
    const razones = page.locator('.section--top .poster__meta')

    await expect(razones.first()).toBeVisible({ timeout: 10_000 })

    const textos = await razones.allTextContents()

    expect(textos.length).toBeGreaterThan(0)
    for (const texto of textos) {
      expect(texto.trim().length).toBeGreaterThan(10)
    }
  })

  test('el panel dice en qué estado está', async ({ page }) => {
    await entrar(page)

    await page.getByText('¿Por qué estas recomendaciones?').click()

    await expect(page.getByText(/Sin historial todavía|Ordenado por lo que has visto/)).toBeVisible(
      { timeout: 10_000 },
    )
  })

  test('el detalle del score se abre y se cierra', async ({ page }) => {
    await entrar(page)
    await page.getByText('¿Por qué estas recomendaciones?').click()

    await page.getByRole('button', { name: 'Ver el detalle' }).click()

    await expect(page.getByText(/Puntuación:/).first()).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: 'Ocultar el detalle' }).click()
    await expect(page.getByText(/Puntuación:/)).toHaveCount(0)
  })
})
