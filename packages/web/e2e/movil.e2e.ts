/**
 * La navegación en un teléfono.
 *
 * Lo que sólo se ve con un viewport estrecho y el JavaScript de verdad: que la
 * barra inferior existe, que la cabecera de texto se esconde —dos navegaciones
 * iguales serían dos respuestas a la misma pregunta— y que sus destinos navegan
 * sin recargar. El tamaño es el de un iPhone moderno: 390×844, el más estrecho
 * de los que se usan hoy con la barra de gestos.
 */

import { expect, test } from '@playwright/test'
import { entrar, esperarApp } from './fixtures'

test.use({ viewport: { width: 390, height: 844 } })

test.describe('la navegación del móvil', () => {
  test('la barra inferior sustituye a la cabecera y lleva a las pantallas', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)

    const barra = page.locator('.barra')
    await expect(barra).toBeVisible()

    // La cabecera de texto no se pinta: su hoja la esconde por debajo de 640.
    await expect(page.locator('.shell__nav')).toBeHidden()

    for (const nombre of ['Inicio', 'Buscar', 'Perfil', 'Biblioteca', 'Ajustes']) {
      await expect(barra.getByRole('link', { name: nombre })).toBeVisible()
    }

    // El destino actual: la pestaña encendida y el `aria-current` que lo dice
    // también sin color.
    await expect(barra.getByRole('link', { name: 'Inicio' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    await barra.getByRole('link', { name: 'Buscar' }).click()
    await expect(page).toHaveURL(/\/search/)
    await expect(barra.getByRole('link', { name: 'Buscar' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(barra.getByRole('link', { name: 'Inicio' })).not.toHaveAttribute(
      'aria-current',
      'page',
    )

    await barra.getByRole('link', { name: 'Biblioteca' }).click()
    await expect(page).toHaveURL(/\/library/)
    await expect(barra.getByRole('link', { name: 'Biblioteca' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  test('no desborda en horizontal y el contenido reserva el alto de la barra', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)

    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(desborde, 'la página desborda a lo ancho en 390 px').toBeLessThanOrEqual(0)

    const medidas = await page.evaluate(() => {
      const caja = document.querySelector('.shell__main')
      const barra = document.querySelector('.barra')
      if (caja === null || barra === null) throw new Error('faltan la caja o la barra')

      return {
        reserva: Number.parseFloat(getComputedStyle(caja).paddingBlockEnd),
        alto: barra.getBoundingClientRect().height,
        recorte: Number.parseFloat(getComputedStyle(barra).paddingBlockEnd),
      }
    })

    // Una barra táctil no baja de 44 px, y el contenido aparta al menos su alto:
    // sin la reserva, lo último de cada pantalla quedaba debajo.
    expect(medidas.alto).toBeGreaterThanOrEqual(44)
    expect(medidas.reserva).toBeGreaterThanOrEqual(medidas.alto)
    expect(medidas.recorte).toBeGreaterThanOrEqual(0)
  })

  test('el conmutador de tipo conserva sus dos mitades en la cabecera', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)

    // El conmutador se queda arriba aunque los destinos se hayan ido abajo: es
    // el mando de la pantalla, no un destino.
    const conmutador = page.locator('.conmutador')
    await expect(conmutador).toBeVisible()
    await expect(conmutador.getByRole('link', { name: 'Anime' })).toBeVisible()
    await expect(conmutador.getByRole('link', { name: 'Películas' })).toBeVisible()

    await conmutador.getByRole('link', { name: 'Películas' }).click()
    await expect(page).toHaveURL(/tipo=movies/)
  })
})
