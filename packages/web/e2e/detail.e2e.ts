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

  /**
   * La ficha es la puerta del reproductor.
   *
   * Este caso faltaba y por eso el fallo llegó hasta aquí: el reproductor se
   * probaba entrando a su dirección a mano, y nadie comprobaba que se pudiera
   * llegar a él desde la aplicación. La pantalla enseñaba los episodios y no
   * abría ninguno.
   */
  test('de la ficha al reproductor con un clic en el episodio', async ({ page }) => {
    await entrar(page)

    await page.goto('/anime/fixture/aurora-nocturna')
    await expect(page.locator('.episodes li')).toHaveCount(12, { timeout: 15_000 })

    // El enlace lleva el episodio en la dirección y el modo elegido en la
    // consulta: el reproductor abre en subtitulado, que es el que ofrece el
    // proveedor y el que sale marcado.
    const tercero = page.locator('.episodes li').nth(2).getByRole('link')
    await expect(tercero).toHaveAttribute('href', '/watch/fixture/aurora-nocturna%233?mode=sub')

    await tercero.click()

    await expect(page).toHaveURL(/\/watch\/fixture\/aurora-nocturna%233\?mode=sub/)
    // El reproductor, montado y con su fuente: no basta con que la dirección
    // cambie.
    await expect(page.locator('video')).toBeVisible({ timeout: 15_000 })
  })

  test('el modo elegido en la ficha viaja al reproductor', async ({ page }) => {
    await entrar(page)

    await page.goto('/anime/fixture/aurora-nocturna')
    await expect(page.locator('.episodes li')).toHaveCount(12, { timeout: 15_000 })

    await page.getByRole('button', { name: 'Doblado' }).click()
    await expect(page.getByRole('button', { name: 'Doblado' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await page.locator('.episodes li').first().getByRole('link').click()

    await expect(page).toHaveURL(/\/watch\/fixture\/aurora-nocturna%231\?mode=dub/)
    await expect(page.locator('video')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Doblado' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
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
