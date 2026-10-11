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

    // La home del diseño: cinta, cartel de destacado, top y las filas.
    await expect(page.locator('.ticker')).toBeVisible()
    await expect(page.locator('.hero__title')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Top 5 de la semana' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Continuar viendo' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tus favoritos' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'De moda' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Explorar por género' })).toBeVisible()
  })

  test('sin historial lo dice en vez de quedarse en blanco', async ({ page }) => {
    await entrar(page)

    await expect(page.getByText('Nada a medias')).toBeVisible()
    await expect(page.getByText('Todavía no has marcado ninguno')).toBeVisible()
  })

  test('el tema se aplica al documento', async ({ page }) => {
    await entrar(page)

    // `data-theme` es lo que la hoja de estilos mira para cambiar de paleta.
    // Estaba declarado en los tokens y **nadie lo escribía**: el tema claro era
    // inalcanzable. Lo encontró la captura del rediseño, y esta prueba existe
    // para que no vuelva a pasar desapercibido.
    const tema = await page.evaluate(() => document.documentElement.dataset.theme)

    expect(['dark', 'light']).toContain(tema)
  })

  test('el panel dice que no hay historial todavía', async ({ page }) => {
    await entrar(page)

    // El panel del motor vive dentro de un desplegable: en la home del diseño lo
    // que manda es el top con sus motivos, y el detalle del score es una
    // herramienta para quien quiera mirarlo.
    await page.getByText('¿Por qué estas recomendaciones?').click()

    await expect(page.getByText('Sin historial todavía')).toBeVisible()
  })
})
