import { expect, test } from '@playwright/test'
import { CLAVE_GUIA, RECORRIDOS, VERSION_GUIA } from '../src/features/guia/guia'
import { BASE } from './fixtures'

/**
 * La guía, en el navegador.
 *
 * Lo que se mide aquí no se puede medir sin DOM: que cada pantalla estrene su
 * recorrido la primera vez, que avance, que cerrarlo lo dé por visto, que un
 * aviso de novedad salga una vez y que Ajustes sea el índice. El `setup` deja
 * todos los recorridos vistos para que el resto de la suite no se los encuentre
 * encima.
 */

const POPOVER = '.driver-popover.nn-guia'
const TODOS = RECORRIDOS.map((recorrido) => recorrido.id)

test.describe('la guía de la aplicación', () => {
  test('el recorrido de Inicio sale solo, avanza y no vuelve', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await page.evaluate((clave) => localStorage.removeItem(clave), CLAVE_GUIA)
    await page.reload()

    const popover = page.locator(POPOVER)
    await expect(popover).toBeVisible({ timeout: 15_000 })
    await expect(popover).toContainText('Bienvenido a nn-anime')
    await expect(popover).toContainText('1 de 6')

    await page.locator('.driver-popover-next-btn').click()
    await expect(popover).toContainText('Aquí te mueves')
    await expect(popover).toContainText('2 de 6')

    await page.keyboard.press('Escape')
    await expect(page.locator('.driver-overlay')).toHaveCount(0)

    // Cerrarlo cuenta como verlo: al volver a abrir la aplicación no sale.
    await page.reload()
    await page.waitForTimeout(2000)
    await expect(page.locator(POPOVER)).toHaveCount(0)
  })

  test('cada pantalla estrena el suyo: Buscar y Biblioteca', async ({ page }) => {
    await page.goto(`${BASE}/search`)
    await page.evaluate(
      ({ clave, v }) => {
        localStorage.setItem(clave, JSON.stringify({ v, recorridos: [], vistos: [] }))
      },
      { clave: CLAVE_GUIA, v: VERSION_GUIA },
    )
    await page.reload()

    const popover = page.locator(POPOVER)
    await expect(popover).toBeVisible({ timeout: 15_000 })
    await expect(popover).toContainText('Buscar')
    await expect(popover).toContainText('1 de 3')

    await page.keyboard.press('Escape')

    await page.goto(`${BASE}/library`)
    await expect(popover).toBeVisible({ timeout: 15_000 })
    await expect(popover).toContainText('Tu biblioteca')
    await expect(popover).toContainText('1 de 4')
  })

  test('un aviso de novedad sale una vez y se descarta', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await page.evaluate(
      ({ clave, v, recorridos }) => {
        localStorage.setItem(clave, JSON.stringify({ v, recorridos, vistos: [] }))
      },
      { clave: CLAVE_GUIA, v: VERSION_GUIA, recorridos: TODOS },
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

  test('Ajustes abre el recorrido de una sección', async ({ page }) => {
    await page.goto(`${BASE}/settings`)

    await page.getByRole('button', { name: 'Inicio', exact: true }).click()

    await expect(page).toHaveURL(`${BASE}/`)
    await expect(page.locator(POPOVER)).toBeVisible({ timeout: 10_000 })
    await expect(page.locator(POPOVER)).toContainText('Bienvenido a nn-anime')
  })
})
