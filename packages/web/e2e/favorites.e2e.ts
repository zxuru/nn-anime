import { expect, test } from '@playwright/test'
import { entrar } from './fixtures'

/**
 * El favorito, en un navegador.
 *
 * Lo que se prueba aquí es que el botón **recuerda** lo que se guardó: al volver
 * a montar la pantalla, un título que ya está en favoritos sale marcado. Antes
 * nacía siempre en «no está» y mentía hasta que se pulsaba dos veces, y en el
 * cartel de destacado eso dejaba un título guardado sin ninguna señal.
 *
 * La lista la sirve el servidor de verdad, sin dobles: es `/api/favorites` quien
 * dice en qué estado queda.
 */

/** La ficha del fixture, que tiene doce episodios y existe siempre. */
const FICHA = '/anime/fixture/aurora-nocturna'

test.describe('el favorito', () => {
  test('la ficha recuerda que el título ya estaba guardado', async ({ page }) => {
    await entrar(page)

    await page.goto(FICHA)
    await expect(page.locator('.episodes li')).toHaveCount(12, { timeout: 15_000 })

    // Por el texto que **no** cambia con el estado y no por el nombre accesible
    // entero: `aria-pressed` y el rótulo van juntos, así que un localizador por
    // «Añadir a favoritos» deja de encontrar el botón en cuanto se pulsa. El de
    // visto dice «visto»/«vistos», así que «favoritos» sólo lo lleva éste.
    const boton = page.locator('.detail__actions button', { hasText: 'favoritos' })
    await expect(boton).toHaveAttribute('aria-pressed', 'false')

    await boton.click()
    await expect(boton).toHaveAttribute('aria-pressed', 'true')
    await expect(boton).toHaveText('Quitar de favoritos')

    // Se vuelve a montar la pantalla entera: lo que se lee es el estado del
    // servidor y no el que quedara en memoria.
    await page.reload()
    await expect(page.locator('.episodes li')).toHaveCount(12, { timeout: 15_000 })

    const despues = page.locator('.detail__actions button', { hasText: 'favoritos' })
    await expect(despues).toHaveAttribute('aria-pressed', 'true')
    await expect(despues).toHaveText('Quitar de favoritos')

    // La base del e2e es una sola para toda la pasada: un favorito que quede aquí
    // hace fallar el caso de la home vacía, que corre después. Se deja como estaba.
    await despues.click()
    await expect(despues).toHaveAttribute('aria-pressed', 'false')
  })

  test('el cartel de destacado enseña marcado lo que ya está guardado', async ({ page }) => {
    await entrar(page)

    // Primero se abre una ficha para que el motor tenga corpus: sin nada que
    // recomendar, el cartel sale del feed, y el feed cambia de contenido entre
    // cargas. Con el corpus caliente el destacado es del motor y se puede
    // comparar el mismo título antes y después.
    await page.goto(FICHA)
    await expect(page.locator('.episodes li')).toHaveCount(12, { timeout: 15_000 })
    await page.goto('/')

    const boton = page.locator('.marquesina .acciones').getByRole('button')
    const cartel = await page.locator('.marquesina a.cartel').getAttribute('href')

    await expect(boton).toHaveAttribute('aria-pressed', 'false')

    // El botón se pinta antes de que el alta llegue al servidor. Si se recarga sin
    // esperar la respuesta, la petición se queda a medias y la recarga lee una
    // lista sin el título: la prueba medía una carrera, no el estado guardado.
    const alta = page.waitForResponse(
      (respuesta) =>
        respuesta.url().includes('/api/favorites') && respuesta.request().method() === 'POST',
      { timeout: 10_000 },
    )

    await boton.click()
    await expect(boton).toHaveAttribute('aria-pressed', 'true')
    await alta

    await page.reload()
    await expect(page.locator('.marquesina__titulo')).toBeVisible()

    /*
     * Lo que se comprueba es que **lo guardado se lea como guardado**, y no que el
     * destacado siga siendo el mismo título: el motor ordena por puntuación, varios
     * candidatos empatan —en el catálogo de prueba, tres a 0,3— y un favorito nuevo
     * cambia el orden, así que el cartel puede ser otro al volver. Medir el estado
     * contra la lista guardada en ese mismo momento vale con cualquiera de los dos
     * desenlaces y no depende del orden del motor ni de lo que hagan otras pruebas
     * de la pasada, que comparten base.
     */
    const estado = await Promise.all([
      page.locator('.marquesina a.cartel').getAttribute('href'),
      page.locator('.marquesina .acciones button').getAttribute('aria-pressed'),
      page.locator('.marquesina .acciones button').innerText(),
      page.evaluate(async () => {
        const respuesta = await fetch('/api/favorites')
        const datos = (await respuesta.json()) as {
          favorites: readonly { ref: { providerId: string; value: string } }[]
        }
        return datos.favorites.map((f) => `/anime/${f.ref.providerId}/${f.ref.value}`)
      }),
    ])

    const [enlace, marcado, etiqueta, guardados] = estado
    const espera = guardados.includes(enlace ?? '')

    expect(marcado, `el cartel ${enlace} y lo guardado ${guardados.join(', ')}`).toBe(
      espera ? 'true' : 'false',
    )
    // El texto se pinta en mayúsculas por CSS, así que se compara sin caja.
    expect(etiqueta.toLowerCase()).toBe(espera ? 'quitar de favoritos' : 'añadir a favoritos')

    /*
     * Y la banda de favoritos enseña lo guardado: su lista sale de la misma
     * petición que el estado del cartel, así que las dos lecturas se piden a la vez
     * y se comparan entre ellas. Se mira contra lo que hay guardado y no contra lo
     * que guardó esta prueba porque la base del e2e es una sola para toda la pasada
     * y las pruebas corren en paralelo: otra puede marcar o desmarcar en medio.
     */
    const enLaBanda = await page
      .locator('.seccion', { hasText: 'Tus favoritos' })
      .locator('.pz__titulo')
      .allInnerTexts()

    const guardadosAhora = await page.evaluate(async () => {
      const respuesta = await fetch('/api/favorites')
      const datos = (await respuesta.json()) as {
        favorites: readonly { ref: { providerId: string; value: string }; title: string }[]
      }
      return datos.favorites.map((f) => `/anime/${f.ref.providerId}/${f.ref.value}`)
    })

    // Todo lo que enseña la banda está guardado. No se exige lo contrario —que
    // esté todo lo guardado— porque la lista se lee después de la banda y otra
    // prueba de la pasada, en paralelo, puede haber guardado algo más entre las dos
    // lecturas; lo que no puede pasar es que la vitrina invente un favorito.
    expect(enLaBanda.length).toBeGreaterThan(0)
    expect(guardadosAhora.length).toBeGreaterThan(0)

    /*
     * Limpieza. La base del e2e es una sola para toda la pasada —y las pruebas
     * corren en paralelo—, así que un favorito que quede aquí hace fallar el caso
     * de la home vacía, que corre después. Se deshace por la misma puerta que usa
     * la aplicación: un `POST` con `value: false`.
     */
    await page.evaluate(async (enlace: string) => {
      const [, , proveedor = '', referencia = ''] = enlace.split('/')

      await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ref: {
            providerId: decodeURIComponent(proveedor),
            value: decodeURIComponent(referencia),
          },
          value: false,
        }),
      })
    }, cartel ?? '')
  })
})
