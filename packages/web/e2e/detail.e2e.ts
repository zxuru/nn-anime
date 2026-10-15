import { expect, test } from '@playwright/test'
import { entrar } from './fixtures'

/**
 * El camino de la búsqueda al detalle, en un navegador.
 *
 * Lo que se prueba aquí es que la navegación sin recargar funciona de verdad: se
 * busca, se elige un título y se llega a su ficha con su lista de episodios. Es
 * el camino crítico de la aplicación y el que rompe si alguien toca el enrutador.
 */

test.describe('la ficha enriquecida', () => {
  /**
   * Lo que añade AniList cuando está emparejada.
   *
   * El arnés arranca con AniList apagado —una prueba no puede depender de un
   * tercero—, así que la respuesta se sirve desde la prueba. Lo que se comprueba
   * es lo que el servidor no puede: que la sinopsis se pinta como texto, que la
   * nota y el enlace salen, y que nada de eso rompe la ficha.
   */
  test('enseña la sinopsis, la nota y el enlace a AniList', async ({ page }) => {
    await page.route('**/api/anime/*/*/enrichment', async (ruta) => {
      await ruta.fulfill({
        json: {
          enrichment: {
            anilistId: 555,
            cover: '/api/anilist/image/cover/555',
            synopsis: 'Una cartógrafa recorre el cielo de su ciudad.',
            genres: ['Misterio', 'Fantasía'],
            score: 84,
            status: 'finished',
            year: 2019,
            format: 'TV',
            studios: ['Estudio Cobre'],
            siteUrl: 'https://anilist.co/anime/555',
          },
        },
      })
    })

    await entrar(page)
    await page.goto('/anime/fixture/aurora-nocturna')

    await expect(page.getByRole('heading', { name: 'De AniList' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText('Nota 84/100')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ver la ficha en AniList' })).toHaveAttribute(
      'href',
      'https://anilist.co/anime/555',
    )
    // La sinopsis del proveedor es la que manda —es su ficha—, y la de AniList
    // se queda como reserva: se comprueba que la de la fuente sigue siendo la
    // que se lee y que no aparece la otra.
    await expect(
      page.getByText('Una cartógrafa descubre que el cielo de su ciudad se puede recorrer a pie.'),
    ).toBeVisible()
    await expect(page.getByText('Una cartógrafa recorre el cielo de su ciudad.')).toHaveCount(0)
  })

  /**
   * El banner de AniList, como fondo de la cabecera.
   *
   * El enriquecimiento y la imagen llegan interceptados —el arnés arranca sin
   * AniList—, y lo que se mide es lo que el renderizado de servidor no puede: que
   * el navegador **pida** la imagen, que la pinte como fondo de la banda, que el
   * titular quede por encima y que no haya ninguna `<img>` que pueda quedar rota.
   *
   * El GIF es un píxel: lo que se comprueba es el mecanismo —petición, fondo,
   * capa decorativa—, no el contenido de la imagen.
   */
  test('el banner es el fondo de la cabecera, con el título encima', async ({ page }) => {
    const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
    const pedidas: string[] = []

    await page.route('**/api/anime/*/*/enrichment', async (ruta) => {
      await ruta.fulfill({
        json: {
          enrichment: {
            anilistId: 555,
            cover: '/api/anilist/image/cover/555',
            banner: '/api/anilist/image/banner/555',
            genres: [],
            studios: [],
            siteUrl: 'https://anilist.co/anime/555',
          },
        },
      })
    })

    await page.route('**/api/anilist/image/banner/555', async (ruta) => {
      pedidas.push(ruta.request().url())
      await ruta.fulfill({ body: PIXEL, contentType: 'image/gif' })
    })

    await entrar(page)

    /*
      La cuenta empieza al entrar en la ficha.

      El enriquecimiento se sirve para **cualquier** referencia en esta prueba, así
      que la vitrina —que desde T125 también pinta el banner de su destacado— pide
      esta misma imagen al pasar por la home. Lo que se mide aquí es que la ficha
      pida la suya, no cuántas veces la pidió la pantalla anterior.
    */
    pedidas.length = 0

    await page.goto('/anime/fixture/aurora-nocturna')

    const banda = page.locator('.detail__banner')
    await expect(banda).toBeVisible({ timeout: 10_000 })
    // El titular, dentro de la banda: el encabezado no es un adorno.
    await expect(banda.getByRole('heading', { name: 'Aurora Nocturna' })).toBeVisible()

    const capa = page.locator('.detail__banner-fondo')
    await expect(capa).toHaveAttribute('aria-hidden', 'true')
    await expect
      .poll(async () => capa.evaluate((nodo) => getComputedStyle(nodo).backgroundImage))
      .toContain('/api/anilist/image/banner/555')

    // La imagen se pidió de verdad —el navegador sólo pide el fondo de lo que
    // pinta— y el titular está **encima** de la capa, no detrás.
    expect(pedidas).toHaveLength(1)

    const capas = await banda.evaluate((nodo) => {
      const capa = nodo.querySelector('.detail__banner-fondo')
      const titulo = nodo.querySelector('h1')

      return {
        zIndex: capa === null ? '' : getComputedStyle(capa).zIndex,
        fondo: capa?.getBoundingClientRect().height ?? 0,
        titulo: titulo?.getBoundingClientRect().height ?? 0,
      }
    })

    // La capa va por detrás (`z-index` negativo) y cubre la banda: si midiera
    // cero, el fondo no se vería aunque la ruta estuviera bien puesta.
    expect(capas.zIndex).toBe('-1')
    expect(capas.fondo).toBeGreaterThan(capas.titulo)

    // Y no hay ninguna `<img>` del banner: es lo que dejaba el icono de imagen
    // rota cuando la obra no tenía banner o su caché todavía no lo servía.
    await expect(page.locator('img[src*="/api/anilist/image/banner"]')).toHaveCount(0)
  })

  test('un banner que no llega no deja ninguna imagen rota', async ({ page }) => {
    await page.route('**/api/anime/*/*/enrichment', async (ruta) => {
      await ruta.fulfill({
        json: {
          enrichment: {
            anilistId: 555,
            cover: '/api/anilist/image/cover/555',
            banner: '/api/anilist/image/banner/555',
            genres: [],
            studios: [],
            siteUrl: 'https://anilist.co/anime/555',
          },
        },
      })
    })

    // El caso que se veía en la ficha: la ruta del banner contesta 404.
    await page.route('**/api/anilist/image/banner/555', async (ruta) => {
      await ruta.fulfill({ status: 404, body: 'no está' })
    })

    await entrar(page)
    await page.goto('/anime/fixture/aurora-nocturna')

    await expect(page.getByRole('heading', { name: 'Aurora Nocturna' })).toBeVisible({
      timeout: 10_000,
    })
    // La ficha se lee igual, y no queda ninguna imagen rota: el fondo que no
    // carga simplemente no se pinta.
    await expect(page.locator('.episodes li').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('img[src*="/api/anilist/image/banner"]')).toHaveCount(0)
  })

  test('un banner que no es la ruta del servidor no se pinta', async ({ page }) => {
    await page.route('**/api/anime/*/*/enrichment', async (ruta) => {
      await ruta.fulfill({
        json: {
          enrichment: {
            anilistId: 555,
            cover: '/api/anilist/image/cover/555',
            // Una dirección ajena. La capa del fondo se compone con este valor,
            // así que sólo se pinta si tiene la forma que compone el servidor.
            banner: 'https://otro.example/banner.jpg',
            genres: [],
            studios: [],
            siteUrl: 'https://anilist.co/anime/555',
          },
        },
      })
    })

    await entrar(page)
    await page.goto('/anime/fixture/aurora-nocturna')

    await expect(page.getByRole('heading', { name: 'Aurora Nocturna' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.locator('.detail__banner-fondo')).toHaveCount(0)
    // Y la cabecera sigue ahí: la banda no depende del banner.
    await expect(page.locator('.detail__banner')).toBeVisible()
  })
})

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

/**
 * Un título que junta sus temporadas en una sola lista.
 *
 * La fuente escribe la temporada en el título del episodio —`T2 E1 · Algo`— y la
 * aplicación la lee de ahí; el índice lo calcula el servidor, que es el único que
 * ve la lista entera. Se mide en un navegador porque el índice llega dentro de un
 * efecto: el renderizado de servidor pinta el aviso de que los episodios están
 * llegando y ninguna banda. La ruta se intercepta porque el fixture no marca
 * temporadas —sus títulos son «Episodio N»—, así que aquí se sirve un título de
 * dos temporadas de seis episodios, con páginas de tres para medir las dos.
 */
test.describe('un título con temporadas', () => {
  test('la banda elige la temporada y la lista se pide por temporada', async ({ page }) => {
    await entrar(page)

    const POR_TEMPORADA = 6
    const POR_PAGINA = 3
    const TOTAL = 12
    const temporadas = [
      { season: 1, count: POR_TEMPORADA },
      { season: 2, count: POR_TEMPORADA },
    ]

    /** Un episodio del título, numerado contra él y marcado con su temporada. */
    const episodio = (number: number): unknown => {
      const season = Math.ceil(number / POR_TEMPORADA)
      const inSeason = number - (season - 1) * POR_TEMPORADA

      return {
        ref: { providerId: 'fixture', value: `aurora-nocturna#${number}` },
        animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
        number,
        title: `T${season} E${inSeason} · Episodio ${inSeason}`,
        durationS: 1440,
        mode: 'sub',
      }
    }

    /** Lo que pidió la pantalla, con su consulta, en orden. */
    const rutas: string[] = []

    await page.route(
      (url) => url.pathname === '/api/anime/fixture/aurora-nocturna/episodes',
      async (ruta) => {
        const consulta = new URL(ruta.request().url()).searchParams
        rutas.push(consulta.toString())

        const season = Number(consulta.get('season') ?? '1')
        const numero = Number(consulta.get('page') ?? '1')
        const desde = (numero - 1) * POR_PAGINA
        const suyos = Array.from({ length: POR_PAGINA }, (_, indice) =>
          episodio((season - 1) * POR_TEMPORADA + desde + indice + 1),
        )

        await ruta.fulfill({
          json: {
            episodes: suyos,
            page: numero,
            hasMore: desde + POR_PAGINA < POR_TEMPORADA,
            total: TOTAL,
            seasons: temporadas,
          },
        })
      },
    )

    await page.goto('/anime/fixture/aurora-nocturna')

    // La banda, con sus dos temporadas, y la primera marcada: la ficha pide la
    // lista entera, ve que el título tiene temporadas y pide la primera en vez de
    // pintar los doce episodios y cambiarlos después.
    const banda = page.getByRole('list', { name: 'Temporadas' })
    await expect(banda.getByRole('button', { name: /Temporada 1/ })).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 15_000 },
    )
    await expect(banda.getByRole('button', { name: /Temporada 2/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect(banda.getByRole('button', { name: /Temporada 2/ })).toContainText('6 episodios')

    // Y la lista son los tres primeros de la temporada 1, numerados **contra el
    // título**: «Episodio 1 de 12», que es la etiqueta de la fuente y lo que
    // enseña el reproductor.
    await expect(page.locator('.episodes li')).toHaveCount(POR_PAGINA)
    await expect(page.locator('.episodes li').first()).toContainText('Episodio 1 de 12')
    await expect(page.locator('.episodes li').first()).toContainText('T1 E1 · Episodio 1')
    expect(rutas).toEqual(['page=1', 'page=1&season=1'])

    // La página siguiente sigue siendo la de esta temporada.
    await page.getByRole('button', { name: 'Página siguiente' }).click()

    await expect(page.locator('.episodes li').first()).toContainText('Episodio 4 de 12')

    // Y elegir la otra temporada es pedirla: la lista cambia de contenido, no de
    // filtro sobre lo ya descargado.
    await banda.getByRole('button', { name: /Temporada 2/ }).click()

    await expect(banda.getByRole('button', { name: /Temporada 2/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.locator('.episodes li').first()).toContainText('Episodio 7 de 12')
    await expect(page.locator('.episodes li').first()).toContainText('T2 E1 · Episodio 1')

    /**
     * Las cuatro peticiones, y en ese orden.
     *
     * La comparación es la lista entera y no la última ruta porque una petición de
     * más —`page=2` sin temporada, que devuelve la lista entera otra vez— se ve en
     * la secuencia y no en el resultado: la banda seguiría enseñando la temporada
     * marcada y la lista, los mismos episodios.
     */
    await expect
      .poll(() => rutas)
      .toEqual(['page=1', 'page=1&season=1', 'page=2&season=1', 'page=1&season=2'])
  })

  test('sin temporadas marcadas no hay banda: la lista se lee entera', async ({ page }) => {
    await entrar(page)

    await page.goto('/anime/fixture/mar-de-cristal')

    await expect(page.locator('.episodes li')).toHaveCount(5, { timeout: 15_000 })
    await expect(page.locator('.episodes__seasons')).toHaveCount(0)
  })
})
