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
  /**
   * El campo se lleva el foco al entrar.
   *
   * Se mide en las dos maneras de llegar: una carga completa de `/search`, donde
   * el efecto de montaje basta, y el enlace de la cabecera, que es una navegación
   * sin recarga y donde el armazón mueve el foco al `main` al cambiar de camino.
   * Sin la guarda del armazón, el segundo caso deja el foco en el contenido y hay
   * que tabular hasta el campo para escribir.
   */
  test('al entrar en Buscar el campo se lleva el foco', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)

    const casilla = page.getByLabel('Buscar por título')

    await page.goto('/search')
    await expect(casilla).toBeFocused()

    await page.goto('/')
    await esperarApp(page)
    await page.getByRole('link', { name: 'Buscar' }).first().click()

    await expect(page).toHaveURL(/\/search/)
    await expect(casilla).toBeFocused()
  })

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
   * Abrir Buscar no es buscar.
   *
   * Antes, entrar en `/search` sin término suscribía el stream y preguntaba el
   * catálogo entero a todas las fuentes. La pantalla de invitación se convertía
   * en un listado arbitrario y el usuario pagaba tráfico que no había pedido.
   */
  test('abrir Buscar sin término no consulta a las fuentes', async ({ page }) => {
    await entrar(page)

    let peticiones = 0
    page.on('request', (peticion) => {
      if (new URL(peticion.url()).pathname === '/api/search') peticiones += 1
    })

    await page.goto('/search')

    await expect(page.getByText('Escribe un título para empezar')).toBeVisible()
    await page.waitForTimeout(600)
    expect(peticiones).toBe(0)
  })

  /**
   * La espera tiene la forma de la tarjeta y vive en la misma lista.
   *
   * Se retrasan a la vez la lista de proveedores y el stream: la pantalla enseña
   * los cuatro huecos iniciales y, cuando llega la tarjeta, el alto de la rejilla
   * no salta. Antes había una segunda lista encima y el contenido subía 224 px.
   */
  test('la espera de Buscar usa la tarjeta y no mueve la página', async ({ page }) => {
    await page.route('**/api/providers*', async (ruta) => {
      await page.waitForTimeout(1200)
      await ruta.continue()
    })
    await page.route('**/api/search*', async (ruta) => {
      await page.waitForTimeout(1200)
      await ruta.continue()
    })

    await page.goto('/search?q=aurora')

    const esqueletos = page.locator('.card--esqueleto')
    await expect(esqueletos).toHaveCount(4)
    await expect(page.locator('ul.grid')).toHaveCount(1)

    const antes = await page.locator('ul.grid').boundingBox()

    const tarjeta = page.locator('.card:not(.card--esqueleto)').first()
    await expect(tarjeta).toBeVisible({ timeout: 10_000 })
    await expect(esqueletos).toHaveCount(0)
    await expect(page.locator('ul.grid')).toHaveCount(1)

    const despues = await page.locator('ul.grid').boundingBox()
    expect(Math.abs((despues?.height ?? 0) - (antes?.height ?? 0))).toBeLessThan(8)
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
    // La que está en una fuente abre su ficha —con la consulta de la búsqueda,
    // que es el rastro que el motor usa—; la que no, la búsqueda de su título.
    await expect(
      page.locator('a[href^="/anime/fixture/aurora-nocturna?q=Estudio"]').first(),
    ).toBeVisible()
    await expect(page.locator('a[href^="/search?q=Dungeon"]').first()).toBeVisible()
    // Y no se dice que no haya nada: la lista de debajo es lo que hay.
    await expect(page.getByText('Nada coincide')).toHaveCount(0)
  })

  /**
   * El rastro de la búsqueda, de punta a punta.
   *
   * Es el camino que faltaba y lo que se mide aquí no se puede medir en unitario:
   * abrir una ficha desde Buscar pone la consulta en la dirección, la petición del
   * detalle la lleva, el servidor la anota en `search_history` y el motor la usa
   * al recomendar. Sin él, buscar no cambiaba ninguna recomendación: con el
   * historial de visionado vacío todos los candidatos puntuaban cero y el
   * destacado era siempre el mismo por el desempate.
   *
   * Se busca un título que ninguna otra prueba de la pasada abre ni reproduce
   * —«Reloj de Arena»—: la base del arnés es una sola para todo el recorrido y un
   * título ya visto queda fuera de las recomendaciones.
   */
  test('la ficha abierta desde una búsqueda deja el rastro y el motor recomienda por ella', async ({
    page,
  }) => {
    await entrar(page)
    await esperarApp(page)

    // La petición que deja el rastro: el detalle, con la consulta. Se espera
    // antes de pulsar para no perderse la respuesta.
    const rastro = page.waitForResponse((respuesta) => {
      const url = new URL(respuesta.url())

      return (
        url.pathname === '/api/anime/fixture/reloj-de-arena' &&
        url.searchParams.get('q') === 'reloj'
      )
    })

    await page.goto('/search')
    await page.getByLabel('Buscar por título').fill('reloj')

    const tarjeta = page.locator('a[href^="/anime/fixture/reloj-de-arena"]').first()
    await expect(tarjeta).toBeVisible({ timeout: 10_000 })
    await expect(tarjeta).toHaveAttribute('href', '/anime/fixture/reloj-de-arena?q=reloj')

    await tarjeta.click()
    await rastro
    await expect(page).toHaveURL(/\/anime\/fixture\/reloj-de-arena\?q=reloj/)

    /*
      La reacción del motor, leída de la ruta y no del titular.

      El destacado es el primer puesto del ranking y en la base del arnés —una
      sola para toda la pasada— las otras pruebas dejan historial de visionado y
      favoritos: cuál gana el primer puesto depende de ellas. Lo que se mide aquí
      es que la búsqueda entró como señal y que el título buscado se explica por
      ella. El `waitForResponse` de arriba ya midió que la petición llevaba la
      consulta.
    */
    const respuesta = await page.request.get('/api/recommendations?limit=20')
    expect(respuesta.ok()).toBe(true)

    const cuerpo = (await respuesta.json()) as {
      readonly items: readonly {
        readonly title: string
        readonly reason: { readonly kind: string; readonly text: string }
      }[]
    }
    const reloj = cuerpo.items.find((item) => item.title === 'Reloj de Arena')

    expect(reloj?.reason.kind).toBe('matches-search')
    expect(reloj?.reason.text).toContain('buscaste hace poco')
  })

  /**
   * La otra mitad del rastro: la ficha abierta por su dirección, con la consulta
   * ya puesta.
   *
   * Sin tarjeta de por medio no hay precarga que la lleve, así que lo que se mide
   * aquí es que la pantalla lea la consulta de la dirección y la reenvíe a su
   * lectura. Es lo que hace que abrir un resultado en una pestaña nueva —el enlace
   * es un `<a href>` de verdad— también deje el rastro.
   */
  test('una ficha abierta por una dirección con consulta reenvía el rastro', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)

    const rastro = page.waitForResponse((respuesta) => {
      const url = new URL(respuesta.url())

      return (
        url.pathname === '/api/anime/fixture/reloj-de-arena' &&
        url.searchParams.get('q') === 'reloj'
      )
    })

    await page.goto('/anime/fixture/reloj-de-arena?q=reloj')
    await rastro

    await expect(page.getByRole('heading', { name: 'Reloj de Arena' })).toBeVisible()
  })
})
