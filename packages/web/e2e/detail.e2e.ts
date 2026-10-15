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

    // El enlace lleva el episodio en la dirección, el modo elegido, la
    // referencia del título en la consulta y el número del episodio: el
    // reproductor abre en subtitulado, que es el que ofrece el proveedor y el que
    // sale marcado; el visionado se registra contra el título, no contra la
    // referencia del episodio; y el número es lo que le deja resolver los vecinos
    // sin descargar la lista entera.
    const tercero = page.locator('.episodes li').nth(2).getByRole('link')
    await expect(tercero).toHaveAttribute(
      'href',
      '/watch/fixture/aurora-nocturna%233?mode=sub&anime=aurora-nocturna&n=3',
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
   * El fixture tiene doce episodios y con doce no hay páginas: el caso se mide
   * interceptando la ruta de episodios y sirviendo mil ciento ochenta, que es lo
   * que devuelve una fuente real para One Piece. Aquí se comprueba lo que el
   * renderizado de servidor no puede: que la lista se pide **por páginas** —con su
   * `?page=`, que es lo que el troceado del servidor y su caché necesitan—, que no
   * se montan más de cien filas y que el salto por número pregunta al servidor en
   * vez de buscar en lo que ya está descargado.
   */
  test('una lista de mil episodios se pide por páginas y el salto va al servidor', async ({
    page,
  }) => {
    await entrar(page)

    const POR_PAGINA = 100
    const TOTAL = 1180

    /** Un episodio del proveedor, con lo mínimo que exige el schema. */
    const episodio = (numero: number): unknown => ({
      ref: { providerId: 'fixture', value: `aurora-nocturna#${numero}` },
      animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
      number: numero,
      title: `Episodio ${numero}`,
      durationS: 1440,
      mode: 'sub',
    })

    /** Los cien de una página, numerados como los numera el proveedor. */
    const episodiosDe = (numero: number): readonly unknown[] =>
      Array.from({ length: POR_PAGINA }, (_, indice) =>
        episodio((numero - 1) * POR_PAGINA + indice + 1),
      )

    const paginas: number[] = []

    /**
     * La ruta se intercepta **con su `?page=`**, y el predicado lo exige: un patrón
     * sin consulta no coincide con la petición paginada, se va al servidor de
     * verdad y la prueba mide los doce episodios del fixture creyendo medir mil.
     */
    await page.route(
      (url) =>
        url.pathname === '/api/anime/fixture/aurora-nocturna/episodes' &&
        url.searchParams.has('page'),
      async (ruta) => {
        const numero = Number(new URL(ruta.request().url()).searchParams.get('page'))
        paginas.push(numero)

        await ruta.fulfill({
          json: {
            episodes: episodiosDe(numero),
            page: numero,
            hasMore: numero * POR_PAGINA < TOTAL,
            total: TOTAL,
          },
        })
      },
    )

    // El salto pregunta por el número al servidor, así que se intercepta también:
    // el fixture no tiene ningún episodio 1180.
    await page.route(
      (url) => url.pathname.startsWith('/api/anime/fixture/aurora-nocturna/episodes/number/'),
      async (ruta) => {
        const numero = Number(new URL(ruta.request().url()).pathname.split('/').pop())

        await ruta.fulfill({ json: { episode: episodio(numero) } })
      },
    )

    await page.goto('/anime/fixture/aurora-nocturna')

    // Cien filas y no mil: el tope de pintado sigue siendo el de
    // `episode-window.ts`, y con él la página que se mira no crece con la serie.
    await expect(page.locator('.episodes li')).toHaveCount(POR_PAGINA, { timeout: 15_000 })
    await expect(page.locator('.episodes__range')).toHaveText('Página 1')
    expect(paginas).toEqual([1])

    // La flecha de página siguiente pide la 2 al servidor, no la siguiente ventana
    // de lo que ya está descargado.
    await page.getByRole('button', { name: 'Página siguiente' }).click()

    await expect(page.locator('.episodes__range')).toHaveText('Página 2')
    await expect(page.locator('.episodes li').first()).toContainText('Episodio 101')
    expect(paginas).toEqual([1, 2])

    await page.getByLabel('Ir al episodio').fill('1180')
    await page.getByRole('button', { name: 'Ir', exact: true }).click()

    // El salto lleva al episodio, y la pantalla dice de cuántos es el título con la
    // primera página que pidió: sin ella el rótulo perdía el total. La línea del
    // episodio vive en el encabezado desde el rediseño de la pantalla; antes iba en
    // medio de las dos flechas.
    await expect(page).toHaveURL(/\/watch\/fixture\/aurora-nocturna%231180\?/)
    await expect(page.locator('.watch__episode')).toHaveText('Episodio 1180 de 1180', {
      timeout: 15_000,
    })
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

  /**
   * Una película no tiene capítulos.
   *
   * El fixture trae una —«El Jardín de Hierro», que su proveedor declara
   * `movie`— y su ficha enseñaba «Episodios» con un «Episodio 1 de 1» que nadie
   * puede elegir. Se mide en un navegador porque la decisión depende de la lectura
   * de episodios, que llega dentro de un efecto.
   */
  test('la ficha de una película ofrece verla, sin numerar capítulos', async ({ page }) => {
    await entrar(page)

    await page.goto('/anime/fixture/el-jardin-de-hierro')

    const verla = page.getByRole('link', { name: 'Ver película' })
    await expect(verla).toHaveAttribute(
      'href',
      '/watch/fixture/el-jardin-de-hierro%231?mode=sub&anime=el-jardin-de-hierro&n=1',
      { timeout: 15_000 },
    )

    // Ni la lista, ni su titular, ni el número: la película no finge capítulos.
    await expect(page.locator('.episodes li')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Episodios', exact: true })).toHaveCount(0)
    await expect(page.getByText('Episodio 1')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Película', exact: true })).toBeVisible()

    await verla.click()
    await expect(page).toHaveURL(/\/watch\/fixture\/el-jardin-de-hierro%231\?mode=sub/)
    await expect(page.locator('video')).toBeVisible({ timeout: 15_000 })
  })

  test('una película sin ninguna parte lo dice, y no deja un botón que no lleva a nada', async ({
    page,
  }) => {
    await entrar(page)

    // El proveedor declara la película y no sirve ninguna parte: es el caso del
    // título que la fuente anuncia y todavía no publica.
    await page.route(
      (url) =>
        url.pathname === '/api/anime/fixture/el-jardin-de-hierro/episodes' &&
        url.searchParams.has('page'),
      async (ruta) => {
        await ruta.fulfill({ json: { episodes: [], page: 1, hasMore: false } })
      },
    )

    await page.goto('/anime/fixture/el-jardin-de-hierro')

    await expect(page.getByText('Esta película no tiene nada que reproducir todavía.')).toBeVisible(
      { timeout: 15_000 },
    )
    await expect(page.getByRole('link', { name: 'Ver película' })).toHaveCount(0)
  })
})
