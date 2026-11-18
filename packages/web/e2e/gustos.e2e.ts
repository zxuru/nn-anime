import { expect, test } from '@playwright/test'
import { entrar } from './fixtures'

/**
 * La encuesta de gustos, en un navegador.
 *
 * Lo que ninguna prueba de unidad puede medir: que se pueda **completar** de
 * principio a fin con tarjetas de verdad, que al volver al Perfil aparezca
 * «Ajustar mis gustos» con lo contestado precargado, que omitir desde ahí
 * devuelva al Perfil y que el aviso del inicio se pueda rechazar.
 *
 * La suite arranca con la encuesta omitida y el límite de omisiones en cero
 * (`scripts/e2e-server.ts`), así que ninguna otra prueba se topa con el banner.
 * Esta prueba limpia al terminar y deja el mismo estado.
 */

const FICHA = '/anime/fixture/aurora-nocturna'

/** Abre una ficha para que su título exista en el catálogo de la encuesta. */
async function cachearTitulo(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(FICHA)
  await expect(page.locator('.episodes li')).toHaveCount(12, { timeout: 15_000 })
}

/** Pulsa una tarjeta por su texto visible. */
async function tarjeta(
  page: import('@playwright/test').Page,
  selector: string,
  texto: string,
): Promise<void> {
  await page.locator(selector, { hasText: texto }).first().click()
}

async function siguiente(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Siguiente' }).click()
}

test.describe('la encuesta de gustos', () => {
  test('se completa, se reabre desde el Perfil y el aviso se rechaza', async ({ page }) => {
    await entrar(page)
    await cachearTitulo(page)

    // La encuesta se abre por su dirección: la abertura automática está apagada
    // en el arnés para no cambiar la pantalla de las demás pruebas.
    await page.goto('/gustos')
    await expect(page.locator('.gustos')).toBeVisible()

    // Paso 1: un género que le gusta.
    await tarjeta(page, '.gusto-genero', 'Acción')
    await expect(
      page.locator('.gusto-genero', { hasText: 'Acción' }).locator('.gusto-genero__cuerpo'),
    ).toHaveAttribute('aria-pressed', 'true')
    await siguiente(page)

    // Paso 2: un título que ya vio y le gustó. Es la señal más fuerte.
    const titulo = page.locator('.gusto-titulo', { hasText: 'Aurora Nocturna' })
    await expect(titulo).toBeVisible()
    await titulo.click()
    await expect(titulo).toHaveAttribute('aria-pressed', 'true')
    await siguiente(page)

    // Pasos 3 y 4: formato y tono.
    await tarjeta(page, '.gusto-card', 'Películas')
    await siguiente(page)
    await tarjeta(page, '.gusto-card', 'Oscuro y serio')
    await siguiente(page)

    // Paso 5: los dos extras y guardar.
    await tarjeta(page, '.gusto-card', 'Doblado')
    await tarjeta(page, '.gusto-card', 'Emisión actual')
    await page.getByRole('button', { name: 'Guardar mis gustos' }).click()

    // Al guardar se vuelve al inicio y aparece la fila del género elegido.
    await expect(page).toHaveURL(/\/$/)
    await expect(page.locator('.seccion', { hasText: 'Porque te gusta Acción' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.locator('.gustos-aviso')).toHaveCount(0)

    // El Perfil es la puerta de vuelta: la encuesta se reabre con lo contestado.
    await page.goto('/profile')
    await page.getByRole('link', { name: 'Ajustar mis gustos' }).click()
    await expect(page).toHaveURL(/\/gustos\?volver=perfil$/)
    await expect(
      page.locator('.gusto-genero', { hasText: 'Acción' }).locator('.gusto-genero__cuerpo'),
    ).toHaveAttribute('aria-pressed', 'true')

    // Omitir también está aquí y devuelve al Perfil, no al inicio.
    await page.getByRole('button', { name: 'Omitir' }).click()
    await expect(page).toHaveURL(/\/profile$/)

    /*
      El aviso del inicio, con el perfil borrado.

      `DELETE /api/taste` deja la encuesta sin empezar, que es el único estado en
      el que el aviso invita aunque el límite de omisiones sea cero. Después se
      rechaza con «Ahora no» y la suite queda como estaba: omitida y en silencio.
    */
    await page.evaluate(async () => {
      await fetch('/api/taste', { method: 'DELETE' })
    })
    await page.goto('/')

    const aviso = page.locator('.gustos-aviso')
    await expect(aviso).toBeVisible()
    await expect(aviso).toContainText('¿Quieres recomendaciones a tu gusto?')

    await aviso.getByRole('button', { name: 'Ahora no' }).click()
    await expect(page.locator('.gustos-aviso')).toHaveCount(0)
  })
})
