import { setTimeout as pausa } from 'node:timers/promises'
import { expect, test } from '@playwright/test'
import { entrar, esperarApp } from './fixtures'

/**
 * La espera no mueve la página.
 *
 * Los esqueletos de Perfil, Historial, Biblioteca y Ajustes estaban escritos como
 * una barra y una frase: la pantalla pasaba de un renglón a su contenido y todo lo
 * de abajo bajaba. Ahora cada uno pinta la forma de lo que va a llegar, y eso se
 * mide: el cuerpo de Ajustes —el índice y las secciones— tiene que estar en el
 * mismo sitio durante la espera y después de la lectura.
 */
test('el esqueleto de Ajustes deja el cuerpo donde estará', async ({ page }) => {
  await page.route('**/api/settings', async (ruta) => {
    await pausa(1500)
    await ruta.continue()
  })

  await entrar(page)
  await page.goto('/settings')

  const espera = page.locator('[aria-busy="true"].settings .settings__cuerpo')
  await expect(espera).toBeVisible({ timeout: 10_000 })

  const antes = await espera.boundingBox()
  const tituloAntes = await page.locator('.settings h1').boundingBox()

  await expect(page.locator('[aria-busy="true"].settings')).toHaveCount(0, { timeout: 15_000 })

  const despues = await page.locator('.settings .settings__cuerpo').boundingBox()
  const tituloDespues = await page.locator('.settings h1').boundingBox()

  expect(antes, 'no hay cuerpo en la espera').not.toBeNull()
  expect(despues, 'no hay cuerpo con los datos').not.toBeNull()
  expect(tituloAntes?.y ?? -1).toBe(tituloDespues?.y ?? -2)

  // Cuatro píxeles de tolerancia: el aviso de seguridad lleva en su tercera línea
  // un botón, y el esqueleto reserva una barra de texto. Medido: 2,06 px de resto.
  expect(Math.abs((antes?.y ?? 0) - (despues?.y ?? 100))).toBeLessThan(4)
})

/**
 * Y la frase de la espera no se ve.
 *
 * El texto que anunciaba el estado («Cargando los ajustes…») era visible y competía
 * con el esqueleto. Ahora va en `solo-lectores`: el lector de pantalla lo oye y la
 * pantalla no lo enseña.
 */
test('la frase de espera sólo la lee el lector de pantalla', async ({ page }) => {
  await page.route('**/api/settings', async (ruta) => {
    await pausa(1500)
    await ruta.continue()
  })

  await entrar(page)
  await page.goto('/settings')
  await page.waitForSelector('[aria-busy="true"].settings')

  const frase = page.locator('[aria-busy="true"].settings .solo-lectores')

  await expect(frase).toHaveCount(1)

  // Recortada a un píxel: el lector la anuncia y la pantalla no la enseña. No se
  // usa `toBeHidden` porque un elemento de 1×1 con `clip-path` sigue teniendo caja.
  const caja = await frase.boundingBox()

  expect(caja?.width ?? 99).toBeLessThanOrEqual(1)
  expect(caja?.height ?? 99).toBeLessThanOrEqual(1)
})
