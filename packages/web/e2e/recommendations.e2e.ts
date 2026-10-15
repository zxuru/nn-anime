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

    // Las razones se leen en el panel, que es donde vive el motor: el top de la
    // home es el de la fuente y no lleva motivos. El panel está dentro de un
    // desplegable, así que hay que abrirlo para que sus tarjetas se vean.
    await page.getByText('¿Por qué estas recomendaciones?').click()

    const razones = page.locator('.panel .reason')

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

    await expect(
      page.locator('.panel').getByText(/Sin historial todavía|Ordenado por lo que has visto/),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('el detalle del score se abre y se cierra', async ({ page }) => {
    await entrar(page)
    await page.getByText('¿Por qué estas recomendaciones?').click()

    await page.getByRole('button', { name: 'Ver el detalle' }).click()

    const puntuaciones = page.locator('.panel').getByText(/Puntuación:/)

    await expect(puntuaciones.first()).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: 'Ocultar el detalle' }).click()
    await expect(puntuaciones).toHaveCount(0)
  })
})
