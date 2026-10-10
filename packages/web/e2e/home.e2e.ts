import { expect, test } from '@playwright/test'
import { entrar, esperarApp } from './fixtures'

/**
 * La home del e2e.
 *
 * Se comprueba lo que sólo se puede ver en un navegador: que la página carga con
 * el JavaScript de verdad, que las filas están y que la aplicación entra sin
 * errores de consola. Lo que ya está probado en unitario —los cálculos, los
 * textos— no se repite aquí.
 */

test.describe('la home', () => {
  test('carga, entra con la sesión y muestra su contenido', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)

    // Las cuatro filas de la home, cada una con su encabezado.
    await expect(page.getByRole('heading', { name: 'Continuar viendo' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tus favoritos' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'De moda' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Recomendado para ti' })).toBeVisible()
  })

  test('sin historial lo dice en vez de quedarse en blanco', async ({ page }) => {
    await entrar(page)

    await expect(page.getByText('Nada a medias')).toBeVisible()
    await expect(page.getByText('Todavía no has marcado ninguno')).toBeVisible()
  })

  test('el panel dice que no hay historial todavía', async ({ page }) => {
    await entrar(page)

    await expect(page.getByText('Sin historial todavía')).toBeVisible()
  })
})
