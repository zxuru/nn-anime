import { expect, test } from '@playwright/test'
import { entrar, esperarApp } from './fixtures'

/**
 * La home del e2e.
 *
 * Se comprueba lo que sólo se puede ver en un navegador: que la página carga con
 * el JavaScript de verdad, que las filas están y que la aplicación entra sin
 * errores de consola. Lo que ya está probado en unitario —los cálculos, los
 * textos— no se repite aquí.
 */

test.describe('la home', () => {
  test('carga, entra con la sesión y muestra su contenido', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)

    // La home de la vitrina: la cinta, la marquesina del destacado, el mosaico del
    // top y las demás secciones.
    await expect(page.locator('.cinta')).toBeVisible()
    await expect(page.locator('.marquesina__titulo')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Top', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Continuar viendo' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tus favoritos' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Explorar por género' })).toBeVisible()
  })

  /**
   * «Mostrar más», con un top largo.
   *
   * El fixture publica cinco puestos —menos que los que se ven de golpe—, así que
   * con él el botón no aparecería nunca y la prueba no mediría nada: se le da de
   * comer una lista de quince por la ruta de la API. Es la única forma de pulsar
   * de verdad el desplegable, que es estado de React y no se puede ver en un
   * `renderToString`.
   */
  test('el top se despliega con «Mostrar más»', async ({ page }) => {
    const items = Array.from({ length: 15 }, (_, indice) => ({
      ref: { providerId: 'fixture', value: `puesto-${indice + 1}` },
      title: `Puesto ${indice + 1}`,
    }))

    await page.route('**/api/trending', async (ruta) => {
      await ruta.fulfill({ json: { items } })
    })

    await entrar(page)
    await esperarApp(page)

    const top = page.locator('.seccion', {
      has: page.getByRole('heading', { name: 'Top', exact: true }),
    })
    // Las piezas del top: el mando de «Mostrar más» también es una pieza del
    // mosaico, pero no un puesto. Todas pesan lo mismo —dos de ancho por dos de
    // alto—: el orden de la fuente no admite que una destaque sobre otra, y el
    // peso lo usa la vitrina para el puesto, no para el rango.
    const tarjetas = top.locator('.pz:not(.pz--mando)')

    await expect(tarjetas).toHaveCount(10)
    await expect(top.locator('.pz__posicion').last()).toHaveText('10')
    // La nota cuenta los puestos **a la vista** y los que quedan: quince en el top
    // con diez recortados se lee «10 títulos · y 5 más», no «15 títulos».
    await expect(top.locator('.nota__cuenta')).toHaveText('10 títulos · y 5 más')

    await top.getByRole('button', { name: 'Mostrar más' }).click()

    await expect(tarjetas).toHaveCount(15)
    await expect(top.locator('.pz__posicion').last()).toHaveText('15')
    await expect(top.getByRole('button', { name: 'Mostrar más' })).toHaveCount(0)
    // Desplegado, el renglón dice los que hay: ya no queda nada por enseñar.
    await expect(top.locator('.nota__cuenta')).toHaveText('15 títulos')
  })

  /**
   * Una instalación sin historial: la home dice qué falta en vez de quedarse en
   * blanco.
   *
   * Las dos listas que pueden traer algo se sirven vacías desde aquí y no se le
   * piden al servidor: la base del e2e es una sola para toda la pasada y otra
   * prueba puede haber guardado un favorito o dejado un episodio a medias, así que
   * mirar el estado real haría de esto una prueba del orden en que corren las
   * demás. Lo que se mide es cómo se pinta una home vacía, y eso se sirve vacío.
   */
  test('sin historial lo dice en vez de quedarse en blanco', async ({ page }) => {
    await page.route('**/api/favorites', async (ruta) => {
      if (ruta.request().method() === 'GET') {
        await ruta.fulfill({ json: { favorites: [] } })
        return
      }
      await ruta.continue()
    })
    await page.route('**/api/watch/recent', async (ruta) => {
      await ruta.fulfill({ json: { items: [] } })
    })

    await entrar(page)

    await expect(page.getByText('Nada a medias')).toBeVisible()
    await expect(page.getByText('Todavía no has marcado ninguno')).toBeVisible()
  })

  test('la fuente llena la home sin que nadie haya buscado nada', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)

    // El fixture declara `capabilities.feed`, así que la fila de novedades tiene
    // piezas propias: es lo que hace que una instalación nueva no se quede con un
    // titular y nada más. Se mira **lo que se ve**, no lo que devuelve la API.
    const novedades = page.locator('.seccion', {
      has: page.getByRole('heading', { name: 'Novedades' }),
    })

    await expect(novedades).toBeVisible()
    await expect(novedades.locator('.pz__titulo').first()).toBeVisible()

    // Y la fila de lo que la aplicación conoce está siempre, con contenido o con
    // su explicación: una fila que desaparece deja al usuario sin saber si la
    // función existe.
    await expect(page.getByRole('heading', { name: 'Último añadido' })).toBeVisible()
  })

  test('el tema se aplica al documento', async ({ page }) => {
    await entrar(page)

    // `data-theme` es lo que la hoja de estilos mira para cambiar de paleta.
    // Estaba declarado en los tokens y **nadie lo escribía**: el tema claro era
    // inalcanzable. Lo encontró la captura del rediseño, y esta prueba existe
    // para que no vuelva a pasar desapercibido.
    const tema = await page.evaluate(() => document.documentElement.dataset.theme)

    expect(['dark', 'light']).toContain(tema)
  })
})

/**
 * El conmutador entre anime y películas.
 *
 * El fixture declara `media: 'both'` y su catálogo trae series y **una** película
 * —`el-jardin-de-hierro`—, así que es el único sitio donde se puede medir en un
 * navegador que una fuente mixta se reparta por el `kind`: en la pestaña de anime la
 * película no sale del top, y en la de películas el top se queda con ella y con
 * nadie más.
 *
 * Se busca la película por su **enlace** —`/anime/fixture/el-jardin-de-hierro`— y no
 * por su título: el título lleva tilde y el enlace no depende de cómo se escriba.
 */
test.describe('el conmutador de tipo', () => {
  const PELICULA = '.pz__enlace[href*="el-jardin-de-hierro"]'

  function elTop(page: import('@playwright/test').Page) {
    return page.locator('.seccion', {
      has: page.getByRole('heading', { name: 'Top de la fuente' }),
    })
  }

  test('la mitad vive en la dirección y cambia lo que se enseña', async ({ page }) => {
    await entrar(page)

    await expect(elTop(page).locator(PELICULA)).toHaveCount(0)

    await page.locator('.conmutador').getByRole('link', { name: 'Películas' }).click()

    // La elección queda en la dirección: se puede recargar, compartir, y el botón
    // «atrás» del navegador la deshace.
    await expect(page).toHaveURL(/tipo=movies/)
    await expect(
      page.locator('.conmutador').getByRole('link', { name: 'Películas' }),
    ).toHaveAttribute('aria-current', 'page')

    await expect(elTop(page).locator(PELICULA)).toHaveCount(1)
    // Y el top de esa mitad es sólo la película: las series de la misma fuente se
    // quedaron en la otra pestaña.
    await expect(elTop(page).locator('.pz:not(.pz--mando)')).toHaveCount(1)
  })

  /**
   * La franja, en una ventana estrecha.
   *
   * El mando mide lo que el resto de mandos de la interfaz —44 px— y en la cabecera
   * de 56 no cabía: esto mide que la franja propia no desborda a 360 px y que el
   * conmutador sigue siendo pulsable, que es lo que promete la hoja.
   */
  test('en 360 px no hay desplazamiento horizontal y el mando sigue midiendo lo suyo', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 })
    await entrar(page)

    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )

    expect(desborde).toBeLessThanOrEqual(0)

    const caja = await page
      .locator('.conmutador')
      .getByRole('link', { name: 'Anime' })
      .boundingBox()

    expect(caja?.height ?? 0).toBeGreaterThanOrEqual(44)
  })
})
