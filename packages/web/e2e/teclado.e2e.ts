/**
 * El recorrido entero con el teclado.
 *
 * Buscar, abrir una ficha, elegir un episodio y reproducir son cuatro pantallas
 * y tres navegaciones sin recarga. Las pruebas de cada pieza ya existen —el foco
 * inicial del reintento, el anillo de los mandos, el salto al contenido—, pero
 * nadie recorría el camino completo: entre una pieza y la siguiente, el foco se
 * quedaba en el enlace que se desmontaba y volvía al principio del documento.
 *
 * Aquí se recorre con `Tab` y `Enter` y se comprueba, en cada paso, que el foco
 * está donde toca y que se ve. Nada se enfoca con `locator.focus()`: el anillo es
 * de `:focus-visible`, y forzar el foco mediría otra cosa.
 */

import { expect, type Locator, type Page, test } from '@playwright/test'
import { entrar } from './fixtures'

/**
 * Pulsa `Tab` hasta que el objetivo sea el elemento activo.
 *
 * Se pregunta por el foco y no por una lista de selectores: el orden del
 * tabulador depende de la pantalla y de lo que haya cargado, y enumerarlo aquí
 * convertiría la prueba en una copia del marcado.
 */
async function tabularHasta(page: Page, objetivo: Locator, limite = 120): Promise<void> {
  for (let intento = 0; intento < limite; intento++) {
    if (await objetivo.evaluate((nodo) => nodo === document.activeElement).catch(() => false)) {
      return
    }

    await page.keyboard.press('Tab')
  }

  throw new Error('el tabulador no llegó al objetivo')
}

/** El anillo que dibuja `:focus-visible`: un contorno sólido, no el del navegador. */
async function anilloVisible(objetivo: Locator): Promise<void> {
  const anillo = await objetivo.evaluate((nodo) => {
    const estilo = getComputedStyle(nodo)

    return {
      estilo: estilo.outlineStyle,
      ancho: Number.parseFloat(estilo.outlineWidth),
    }
  })

  expect(anillo.estilo).not.toBe('none')
  expect(anillo.ancho).toBeGreaterThanOrEqual(1)
}

test('buscar, elegir una ficha y reproducir sin tocar el ratón', async ({ page }) => {
  await entrar(page)
  await page.goto('/search')

  // 1. El buscador, alcanzado con el tabulador desde el principio.
  const casilla = page.getByLabel('Buscar por título')

  await expect(casilla).toBeVisible()
  await tabularHasta(page, casilla)
  await expect(casilla).toBeFocused()
  await anilloVisible(casilla)

  await page.keyboard.type('aurora')

  // 2. La primera tarjeta de resultado, también con el tabulador.
  const tarjeta = page.locator('a.card', { hasText: 'Aurora Nocturna' }).first()

  await expect(tarjeta).toBeVisible({ timeout: 15_000 })
  await tabularHasta(page, tarjeta)
  await expect(tarjeta).toBeFocused()
  await anilloVisible(tarjeta)

  await page.keyboard.press('Enter')

  // 3. La ficha: la navegación no recarga y el foco pasa al contenido, no al
  //    principio del documento. Es lo que deja seguir tabulando desde aquí.
  await expect(page).toHaveURL(/\/anime\/fixture\/aurora-nocturna/)
  await expect(page.locator('#contenido')).toBeFocused()
  await expect(page.locator('.detail__banner h1')).toHaveText('Aurora Nocturna', {
    timeout: 15_000,
  })

  const episodio = page.locator('.episodes li a').first()

  await expect(episodio).toBeVisible({ timeout: 15_000 })
  await tabularHasta(page, episodio)
  await expect(episodio).toBeFocused()
  await anilloVisible(episodio)

  await page.keyboard.press('Enter')

  // 4. El reproductor, montado y con el foco otra vez en el contenido.
  await expect(page).toHaveURL(/\/watch\/fixture\/aurora-nocturna%231\?mode=sub/)
  await expect(page.locator('#contenido')).toBeFocused()

  const video = page.locator('video')

  await expect(video).toBeVisible({ timeout: 15_000 })

  // 5. El mando de reproducción y la reproducción, sin un solo clic.
  const reproducir = page.getByRole('button', { name: 'Reproducir' })

  await expect(reproducir).toBeVisible()
  await tabularHasta(page, reproducir)
  await expect(reproducir).toBeFocused()
  await anilloVisible(reproducir)

  await page.keyboard.press('Enter')

  await expect
    .poll(async () => await video.evaluate((elemento: HTMLVideoElement) => elemento.paused), {
      timeout: 10_000,
    })
    .toBe(false)
})
