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
    await expect(page.getByRole('heading', { name: 'Top de la fuente' })).toBeVisible()
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
      has: page.getByRole('heading', { name: 'Top de la fuente' }),
    })
    // Las piezas del top son las de dos por dos: el mando de «Mostrar más» también
    // es una pieza del mosaico, pero no un puesto.
    const tarjetas = top.locator('.pz--b')

    await expect(tarjetas).toHaveCount(10)
    await expect(top.locator('.pz__posicion').last()).toHaveText('10')

    await top.getByRole('button', { name: 'Mostrar más' }).click()

    await expect(tarjetas).toHaveCount(15)
    await expect(top.locator('.pz__posicion').last()).toHaveText('15')
    await expect(top.getByRole('button', { name: 'Mostrar más' })).toHaveCount(0)
  })

  test('sin historial lo dice en vez de quedarse en blanco', async ({ page }) => {
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

  test('el panel dice que no hay historial todavía', async ({ page }) => {
    await entrar(page)

    // El panel del motor vive dentro de un desplegable: el top es el de la fuente
    // y no lleva motivos, así que el sitio donde el motor se explica es éste.
    await page.getByText('¿Por qué estas recomendaciones?').click()

    await expect(page.getByText('Sin historial todavía')).toBeVisible()
  })
})
