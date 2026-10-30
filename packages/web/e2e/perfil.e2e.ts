import { expect, test } from '@playwright/test'
import { entrar } from './fixtures'

/**
 * El Perfil y su Historial, en un navegador.
 *
 * Lo que se prueba aquí es lo que ninguna prueba de unidad puede: que las dos
 * pantallas **se alcancen navegando** —el Perfil desde la cabecera, el Historial
 * desde el Perfil— y que lo que se marca en una ficha se lea después en el Perfil.
 * Eso último es lo que distingue un estado que vive en el servidor de uno que se
 * quedó en memoria: entre marcar y leer se recarga la página entera.
 *
 * La ficha del fixture tiene doce episodios y existe siempre.
 */

const FICHA = '/anime/fixture/aurora-nocturna'

/** La ficha abierta y con su lista de episodios cargada. */
async function abrirFicha(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(FICHA)
  await expect(page.locator('.episodes li')).toHaveCount(12, { timeout: 15_000 })
}

test.describe('el Perfil', () => {
  test('se alcanza desde la cabecera y están sus cuatro secciones', async ({ page }) => {
    await entrar(page)
    await page.goto('/')

    await page.locator('.shell__nav', { hasText: 'Perfil' }).getByText('Perfil').click()

    await expect(page).toHaveURL(/\/profile$/)
    // Las cuatro secciones, por su titular: favoritos, vistos, pendientes e historial.
    for (const titulo of ['Favoritos', 'Ya vistos', 'Quiero ver', 'Historial']) {
      await expect(page.locator('.pagina__titulo', { hasText: titulo })).toBeVisible()
    }
  })

  test('una sección vacía explica dónde se marca, en vez de esconderse', async ({ page }) => {
    await entrar(page)
    await page.goto('/profile')

    // El vacío de «Quiero ver» dice dónde se marca: un «no hay nada» a secas deja al
    // usuario buscando el botón por toda la aplicación.
    const seccion = page.locator('.pagina__seccion', { hasText: 'Quiero ver' })

    /*
      Lo que se comprueba es que **no hay tarjetas**: el vacío se dice en un renglón
      —`tramo-vacio`—, así que contar `.pz` mide justo lo que se busca. Y el texto
      nombra el botón, que es lo que un hueco sin explicación no hace.
    */
    await expect(seccion.locator('.pz')).toHaveCount(0)
    await expect(seccion).toContainText('Quiero verla')
  })
})

test.describe('quiero ver, de la ficha al Perfil', () => {
  test('lo que se marca en la ficha aparece en el Perfil y sobrevive a recargar', async ({
    page,
  }) => {
    await entrar(page)
    await abrirFicha(page)

    /*
      El localizador va por el texto que **no** cambia con el estado —«quiero ver»—
      y no por el rótulo entero: `aria-pressed` y el texto van juntos, así que
      «Quiero verla» deja de encontrar el botón en cuanto se pulsa. Los otros dos
      botones de la caja dicen «favoritos» y «visto», así que «quiero ver» sólo lo
      lleva éste.
    */
    const boton = page.locator('.detail__actions button', { hasText: 'quiero ver' })

    await expect(boton).toHaveAttribute('aria-pressed', 'false')

    // El estado se pinta antes de que el alta llegue; sin esperar la respuesta, la
    // recarga leería una lista sin el título y la prueba mediría una carrera.
    const alta = page.waitForResponse(
      (respuesta) =>
        respuesta.url().includes('/api/plan-to-watch') && respuesta.request().method() === 'POST',
      { timeout: 10_000 },
    )

    await boton.click()
    await expect(boton).toHaveAttribute('aria-pressed', 'true')
    await alta

    await page.reload()
    await expect(page.locator('.episodes li')).toHaveCount(12, { timeout: 15_000 })
    await expect(
      page.locator('.detail__actions button', { hasText: 'quiero ver' }),
    ).toHaveAttribute('aria-pressed', 'true')

    // Y en el Perfil, que es donde se concentra: la sección lo enseña por su título.
    await page.goto('/profile')

    const seccion = page.locator('.pagina__seccion', { hasText: 'Quiero ver' })

    await expect(seccion.locator('.pz__titulo', { hasText: 'Aurora Nocturna' })).toBeVisible()

    // Limpieza: la base del e2e es una sola para toda la pasada, así que la marca se
    // deshace por la misma puerta que usa la aplicación.
    await page.evaluate(async () => {
      await fetch('/api/plan-to-watch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ref: { providerId: 'fixture', value: 'aurora-nocturna' },
          value: false,
        }),
      })
    })
  })
})

test.describe('el Historial, desde el Perfil', () => {
  test('el enlace lleva al Historial y allí está lo reproducido', async ({ page }) => {
    await entrar(page)

    // Se abre la ficha primero: el alta de un visionado exige que el episodio esté
    // en la base, y el camino real es abrir la ficha antes de reproducir.
    await abrirFicha(page)

    /*
      Se registra el visionado por la puerta de la aplicación —`POST /api/watch`, la
      misma que usa el reproductor— en vez de reproducir de verdad: el fixture apunta
      a un dominio que no existe, y montar el medio local es lo que hace
      `player.e2e.ts` con la excepción de loopback. Aquí lo que se mide es la
      pantalla, no el reproductor.
    */
    await page.evaluate(async () => {
      await fetch('/api/watch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
          episodeRef: { providerId: 'fixture', value: 'aurora-nocturna#1' },
          mode: 'sub',
        }),
      })
    })

    await page.goto('/profile')

    const enlace = page.locator('.pagina__ver', { hasText: 'Ver todo el historial' })

    await expect(enlace).toBeVisible()
    await enlace.click()

    await expect(page).toHaveURL(/\/history$/)
    // La fila del historial, con su episodio: es lo que hace falta para saber qué se
    // dejó a medias. El visionado que se registró arriba es el episodio 1.
    await expect(
      page.locator('.historial .pz__titulo', { hasText: 'Aurora Nocturna' }),
    ).toBeVisible()
    await expect(page.locator('.historial .pz__ep')).toContainText('1')
  })

  test('la vuelta al Perfil está en el Historial', async ({ page }) => {
    await entrar(page)
    await page.goto('/history')

    await page.locator('.historial__volver a', { hasText: 'Volver al perfil' }).click()

    await expect(page).toHaveURL(/\/profile$/)
  })
})

/**
 * La disposición, que es lo que ninguna prueba de marcado ve.
 *
 * Las dos pantallas comparten el contenedor de página, y su margen lateral lo pone
 * la caja de la aplicación. Lo que se mide es que no se sume otro: una pantalla con
 * desplazamiento lateral en un teléfono se lee fatal, y se mide a 360 px, que es
 * donde se rompe.
 */
test.describe('la disposición de las dos pantallas', () => {
  test('en 360 px el Perfil no tiene desplazamiento horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 })
    await entrar(page)
    await page.goto('/profile')

    await expect(page.locator('.pagina__titulo', { hasText: 'Favoritos' })).toBeVisible()

    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )

    expect(desborde).toBeLessThanOrEqual(0)
  })

  test('en 360 px el Historial no tiene desplazamiento horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 })
    await entrar(page)
    await page.goto('/history')

    await expect(page.locator('.historial__volver a')).toBeVisible()

    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )

    expect(desborde).toBeLessThanOrEqual(0)
  })
})
