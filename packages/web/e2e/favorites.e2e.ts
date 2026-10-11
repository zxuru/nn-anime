import { expect, test } from '@playwright/test'
import { entrar } from './fixtures'

/**
 * El favorito, en un navegador.
 *
 * Lo que se prueba aquí es que el botón **recuerda** lo que se guardó: al volver
 * a montar la pantalla, un título que ya está en favoritos sale marcado. Antes
 * nacía siempre en «no está» y mentía hasta que se pulsaba dos veces, y en el
 * cartel de destacado eso dejaba un título guardado sin ninguna señal.
 *
 * La lista la sirve el servidor de verdad, sin dobles: es `/api/favorites` quien
 * dice en qué estado queda.
 */

/** La ficha del fixture, que tiene doce episodios y existe siempre. */
const FICHA = '/anime/fixture/aurora-nocturna'

test.describe('el favorito', () => {
  test('la ficha recuerda que el título ya estaba guardado', async ({ page }) => {
    await entrar(page)

    await page.goto(FICHA)
    await expect(page.locator('.episodes li')).toHaveCount(12, { timeout: 15_000 })

    const boton = page.locator('.detail__actions').getByRole('button')
    await expect(boton).toHaveAttribute('aria-pressed', 'false')

    await boton.click()
    await expect(boton).toHaveAttribute('aria-pressed', 'true')
    await expect(boton).toHaveText('Quitar de favoritos')

    // Se vuelve a montar la pantalla entera: lo que se lee es el estado del
    // servidor y no el que quedara en memoria.
    await page.reload()
    await expect(page.locator('.episodes li')).toHaveCount(12, { timeout: 15_000 })

    const despues = page.locator('.detail__actions').getByRole('button')
    await expect(despues).toHaveAttribute('aria-pressed', 'true')
    await expect(despues).toHaveText('Quitar de favoritos')

    // La base del e2e es una sola para toda la pasada: un favorito que quede aquí
    // hace fallar el caso de la home vacía, que corre después. Se deja como estaba.
    await despues.click()
    await expect(despues).toHaveAttribute('aria-pressed', 'false')
  })

  test('el cartel de destacado enseña marcado lo que ya está guardado', async ({ page }) => {
    await entrar(page)

    // Primero se abre una ficha para que el motor tenga corpus: sin nada que
    // recomendar, el cartel sale del feed, y el feed cambia de contenido entre
    // cargas. Con el corpus caliente el destacado es del motor y se puede
    // comparar el mismo título antes y después.
    await page.goto(FICHA)
    await expect(page.locator('.episodes li')).toHaveCount(12, { timeout: 15_000 })
    await page.goto('/')

    const boton = page.locator('.hero__actions').getByRole('button')
    const titulo = await page.locator('.hero__title').innerText()

    await expect(boton).toHaveAttribute('aria-pressed', 'false')
    await boton.click()
    await expect(boton).toHaveAttribute('aria-pressed', 'true')

    await page.reload()
    await expect(page.locator('.hero__title')).toBeVisible()

    // Un favorito pesa en el motor, así que el cartel debería seguir siendo el
    // mismo título. Se comprueba que lo sea antes de mirar el botón: si el motor
    // cambiara de destacado, esta prueba mediría otro título y no lo que dice.
    expect(await page.locator('.hero__title').innerText()).toBe(titulo)

    const despues = page.locator('.hero__actions').getByRole('button')
    await expect(despues).toHaveAttribute('aria-pressed', 'true')
    await expect(despues).toHaveText('Quitar de favoritos')

    await despues.click()
    await expect(despues).toHaveAttribute('aria-pressed', 'false')
  })
})
