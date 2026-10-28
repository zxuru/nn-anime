import { expect, test } from '@playwright/test'
import { entrar } from './fixtures'

/**
 * La página de Descargas, sin nada descargado.
 *
 * El e2e del motor necesita una fuente que descargue y una red de mentira; aquí
 * sólo se mide la pantalla: que exista, que la navegación lleve y que el vacío se
 * explique en vez de dejar una lista en blanco.
 */
test.describe('las descargas', () => {
  test('la navegación lleva a Descargas y el vacío se explica', async ({ page }) => {
    await entrar(page)
    await page.getByRole('link', { name: 'Descargas' }).click()

    await expect(page).toHaveURL(/\/downloads$/)
    await expect(page.getByRole('heading', { name: 'Descargas' })).toBeVisible()
    await expect(
      page.getByText('No hay ninguna descarga. Abre un episodio y pulsa «Descargar».'),
    ).toBeVisible()
  })

  test('una fuente que declara la capacidad ofrece el botón', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna')

    await expect(page.getByRole('button', { name: 'Descargar' })).toBeVisible({
      timeout: 10_000,
    })
  })
})
