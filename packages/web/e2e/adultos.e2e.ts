import { expect, test } from '@playwright/test'
import { entrar, esperarApp } from './fixtures'

/**
 * El interruptor del contenido para adultos y su marca.
 *
 * Lo que se mide aquí es lo que sólo se ve en un navegador: que el interruptor se pueda
 * cambiar, que anuncie su estado y que **persista**, y que la marca `+18` se pinte cuando
 * el dato dice que la obra lo es.
 *
 * **Lo que este e2e no puede medir, y se dice:** el arnés arranca con AniList apagado, así
 * que no hay ninguna obra marcada que esconder ni que enseñar. El filtro —que con el
 * interruptor apagado no salga nada marcado— lo miden las pruebas de ruta del servidor,
 * con el doble de AniList, que es donde se puede fingir que una obra está marcada.
 */

test.describe('el contenido para adultos', () => {
  test('el interruptor se cambia, se guarda y sigue puesto al recargar', async ({ page }) => {
    await entrar(page)
    // `/settings` y no `/ajustes`: la ruta del enrutador es la inglesa —la del
    // `<nav>`— desde que existe la pantalla, y la prueba pedía una dirección que
    // nunca estuvo en la tabla, así que aterrizaba en «Esa ruta no existe» y el
    // interruptor no aparecía. La encontró el cierre de T145, al correr la suite.
    await page.goto('/settings')

    const esconder = page.getByRole('button', { name: 'Esconderlo' })
    const ensenar = page.getByRole('button', { name: 'Enseñarlo' })

    // Se parte del estado apagado y se deja así al final: una ejecución anterior puede
    // haberlo encendido, y esta prueba mide el mecanismo, no el valor de arranque —que
    // tiene su propia prueba en el servidor—.
    await esconder.click()
    await expect(esconder).toHaveAttribute('aria-pressed', 'true')

    await ensenar.click()
    await expect(ensenar).toHaveAttribute('aria-pressed', 'true')

    // Persiste porque vive en la base del servidor y no en el navegador: al recargar,
    // el estado que se lee es el que se guardó.
    await page.reload()
    await expect(page.getByRole('button', { name: 'Enseñarlo' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // Y el aviso dice qué hace y qué no: sin eso, el interruptor se enciende por
    // curiosidad y se queda encendido.
    await expect(page.getByText('No comprueba la edad de nadie')).toBeVisible()

    await page.getByRole('button', { name: 'Esconderlo' }).click()
    await expect(page.getByRole('button', { name: 'Esconderlo' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  /**
   * La marca, en la pieza.
   *
   * Se le da de comer la respuesta de la ruta como si AniList hubiera contestado con una
   * obra marcada: es la única forma de comprobar que la marca llega a la pantalla.
   */
  test('la obra marcada lleva su marca en la pieza', async ({ page }) => {
    await page.route('**/api/discover/top*', async (ruta) => {
      await ruta.fulfill({
        json: {
          items: [
            {
              anilistId: 700,
              title: 'Obra Marcada',
              cover: '/api/anilist/image/cover/700',
              adult: true,
              year: 2024,
            },
          ],
        },
      })
    })

    await entrar(page)
    await esperarApp(page)

    const pieza = page.locator('.pz', { hasText: 'Obra Marcada' }).first()

    await expect(pieza).toContainText('+18')
  })

  test('sin obra marcada no hay ninguna marca en pantalla', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)

    await expect(page.getByText('+18')).toHaveCount(0)
  })
})
