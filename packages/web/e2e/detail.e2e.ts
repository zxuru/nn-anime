import { expect, test } from '@playwright/test'
import { entrar } from './fixtures'

/**
 * El camino de la búsqueda al detalle, en un navegador.
 *
 * Lo que se prueba aquí es que la navegación sin recargar funciona de verdad: se
 * busca, se elige un título y se llega a su ficha con su lista de episodios. Es
 * el camino crítico de la aplicación y el que rompe si alguien toca el enrutador.
 */

test.describe('de la búsqueda al detalle', () => {
  test('buscar, elegir y ver los episodios', async ({ page }) => {
    await entrar(page)

    await page.goto('/search')
    await page.getByLabel('Buscar por título').fill('aurora')
    await expect(page.getByText('Aurora Nocturna')).toBeVisible({ timeout: 10_000 })

    await page.getByText('Aurora Nocturna').first().click()

    // La ficha, sin recargar: la dirección cambia y el contenido es el del título.
    await expect(page).toHaveURL(/\/anime\/fixture\/aurora-nocturna/)
    await expect(page.getByRole('heading', { name: 'Aurora Nocturna' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByRole('heading', { name: 'Episodios' })).toBeVisible()
    // El número y el título del episodio dicen lo mismo, así que hay dos
    // coincidencias: se pide la primera.
    await expect(page.locator('.episodes li')).toHaveCount(12, { timeout: 15_000 })
    await expect(page.getByText('Episodio 1').first()).toBeVisible()
  })

  test('el detalle anuncia de dónde salió con `X-Cache`', async ({ page }) => {
    await entrar(page)

    // La URL del detalle, no la de sus episodios: las dos empiezan igual y la de
    // episodios también responde con `X-Cache`, así que la comparación tiene que
    // ser exacta o la prueba mide la respuesta equivocada.
    const respuesta = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/anime/fixture/aurora-nocturna' && r.status() === 200,
      { timeout: 15_000 },
    )

    await page.goto('/anime/fixture/aurora-nocturna')

    expect((await respuesta).headers()['x-cache']).toMatch(/hit|miss|stale/)
  })
})
