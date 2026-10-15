import { setTimeout as pausa } from 'node:timers/promises'
import { expect, type Page, test } from '@playwright/test'
import { BASE, entrar, esperarApp } from './fixtures'

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
   * La parrilla de estrenos.
   *
   * El arnés arranca con AniList apagado —una prueba no puede depender de un
   * tercero—, así que aquí se le da de comer la respuesta de la ruta como si
   * hubiera contestado: es la única forma de comprobar que la fila agrupa por día
   * y que cada capítulo lleva su hora.
   */
  test('la parrilla agrupa los estrenos por día', async ({ page }) => {
    const hoy = new Date()
    const manana = new Date(hoy.getTime() + 86_400_000)

    await page.route('**/api/discover/airing*', async (ruta) => {
      await ruta.fulfill({
        json: {
          items: [
            {
              anilistId: 101922,
              title: 'Kimetsu no Yaiba',
              cover: '/api/anilist/image/cover/101922',
              adult: false,
              episode: 5,
              airingAt: hoy.toISOString(),
              kind: 'tv',
            },
            {
              anilistId: 20920,
              title: 'Danmachi',
              cover: '/api/anilist/image/cover/20920',
              adult: false,
              episode: 12,
              airingAt: manana.toISOString(),
              kind: 'tv',
            },
          ],
        },
      })
    })

    await entrar(page)
    await esperarApp(page)

    const parrilla = page.locator('.seccion', {
      has: page.getByRole('heading', { name: 'Parrilla', exact: true }),
    })

    await expect(parrilla.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible()
    await expect(parrilla.getByRole('heading', { name: 'Mañana', exact: true })).toBeVisible()
    await expect(parrilla.getByText('Kimetsu no Yaiba')).toBeVisible()
    await expect(parrilla.getByText('Ep. 5 ·', { exact: false })).toBeVisible()
    // Sin referencia local, la pieza abre la búsqueda de su título.
    await expect(parrilla.locator('a[href^="/search?q=Kimetsu"]')).toHaveCount(1)
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

    // El patrón lleva el comodín del final: la ruta viaja con `?media=anime`
    // desde el conmutador de tipo, y sin él no interceptaba nada —la prueba
    // medía el top del fixture y no el que le daba de comer—.
    await page.route('**/api/trending**', async (ruta) => {
      await ruta.fulfill({ json: { items } })
    })

    await entrar(page)
    await esperarApp(page)

    const top = page.locator('.seccion', {
      has: page.getByRole('heading', { name: 'Top', exact: true }),
    })
    // Las piezas del top: el mando de «Mostrar más» también es una pieza del
    // mosaico, pero no un puesto. Todas son iguales —un cartel de una columna—: el
    // orden de la fuente no admite que una destaque sobre otra.
    const tarjetas = top.locator('.pz:not(.pz--mando)')

    await expect(tarjetas).toHaveCount(10)
    await expect(top.locator('.pz__posicion').last()).toHaveText('10')
    // La nota cuenta los puestos **a la vista** y los que quedan: quince en el top
    // con diez recortados se lee «10 títulos · y 5 más», no «15 títulos».
    // La cuenta del tramo, no la del mando de desplegar: las dos llevan la clase
    // y la del mando dice sólo lo que queda.
    await expect(top.locator('.seccion__nota .nota__cuenta')).toHaveText('10 títulos · y 5 más')

    await top.getByRole('button', { name: 'Mostrar más' }).click()

    await expect(tarjetas).toHaveCount(15)
    await expect(top.locator('.pz__posicion').last()).toHaveText('15')
    await expect(top.getByRole('button', { name: 'Mostrar más' })).toHaveCount(0)
    // Desplegado, el renglón dice los que hay: ya no queda nada por enseñar.
    await expect(top.locator('.seccion__nota .nota__cuenta')).toHaveText('15 títulos')
  })

  /**
   * La cifra del top cabe entera en su pieza.
   *
   * Medía `--pieza-posicion` —48 px en la rejilla de seis columnas— y colgaba del
   * borde de arriba: el corte se llevaba la mitad de la cifra. Con un solo dígito
   * parecía un recorte a propósito; con «10» y «11» no se sabía qué número era.
   *
   * Lo que se mide es **la tinta**, no la caja: la caja de línea de un texto dice
   * dónde empieza su línea, no dónde empieza el dibujo de la letra, y con un
   * interlineado corto la letra se sale de la caja y el borde la corta sin que la
   * caja se entere. El lienzo da las dos medidas que hacen falta —lo que sube la
   * fuente sobre su línea base y lo que sube el dibujo de estos dígitos—, y de ahí
   * sale dónde empieza la tinta de verdad.
   */
  test('el puesto del top cabe entero en la pieza', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)

    // La letra de la casa, ya cargada: con la del sistema las medidas son otras y lo
    // que se mide aquí es dónde cae la tinta con la letra de verdad.
    await page.evaluate(async () => {
      await document.fonts.ready
    })

    const top = page.locator('.seccion', {
      has: page.getByRole('heading', { name: 'Top', exact: true }),
    })

    const medidas = await top.locator('.pz:not(.pz--mando)').evaluateAll((piezas) =>
      piezas.map((pieza) => {
        const cifra = pieza.querySelector('.pz__posicion')
        if (cifra === null) return null

        const estilo = getComputedStyle(cifra)
        const lienzo = document.createElement('canvas').getContext('2d')
        if (lienzo === null) return null

        lienzo.font = `${estilo.fontWeight} ${estilo.fontSize} ${estilo.fontFamily}`

        const medida = lienzo.measureText(cifra.textContent ?? '')
        const linea = Number.parseFloat(estilo.lineHeight)
        const caja = cifra.getBoundingClientRect()
        const piezaCaja = pieza.getBoundingClientRect()
        // La línea base dentro de la caja de línea: medio interlineado —que con
        // `line-height: 1` es medio hueco de la fuente— más lo que sube la fuente.
        const base =
          caja.top +
          (linea - (medida.fontBoundingBoxAscent + medida.fontBoundingBoxDescent)) / 2 +
          medida.fontBoundingBoxAscent

        return {
          texto: cifra.textContent ?? '',
          tintaArriba: base - medida.actualBoundingBoxAscent,
          tintaAbajo: base + medida.actualBoundingBoxDescent,
          tintaIzquierda: caja.left,
          tintaDerecha: caja.right,
          piezaArriba: piezaCaja.top,
          piezaAbajo: piezaCaja.bottom,
          piezaIzquierda: piezaCaja.left,
          piezaDerecha: piezaCaja.right,
        }
      }),
    )

    const numeradas = medidas.filter((medida) => medida !== null)

    expect(numeradas.length).toBeGreaterThan(2)

    for (const medida of numeradas) {
      expect(medida.texto, 'una pieza del top sin su cifra').not.toBe('')
      expect(
        medida.tintaArriba - medida.piezaArriba,
        `el puesto ${medida.texto} se sale por arriba de su pieza`,
      ).toBeGreaterThan(0)
      expect(
        medida.piezaAbajo - medida.tintaAbajo,
        `el puesto ${medida.texto} se sale por abajo de su pieza`,
      ).toBeGreaterThan(0)
      expect(
        medida.tintaIzquierda - medida.piezaIzquierda,
        `el puesto ${medida.texto} se sale por la izquierda`,
      ).toBeGreaterThanOrEqual(0)
      expect(
        medida.piezaDerecha - medida.tintaDerecha,
        `el puesto ${medida.texto} se sale por la derecha`,
      ).toBeGreaterThan(0)
    }
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
  })

  /**
   * La rejilla apretada: carteles de una columna, más títulos por fila.
   *
   * El mosaico medía dos columnas por pieza —491x152 px en la rejilla ancha— y
   * dejaba tres títulos por fila con un hueco al lado. Ahora cada pieza es un
   * cartel de 2:3 y la fila se llena: es lo que se mide aquí, porque la proporción
   * de una pieza no la ve ninguna prueba de marcado y en la hoja de estilos sólo
   * se puede leer el token, no el resultado.
   */
  test('las piezas del mosaico son carteles y llenan la fila', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)

    const novedades = page.locator('.seccion', {
      has: page.getByRole('heading', { name: 'Novedades' }),
    })

    const cajas = await novedades.locator('.mosaico .pz').evaluateAll((piezas) =>
      piezas.map((pieza) => {
        const caja = pieza.getBoundingClientRect()

        return {
          ancho: Math.round(caja.width),
          alto: Math.round(caja.height),
          arriba: Math.round(caja.top),
        }
      }),
    )

    expect(cajas.length).toBeGreaterThan(3)

    for (const caja of cajas) {
      // Más altas que anchas, y con la proporción de una portada: 2:3.
      expect(caja.alto).toBeGreaterThan(caja.ancho)
      expect(caja.alto / caja.ancho).toBeCloseTo(1.5, 1)
    }

    // Y la fila se llena: el tramo de novedades pone más de dos títulos a la vista
    // —con el mosaico ancho ponía dos, con las piezas de dos columnas—, todos del
    // mismo tamaño, así que no queda hueco entre ellos.
    const primera = cajas.filter((caja) => caja.arriba === cajas[0]?.arriba)

    expect(primera.length).toBeGreaterThan(2)
    expect(new Set(cajas.map((caja) => caja.ancho)).size).toBe(1)
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
 * La marquesina del destacado.
 *
 * Dos cosas que se ven en el navegador y no en un `renderToString`: que un titular
 * larguísimo no crezca sin freno —va a cuerpo de cartel, y un nombre con subtítulo
 * se comía la pantalla y dejaba los mandos fuera— y que la columna de texto **no se
 * mueva** cuando llega la ficha, que es el salto que se veía al cargar: la sinopsis
 * viaja en la ficha, llegaba tarde, y como la marquesina centra su texto, el titular
 * subía de golpe.
 */
test.describe('la marquesina', () => {
  /** Dónde está el titular y cuánto mide la marquesina, en coordenadas de la ventana. */
  async function cajaDeLaMarquesina(page: Page): Promise<{ titulo: string; marquesina: string }> {
    return page.evaluate(() => {
      const caja = (selector: string): string => {
        const nodo = document.querySelector(selector)
        if (nodo === null) return 'no está'

        const r = nodo.getBoundingClientRect()

        return `${r.y.toFixed(2)} × ${r.x.toFixed(2)} ${r.width.toFixed(2)}×${r.height.toFixed(2)}`
      }

      return { titulo: caja('.marquesina__titulo'), marquesina: caja('.marquesina') }
    })
  }

  /**
   * Espera a que la vitrina termine de entrar.
   *
   * `.home > *` entra con un desplazamiento de seis píxeles, así que una medida
   * tomada a mitad de camino sale movida. El bucle de la cinta no cuelga de aquí:
   * `getAnimations()` no baja a los descendientes.
   */
  async function esperarLaEntrada(page: Page): Promise<void> {
    await page.locator('.marquesina').evaluate(async (nodo) => {
      await Promise.all(nodo.getAnimations().map((animacion) => animacion.finished))
    })
  }

  test('un titular larguísimo no pasa de tres renglones', async ({ page }) => {
    await entrar(page)

    const medida = await page.evaluate(() => {
      const titulo = document.querySelector('.marquesina__titulo')
      if (titulo === null) return null

      // El mismo texto dos veces: lo que se mide es el recorte, no el nombre que
      // traiga el fixture, que hoy cabe en dos renglones.
      titulo.textContent =
        `${titulo.textContent ?? ''} con su segunda temporada y la película recapitulatoria, subtítulo incluido`.repeat(
          2,
        )

      const estilo = getComputedStyle(titulo)

      return {
        alto: titulo.getBoundingClientRect().height,
        linea: Number.parseFloat(estilo.lineHeight),
      }
    })

    expect(medida, 'no hay titular en la marquesina').not.toBeNull()

    // Tres renglones, con medio píxel de tolerancia por el redondeo del subpíxel.
    expect(medida?.alto ?? 0).toBeLessThanOrEqual(3 * (medida?.linea ?? 0) + 0.5)
    expect(medida?.alto ?? 0).toBeGreaterThan(2 * (medida?.linea ?? 0))
  })

  /**
   * El titular, y todo lo que hay debajo, quietos mientras llegan los datos.
   *
   * La marquesina se pinta con lo primero que hay —un destacado de reserva, del
   * feed— y después la completan dos respuestas: la recomendación, que trae el
   * motivo, y la ficha, que trae la sinopsis y la referencia del primer episodio.
   * Antes, cada una empujaba la columna de texto y el titular subía de golpe: se
   * veía como un salto al cargar.
   *
   * Se retrasan las dos respuestas a propósito. Sin el retraso llegan antes de que
   * se pueda medir el primer fotograma y el salto —si lo hubiera— no se vería.
   *
   * Lo que se mide es la caja del titular **y el alto de la marquesina**: el
   * segundo es lo que dice que nada de lo que va debajo se ha movido.
   *
   * Se mide en dos ventanas, y no sólo en la ancha: en un teléfono el motivo ocupa
   * dos renglones y los dos mandos no caben en la misma fila, así que la reserva de
   * la hoja es otra. Medido a 360 px, con la reserva de la ventana ancha, la fila de
   * mandos crecía 64 px al aparecer el botón de reproducir.
   */
  test('el titular y la marquesina no se mueven mientras llegan los datos', async ({ page }) => {
    await page.route('**/api/recommendations**', async (ruta) => {
      await pausa(1200)
      await ruta.continue()
    })
    await page.route('**/api/anime/**', async (ruta) => {
      await pausa(2400)
      await ruta.continue()
    })

    for (const ancho of [1280, 360]) {
      await page.setViewportSize({ width: ancho, height: 760 })

      await page.goto(`${BASE}/`)
      await page.waitForSelector('.marquesina__esqueleto', { timeout: 15_000 })
      // La letra de la casa, ya cambiada: el intercambio de la del sistema por la
      // nuestra mueve el titular por su cuenta y lo que se mide aquí es la ficha.
      await page.evaluate(async () => {
        await document.fonts.ready
      })
      // Y la entrada de la vitrina, que desplaza el bloque entero seis píxeles
      // mientras entra. Medida a mitad, la primera versión de esta prueba daba tres
      // píxeles de diferencia que eran de la animación y no de los datos.
      await esperarLaEntrada(page)

      const antes = await cajaDeLaMarquesina(page)
      await expect(page.locator('.marquesina__esqueleto')).toBeVisible()

      // La recomendación: cambia el destacado y aparece el motivo.
      await expect(page.locator('.marquesina__motivo')).not.toBeEmpty()

      const conRecomendacion = await cajaDeLaMarquesina(page)
      await expect(page.locator('.marquesina__sinopsis')).toBeVisible({ timeout: 15_000 })

      const conFicha = await cajaDeLaMarquesina(page)

      for (const [momento, caja] of [
        ['con la recomendación', conRecomendacion],
        ['con la ficha', conFicha],
      ] as const) {
        expect(caja, `en ${ancho} px el titular se movió ${momento}`).toEqual(antes)
      }
    }
  })

  /**
   * El campo es el banner de la obra, y con él se da la vuelta la tinta.
   *
   * Lo que se mide aquí no se puede medir en un `renderToString`: la sonda lee los
   * píxeles del banner en un lienzo, decide su tono y la marquesina cambia su tinta
   * —y su velo— antes de pintar la imagen. Con una sola respuesta de dobles, el
   * enriquecimiento y la imagen se sirven desde la prueba, que es la única forma de
   * tener un banner de un tono conocido sin salir a la red.
   */
  const BANNER = '/api/anilist/image/banner/101922'

  /**
   * Un banner partido en dos mitades, y por qué partido.
   *
   * Con una imagen de un solo color, la medida saldría igual mirando la columna del
   * texto que la imagen entera, y la prueba pasaría sin comprobar nada. Partida,
   * cada mitad pide una tinta distinta: la clara a la izquierda —donde vive el
   * texto— tiene que dar la tinta oscura, y la oscura a la izquierda la crema. Si la
   * sonda mirara la imagen entera, las dos darían el mismo tono —el medio, que cae
   * del lado oscuro— y la segunda mitad fallaría.
   */
  async function conBannerPartido(page: Page, izquierda: 'blanco' | 'negro'): Promise<void> {
    const mitad = izquierda === 'blanco' ? '#ffffff' : '#000000'
    const otra = izquierda === 'blanco' ? '#000000' : '#ffffff'

    await page.route('**/api/anime/*/*/enrichment', async (ruta) => {
      await ruta.fulfill({
        json: {
          enrichment: {
            anilistId: 101922,
            cover: '/api/anilist/image/cover/101922',
            adult: false,
            banner: BANNER,
            genres: [],
            studios: [],
            siteUrl: 'https://anilist.co/anime/101922',
          },
        },
      })
    })

    // Una imagen de verdad y de tamaño propio: la sonda necesita píxeles que leer,
    // y `naturalWidth` para recortar la columna del texto.
    await page.route('**/api/anilist/image/banner/**', async (ruta) => {
      await ruta.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80"><rect width="160" height="80" fill="${mitad}"/><rect x="160" width="160" height="80" fill="${otra}"/></svg>`,
      })
    })

    await entrar(page)
    await expect(page.locator('.marquesina__banner')).toBeVisible({ timeout: 15_000 })
  }

  /** La tinta del titular, tal y como la pinta el navegador. */
  async function tintaDelTitular(page: Page): Promise<string> {
    return page.locator('.marquesina__titulo').evaluate((nodo) => getComputedStyle(nodo).color)
  }

  test('un banner claro a la izquierda pide la tinta oscura', async ({ page }) => {
    await conBannerPartido(page, 'blanco')

    await expect(page.locator('.marquesina__banner')).toHaveAttribute('src', BANNER)
    await expect(page.locator('.marquesina')).toHaveAttribute('data-tinta', 'oscura')
    expect(await tintaDelTitular(page)).toBe('rgb(8, 8, 10)')
  })

  test('un banner oscuro a la izquierda deja la tinta crema', async ({ page }) => {
    await conBannerPartido(page, 'negro')

    await expect(page.locator('.marquesina')).toHaveAttribute('data-tinta', 'clara')
    expect(await tintaDelTitular(page)).toBe('rgb(245, 240, 230)')
  })

  /**
   * Sin banner no hay atributo y el campo se queda con su degradado.
   *
   * Es el caso de una obra que AniList no conoce —y el de antes de este trabajo—:
   * la marquesina se pinta igual, con la tinta de siempre.
   */
  test('sin banner el campo es el degradado y la tinta no cambia', async ({ page }) => {
    await page.route('**/api/anime/*/*/enrichment', async (ruta) => {
      await ruta.fulfill({ json: { enrichment: null } })
    })

    await entrar(page)

    await expect(page.locator('.marquesina__titulo')).toBeVisible()
    await expect(page.locator('.marquesina__banner')).toHaveCount(0)
    // Sin banner no hay atributo: el campo es el degradado y la tinta, la de siempre.
    await expect(page.locator('.marquesina[data-tinta]')).toHaveCount(0)
    expect(await tintaDelTitular(page)).toBe('rgb(245, 240, 230)')
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

  function elTop(page: Page) {
    return page.locator('.seccion', {
      has: page.getByRole('heading', { name: 'Top', exact: true }),
    })
  }

  test('la mitad vive en la dirección y cambia lo que se enseña', async ({ page }) => {
    await entrar(page)

    // El mando, dentro de la cabecera: es donde vive desde que dejó la franja que
    // tenía encima de la marquesina.
    await expect(page.locator('.shell__header .conmutador')).toHaveCount(1)

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
   * El mando en una ventana estrecha: la cabecera envuelve y el carril cabe dentro.
   *
   * El mando mide lo que el resto de mandos de la interfaz —44 px— y su carril 54:
   * no cabe en la misma línea que la marca y el menú, así que la cabecera envuelve
   * y el conmutador baja a su propio renglón. Se mide que no haya desplazamiento
   * horizontal, que el mando siga siendo pulsable y que **no asome** por arriba:
   * la cabecera está pegada al borde de la ventana, así que un carril que la
   * desborde se recorta contra ese borde y la píldora pierde su línea de arriba.
   */
  test('en 360 px la cabecera envuelve y el carril no se sale de ella', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 })
    await entrar(page)

    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )

    expect(desborde).toBeLessThanOrEqual(0)

    const cabecera = await page.locator('.shell__header').boundingBox()
    const carril = await page.locator('.shell__header .conmutador').boundingBox()
    const opcion = await page
      .locator('.conmutador')
      .getByRole('link', { name: 'Anime' })
      .boundingBox()

    expect(opcion?.height ?? 0).toBeGreaterThanOrEqual(44)
    expect(carril?.y ?? -1).toBeGreaterThanOrEqual(0)
    expect(carril?.y ?? 0).toBeGreaterThan(cabecera?.y ?? -1)
    expect((carril?.y ?? 0) + (carril?.height ?? 0)).toBeLessThanOrEqual(
      (cabecera?.y ?? 0) + (cabecera?.height ?? 0),
    )
  })
})
