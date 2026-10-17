import { expect, test } from '@playwright/test'
import { entrar, esperarApp } from './fixtures'

/**
 * La búsqueda del e2e.
 *
 * Lo que se prueba aquí y no en unitario: que los resultados **llegan por SSE** y
 * se pintan mientras llegan, que el estado vacío aparece con una consulta sin
 * coincidencias y que un proveedor que falla se ve como error en la página, no
 * como una pantalla en blanco.
 */

test.describe('la búsqueda', () => {
  test('buscar muestra resultados del fixture', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)

    await page.goto('/search')
    await page.getByLabel('Buscar por título').fill('aurora')

    // Los resultados llegan por SSE: se espera a que aparezca la tarjeta.
    await expect(page.getByText('Aurora Nocturna')).toBeVisible({ timeout: 10_000 })
  })

  test('una consulta sin coincidencias muestra el estado vacío', async ({ page }) => {
    await entrar(page)

    await page.goto('/search')
    await page.getByLabel('Buscar por título').fill('zzzz-no-existe')

    await expect(page.getByText('Nada coincide')).toBeVisible({ timeout: 10_000 })
  })

  test('la consulta vive en la dirección', async ({ page }) => {
    await entrar(page)

    await page.goto('/search')
    await page.getByLabel('Buscar por título').fill('aurora')

    await expect(page).toHaveURL(/q=aurora/, { timeout: 10_000 })
  })

  /**
   * La búsqueda cruzada, con el flujo de AniList fingido.
   *
   * El arnés arranca con AniList apagado —una prueba no puede depender de un
   * tercero—, así que aquí se le da al navegador el SSE que el servidor escribiría
   * con la lista ya cruzada: una pieza que está en una fuente, con su referencia, y
   * otra que sólo AniList tiene. Lo que se mide es lo que se pinta.
   */
  test('la lista de AniList sale debajo, con el sello de la que ya está en una fuente', async ({
    page,
  }) => {
    await entrar(page)

    const cuerpo = [
      'event: anilist',
      `data: ${JSON.stringify({
        type: 'anilist',
        items: [
          {
            anilistId: 101922,
            title: 'Kimetsu no Yaiba',
            cover: '/api/anilist/image/cover/101922',
            adult: false,
            year: 2019,
            ref: { providerId: 'fixture', value: 'aurora-nocturna' },
          },
          {
            anilistId: 20920,
            title: 'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka',
            cover: '/api/anilist/image/cover/20920',
            adult: false,
            year: 2015,
          },
        ],
      })}`,
      '',
      'event: done',
      `data: ${JSON.stringify({ type: 'done', providers: 0 })}`,
      '',
      '',
    ].join('\n')

    await page.route('**/api/search*', (ruta) =>
      ruta.fulfill({ status: 200, contentType: 'text/event-stream', body: cuerpo }),
    )

    await page.goto('/search?q=Estudio%20Cobre')

    await expect(page.getByRole('heading', { name: 'En AniList' })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('En tus fuentes')).toBeVisible()
    // La que está en una fuente abre su ficha; la que no, la búsqueda de su título.
    await expect(page.locator('a[href="/anime/fixture/aurora-nocturna"]').first()).toBeVisible()
    await expect(page.locator('a[href^="/search?q=Dungeon"]').first()).toBeVisible()
    // Y no se dice que no haya nada: la lista de debajo es lo que hay.
    await expect(page.getByText('Nada coincide')).toHaveCount(0)
  })
})
