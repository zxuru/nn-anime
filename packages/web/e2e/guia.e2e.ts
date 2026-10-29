import { expect, test } from '@playwright/test'
import { CLAVE_GUIA, VERSION_GUIA } from '../src/features/guia/guia'
import { BASE } from './fixtures'

/**
 * La guía, en el navegador.
 *
 * Lo que se mide aquí no se puede medir sin DOM: que la bienvenida salga sola la
 * primera vez, que el recorrido avance, que cerrarla la dé por vista y que un
 * aviso de novedad salga una vez y no vuelva. El `setup` deja la guía como vista
 * para que el resto de la suite no se la encuentre encima.
 */

const POPOVER = '.driver-popover.nn-guia'

test.describe('la guía de la aplicación', () => {
  test('la bienvenida sale sola, se recorre y no vuelve', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await page.evaluate((clave) => localStorage.removeItem(clave), CLAVE_GUIA)
    await page.reload()

    const popover = page.locator(POPOVER)
    await expect(popover).toBeVisible({ timeout: 15_000 })
    await expect(popover).toContainText('La casa, en seis paradas')
    await expect(popover).toContainText('1 de 7')

    await page.locator('.driver-popover-next-btn').click()
    await expect(popover).toContainText('Aquí te mueves')
    await expect(popover).toContainText('2 de 7')

    await page.keyboard.press('Escape')
    await expect(page.locator('.driver-overlay')).toHaveCount(0)

    // Cerrarla cuenta como verla: al volver a abrir la aplicación no sale.
    await page.reload()
    await page.waitForTimeout(2000)
    await expect(page.locator(POPOVER)).toHaveCount(0)
  })

  test('un aviso de novedad sale una vez y se descarta', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await page.evaluate(
      ({ clave, v }) => {
        localStorage.setItem(clave, JSON.stringify({ v, bienvenida: true, vistos: [] }))
      },
      { clave: CLAVE_GUIA, v: VERSION_GUIA },
    )
    await page.reload()

    const faro = page.locator('.driver-hint')
    await expect(faro).toBeVisible({ timeout: 15_000 })
    await faro.click()

    const aviso = page.locator('.driver-popover.nn-guia-aviso')
    await expect(aviso).toBeVisible()
    await expect(aviso).toContainText('Nuevo: descargas')

    await page.locator('.driver-popover-next-btn').click()
    await expect(page.locator('.driver-hint')).toHaveCount(0)

    await page.reload()
    await page.waitForTimeout(2000)
    await expect(page.locator('.driver-hint')).toHaveCount(0)
  })

  test('Ajustes repite la bienvenida', async ({ page }) => {
    await page.goto(`${BASE}/settings`)

    await page.getByRole('button', { name: 'Ver la bienvenida' }).click()

    await expect(page.locator(POPOVER)).toBeVisible({ timeout: 10_000 })
    await expect(page.locator(POPOVER)).toContainText('La casa, en seis paradas')
  })
})
