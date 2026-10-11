import { expect, test } from '@playwright/test'
import { entrar } from './fixtures'

/**
 * El camino de la búsqueda al detalle, en un navegador.
 *
 * Lo que se prueba aquí es que la navegación sin recargar funciona de verdad: se
 * busca, se elige un título y se llega a su ficha con su lista de episodios. Es
 * el camino crítico de la aplicación y el que rompe si alguien toca el enrutador.
 */

test.describe('de la búsqueda al detalle', () => {
  test('buscar, elegir y ver los episodios', async ({ page }) => {
    await entrar(page)

    await page.goto('/search')
    await page.getByLabel('Buscar por título').fill('aurora')
    await expect(page.getByText('Aurora Nocturna')).toBeVisible({ timeout: 10_000 })

    await page.getByText('Aurora Nocturna').first().click()

    // La ficha, sin recargar: la dirección cambia y el contenido es el del título.
    await expect(page).toHaveURL(/\/anime\/fixture\/aurora-nocturna/)
    await expect(page.getByRole('heading', { name: 'Aurora Nocturna' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByRole('heading', { name: 'Episodios' })).toBeVisible()
    // El número y el título del episodio dicen lo mismo, así que hay dos
    // coincidencias: se pide la primera.
    await expect(page.locator('.episodes li')).toHaveCount(12, { timeout: 15_000 })
    await expect(page.getByText('Episodio 1').first()).toBeVisible()
  })

  /**
   * La ficha es la puerta del reproductor.
   *
   * Este caso faltaba y por eso el fallo llegó hasta aquí: el reproductor se
   * probaba entrando a su dirección a mano, y nadie comprobaba que se pudiera
   * llegar a él desde la aplicación. La pantalla enseñaba los episodios y no
   * abría ninguno.
   */
  test('de la ficha al reproductor con un clic en el episodio', async ({ page }) => {
    await entrar(page)

    await page.goto('/anime/fixture/aurora-nocturna')
    await expect(page.locator('.episodes li')).toHaveCount(12, { timeout: 15_000 })

    // El enlace lleva el episodio en la dirección, el modo elegido y la
    // referencia del título en la consulta: el reproductor abre en subtitulado,
    // que es el que ofrece el proveedor y el que sale marcado, y el visionado se
    // registra contra el título, no contra la referencia del episodio.
    const tercero = page.locator('.episodes li').nth(2).getByRole('link')
    await expect(tercero).toHaveAttribute(
      'href',
      '/watch/fixture/aurora-nocturna%233?mode=sub&anime=aurora-nocturna',
    )

    await tercero.click()

    await expect(page).toHaveURL(/\/watch\/fixture\/aurora-nocturna%233\?mode=sub/)
    // El reproductor, montado y con su fuente: no basta con que la dirección
    // cambie.
    await expect(page.locator('video')).toBeVisible({ timeout: 15_000 })
  })

  test('el modo elegido en la ficha viaja al reproductor', async ({ page }) => {
    await entrar(page)

    await page.goto('/anime/fixture/aurora-nocturna')
    await expect(page.locator('.episodes li')).toHaveCount(12, { timeout: 15_000 })

    await page.getByRole('button', { name: 'Doblado' }).click()
    await expect(page.getByRole('button', { name: 'Doblado' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await page.locator('.episodes li').first().getByRole('link').click()

    await expect(page).toHaveURL(/\/watch\/fixture\/aurora-nocturna%231\?mode=dub/)
    await expect(page.locator('video')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Doblado' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('el detalle anuncia de dónde salió con `X-Cache`', async ({ page }) => {
    await entrar(page)

    // La URL del detalle, no la de sus episodios: las dos empiezan igual y la de
    // episodios también responde con `X-Cache`, así que la comparación tiene que
    // ser exacta o la prueba mide la respuesta equivocada.
    const respuesta = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/anime/fixture/aurora-nocturna' && r.status() === 200,
      { timeout: 15_000 },
    )

    await page.goto('/anime/fixture/aurora-nocturna')

    expect((await respuesta).headers()['x-cache']).toMatch(/hit|miss|stale/)
  })

  /**
   * Cuatro fichas abiertas eran cuatro pestañas con el mismo nombre.
   *
   * El título de la pestaña es lo único que ve quien tiene varias abiertas, así
   * que se abre una segunda pestaña de verdad y se comprueba que las dos se
   * distinguen. Es la parte del cambio que no se puede medir sin un navegador:
   * el renderizado de servidor no ejecuta el efecto que escribe el título.
   */
  test('cada ficha abierta se distingue en el nombre de su pestaña', async ({ page, context }) => {
    await entrar(page)

    await page.goto('/anime/fixture/aurora-nocturna')
    await expect(page).toHaveTitle('Aurora Nocturna · nn-anime', { timeout: 15_000 })

    const otra = await context.newPage()
    await otra.goto('/anime/fixture/mar-de-cristal')
    await expect(otra).toHaveTitle('Mar de Cristal · nn-anime', { timeout: 15_000 })

    // La primera sigue con el suyo: la segunda no lo pisó.
    await expect(page).toHaveTitle('Aurora Nocturna · nn-anime')

    await otra.close()
  })

  /**
   * Una serie de mil episodios, en el navegador.
   *
   * El fixture tiene doce episodios y con doce no hay ventanas: el caso se mide
   * interceptando la ruta de episodios y sirviendo mil ciento ochenta, que es lo
   * que devuelve una fuente real para One Piece. Aquí se comprueba lo que el
   * renderizado de servidor no puede: que la lista no monte las mil filas, que el
   * salto cambie de ventana y que deje el foco en la fila pedida.
   */
  test('una lista de mil episodios se recorre por ventanas y salta al número', async ({ page }) => {
    await entrar(page)

    const episodios = Array.from({ length: 1180 }, (_, indice) => {
      const numero = indice + 1

      return {
        ref: { providerId: 'fixture', value: `aurora-nocturna#${numero}` },
        animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
        number: numero,
        title: `Episodio ${numero}`,
        durationS: 1440,
        mode: 'sub',
      }
    })

    await page.route('**/api/anime/fixture/aurora-nocturna/episodes', async (ruta) => {
      await ruta.fulfill({ json: { episodes: episodios } })
    })

    await page.goto('/anime/fixture/aurora-nocturna')

    // Cien filas y no mil: el tope es de pintado.
    await expect(page.locator('.episodes li')).toHaveCount(100, { timeout: 15_000 })
    await expect(page.locator('.episodes__range')).toHaveText('Episodios 1–100')

    await page.getByRole('button', { name: 'Siguientes' }).click()
    await expect(page.locator('.episodes__range')).toHaveText('Episodios 101–200')
    await expect(page.locator('.episodes li')).toHaveCount(100)

    await page.getByLabel('Ir al episodio').fill('1180')
    await page.getByRole('button', { name: 'Ir', exact: true }).click()

    await expect(page.locator('.episodes__range')).toHaveText('Episodios 1101–1180')
    await expect(page.locator('#episodio-1180 a')).toBeFocused()
  })

  /**
   * Elegir fuente: la ficha de un título que está en otro sitio ofrece el otro.
   *
   * La fuente de prueba es una sola, así que la otra llega interceptada. Lo que se
   * mide es lo que el renderizado de servidor no puede: que la sección se monte
   * cuando la respuesta trae algo —va dentro de un efecto— y que el enlace lleve a
   * la ficha de **esa** fuente.
   */
  test('la ficha ofrece la otra fuente y el enlace lleva a su ficha', async ({ page }) => {
    await entrar(page)

    await page.route('**/api/anime/fixture/aurora-nocturna/sources', async (ruta) => {
      await ruta.fulfill({
        json: {
          items: [
            {
              ref: { providerId: 'animeav1', value: 'aurora-nocturna' },
              title: 'Aurora Nocturna',
              year: 2019,
            },
          ],
        },
      })
    })

    await page.goto('/anime/fixture/aurora-nocturna')

    const seccion = page.locator('section', {
      has: page.getByRole('heading', { name: 'También en' }),
    })
    // Sin nombre declarado para esa fuente en `/api/providers`, se lee su id.
    const enlace = seccion.getByRole('link', { name: 'animeav1' })

    await expect(enlace).toHaveAttribute('href', '/anime/animeav1/aurora-nocturna')

    await enlace.click()
    await expect(page).toHaveURL(/\/anime\/animeav1\/aurora-nocturna/)
  })

  test('sin otra fuente, la ficha no pinta la sección', async ({ page }) => {
    await entrar(page)

    await page.goto('/anime/fixture/aurora-nocturna')
    await expect(page.locator('.episodes li').first()).toBeVisible({ timeout: 15_000 })

    // El caso contrario, con la base del e2e vacía: una ficha sin nada que elegir
    // no tiene una sección vacía.
    await expect(page.getByRole('heading', { name: 'También en' })).toHaveCount(0)
  })
})
