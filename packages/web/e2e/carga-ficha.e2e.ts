/**
 * La carga de la ficha, en un navegador de verdad.
 *
 * La ficha pide ocho lecturas y tarda lo que tarden el proveedor y la red. Lo
 * que se mide aquí es lo que el renderizado de servidor no puede: que mientras
 * se espera haya un **esqueleto con la forma de la ficha** —y no una pantalla en
 * blanco ni un «cargando» que salta cuando llegan los datos—, que el esqueleto
 * no cambie de sitio al llegar el contenido, que una espera larga se anuncie, y
 * que un fallo y un «no está» digan cada uno lo suyo con los mandos que tocan.
 *
 * La respuesta del detalle se intercepta para poder elegir cuánto tarda y qué
 * contesta. Se intercepta **la ruta exacta**, con `$` al final, y no un patrón
 * comodín sobre todo `/api/anime/`: las subrutas —relacionados, fuentes, visto,
 * proveedores, enriquecimiento, metadatos— tienen que seguir contestando el
 * fixture real, o la ficha no cargaría entera y lo que se probaría sería otra
 * cosa.
 */

import { expect, type Page, type Route, test } from '@playwright/test'
import { entrar, esperarApp } from './fixtures'

/** La ficha del fixture: doce episodios, una portada y una sinopsis. */
const FICHA = '/anime/fixture/aurora-nocturna'

/**
 * El detalle que contesta el proveedor.
 *
 * Es el cuerpo que valida `animeDetailSchema` —estricto—: un campo de más o de
 * menos y la interfaz se quedaría en la pantalla de error con un mensaje que no
 * tiene nada que ver con lo que se está midiendo.
 */
const DETALLE = {
  ref: { providerId: 'fixture', value: 'aurora-nocturna' },
  title: 'Aurora Nocturna',
  year: 2019,
  kind: 'tv',
  status: 'finished',
  synopsis: 'Una cartógrafa descubre que el cielo de su ciudad se puede recorrer a pie.',
  genres: ['Misterio'],
  studios: ['Estudio Cobre'],
  episodeCount: 12,
}

/** Lo que contesta una ruta interceptada. */
interface Respuesta {
  readonly codigo: number
  readonly cuerpo: unknown
}

/**
 * La respuesta del detalle para una tarjeta concreta.
 *
 * La tarjeta de la home no siempre es la misma —las filas dependen del motor de
 * recomendación—, así que el título y la referencia salen del enlace que se va a
 * pulsar. Servir el detalle de otra obra haría que la prueba midiera una ficha
 * que no es la que se abrió.
 */
function detalleDe(href: string, titulo: string): unknown {
  const ref = decodeURIComponent(href.slice(href.lastIndexOf('/') + 1))

  return { ...DETALLE, ref: { providerId: 'fixture', value: ref }, title: titulo }
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms))
}

/**
 * El patrón que coincide con la lectura del detalle y con nada más.
 *
 * El `$` es la parte que importa: `/api/anime/fixture/aurora-nocturna/enrichment`
 * también empieza por la ruta del detalle, y con un patrón sin ancla la prueba
 * interceptaría el enriquecimiento creyendo interceptar la ficha.
 */
function patronDeDetalle(href: string): RegExp {
  const ruta = `/api${href}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return new RegExp(`${ruta}$`)
}

/**
 * Intercepta la lectura del detalle.
 *
 * `responder` se llama en cada petición y puede cambiar de opinión entre una y
 * otra: es lo que permite que el primer intento falle y el reintento cargue. La
 * demora se aplica después de contar la petición, así una respuesta lenta no
 * oculta que el cliente la pidió.
 */
async function interceptarDetalle(
  page: Page,
  href: string,
  responder: () => Respuesta,
  demoraMs = 0,
): Promise<number[]> {
  const peticiones: number[] = []

  await page.route(patronDeDetalle(href), async (ruta: Route) => {
    peticiones.push(Date.now())

    if (demoraMs > 0) await dormir(demoraMs)

    const { codigo, cuerpo } = responder()

    // Una visita que se abandonó cancela su petición; cuando la respuesta
    // retenida llega, el navegador ya no escucha. Fallar aquí sería convertir una
    // cancelación correcta en un fallo de la prueba.
    await ruta.fulfill({ status: codigo, json: cuerpo }).catch(() => undefined)
  })

  return peticiones
}

/**
 * Cuenta las peticiones del detalle **sin contestarlas**.
 *
 * Es lo que hace falta para la precarga: lo que se mide es que la petición salga
 * al pasar el puntero antes de pulsar, no qué contesta el servidor; la respuesta
 * la da el fixture de verdad con `continue()`.
 */
async function contarDetalle(page: Page, href: string): Promise<number[]> {
  const peticiones: number[] = []

  await page.route(patronDeDetalle(href), async (ruta: Route) => {
    peticiones.push(Date.now())
    await ruta.continue()
  })

  return peticiones
}

/** Un píxel transparente, para que una portada cargue sin salir a la red. */
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

/**
 * Sirve las portadas desde la prueba.
 *
 * El fixture apunta a `fixture.invalid`, que no resuelve: la imagen falla y
 * `Cover` la sustituye por un hueco. Para medir que la ficha pinta **la portada
 * real** del adelanto y no un bloque gris, la imagen tiene que cargar; el píxel
 * es el contenido mínimo que lo consigue sin salir a internet.
 */
async function servirPortadas(page: Page): Promise<void> {
  for (const patron of [/\/api\/cover\//, /\/api\/anilist\/image\//]) {
    await page.route(patron, async (ruta: Route) => {
      await ruta.fulfill({ body: PIXEL, contentType: 'image/gif' })
    })
  }
}

/**
 * La primera tarjeta de la home que lleva a una ficha.
 *
 * Se pide el enlace con su `href` y su `title` porque la prueba necesita los dos:
 * el `href` para saber qué lectura interceptar y el título para comprobar que el
 * adelanto que pinta la ficha es el de la tarjeta que se pulsó.
 */
async function primeraTarjetaDeFicha(page: Page): Promise<{ href: string; titulo: string }> {
  const enlace = page.locator('a.pz__enlace[href^="/anime/fixture/"]').first()

  await expect(enlace).toBeVisible({ timeout: 15_000 })

  const href = await enlace.getAttribute('href')
  const titulo = await enlace.getAttribute('title')

  if (href === null || titulo === null || titulo.trim() === '') {
    throw new Error('la tarjeta de la home no tiene href o título con los que navegar')
  }

  return { href, titulo }
}

/**
 * Dos tarjetas distintas que llevan a fichas distintas.
 *
 * La prueba de navegación rápida necesita abrir una ficha, abandonarla antes de
 * que conteste y abrir **otra**: la respuesta vieja sólo se puede cruzar si la
 * nueva ficha no es la misma. Se devuelven sólo las referencias únicas.
 */
async function dosTarjetasDeFicha(
  page: Page,
): Promise<[{ href: string; titulo: string }, { href: string; titulo: string }]> {
  const enlaces = page.locator('a.pz__enlace[href^="/anime/fixture/"]')

  await expect(enlaces.first()).toBeVisible({ timeout: 15_000 })

  const leidos = await enlaces.evaluateAll((nodos) =>
    nodos.map((nodo) => ({
      href: nodo.getAttribute('href') ?? '',
      titulo: nodo.getAttribute('title') ?? '',
    })),
  )
  const unicos = new Map<string, { href: string; titulo: string }>()

  for (const leido of leidos) {
    if (leido.href !== '' && leido.titulo.trim() !== '') unicos.set(leido.href, leido)
  }

  const [primera, segunda] = [...unicos.values()]

  if (primera === undefined || segunda === undefined) {
    throw new Error('la home no tiene dos fichas distintas con las que cruzar estados')
  }

  return [primera, segunda]
}

/** La caja de un elemento, con un error claro si todavía no está pintado. */
async function cajaDe(
  page: Page,
  selector: string,
): Promise<{ readonly x: number; readonly y: number; readonly width: number }> {
  const caja = await page.locator(selector).first().boundingBox()

  if (caja === null) throw new Error(`no hay caja para ${selector}`)

  return caja
}

/** Lo que la página desborda a lo ancho: cero o negativo es que no desborda. */
async function desborde(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

test.describe('la carga de la ficha', () => {
  /**
   * Una respuesta lenta: el esqueleto ocupa el sitio de la ficha y el contenido
   * no lo mueve.
   *
   * El salto de layout es el fallo que se ve incluso cuando todo carga: el
   * esqueleto tiene que reservar la misma caja que el contenido real, o la
   * portada salta de sitio al llegar los datos. Se mide la caja antes y después,
   * no con una captura: un número es lo que se puede exigir.
   */
  test('una respuesta lenta enseña el esqueleto y luego la ficha, sin saltar', async ({ page }) => {
    await entrar(page)
    await interceptarDetalle(page, FICHA, () => ({ codigo: 200, cuerpo: DETALLE }), 1_500)

    await page.goto(FICHA)

    const esqueleto = page.locator('article.detail.detalle-esqueleto')

    await expect(esqueleto).toBeVisible()
    await expect(esqueleto).toHaveAttribute('aria-busy', 'true')
    await expect(esqueleto.locator('.skeleton').first()).toBeVisible()
    // El estado se anuncia: quien no ve la pantalla tiene que oír que carga.
    await expect(esqueleto.getByRole('status')).toContainText('Cargando la ficha…')

    const portadaAntes = await cajaDe(page, '.detalle-esqueleto__portada')

    const titular = page.locator('.detail__banner h1')

    await expect(titular).toHaveText('Aurora Nocturna', { timeout: 15_000 })
    await expect(page.locator('.detail__cuerpo')).toBeVisible()
    // El hueco desaparece cuando llegan los datos: no quedan dos portadas.
    await expect(page.locator('.detalle-esqueleto__portada')).toHaveCount(0)

    const portadaDespues = await cajaDe(page, '.detail__cover')

    expect(Math.abs(portadaDespues.x - portadaAntes.x)).toBeLessThanOrEqual(2)
    expect(Math.abs(portadaDespues.y - portadaAntes.y)).toBeLessThanOrEqual(2)
    expect(Math.abs(portadaDespues.width - portadaAntes.width)).toBeLessThanOrEqual(2)
  })

  /**
   * Una respuesta muy lenta: a los ocho segundos la pantalla lo dice.
   *
   * Sin el aviso, una espera larga es indistinguible de una pantalla colgada, y
   * el usuario recarga antes de que la ficha llegue. Lo que se mide es que el
   * aviso aparece **antes** que los datos: si llegara con el contenido, no avisaría
   * de nada.
   */
  test('a los ocho segundos avisa de que está tardando', async ({ page }) => {
    // La respuesta tarda nueve segundos y el aviso se espera a los ocho: el
    // margen del test por defecto no llega.
    test.setTimeout(45_000)

    await entrar(page)
    await interceptarDetalle(page, FICHA, () => ({ codigo: 200, cuerpo: DETALLE }), 9_000)

    await page.goto(FICHA)

    const aviso = page.locator('.detalle-esqueleto__aviso')

    await expect(aviso).toBeVisible({ timeout: 15_000 })
    await expect(aviso).toContainText('Está tardando más de lo normal…')
    // Todavía no hay ficha: el aviso llega mientras se espera, no después. Se
    // mira la sinopsis y no `.detail__cuerpo`, que también es la caja del
    // esqueleto y por eso no distingue una cosa de la otra.
    await expect(page.locator('.detail__synopsis')).toHaveCount(0)

    await expect(page.locator('.detail__banner h1')).toHaveText('Aurora Nocturna', {
      timeout: 15_000,
    })
    await expect(aviso).toHaveCount(0)
  })

  /**
   * Un 500: se dice qué pasó, con el proveedor y con los dos mandos.
   *
   * El reintento tiene que ser un botón de verdad: recargar la página es lo que
   * el spec prohíbe. El foco se deja en «Reintentar» porque es la acción que
   * arregla el caso, y quien navega con el teclado no debería buscarla.
   */
  test('un 500 explica el fallo, deja el foco en Reintentar y el reintento carga', async ({
    page,
  }) => {
    await entrar(page)

    // La primera lectura falla y el reintento ya encuentra al proveedor bien.
    let fallando = true

    await interceptarDetalle(page, FICHA, () =>
      fallando
        ? { codigo: 500, cuerpo: { error: 'el proveedor falló' } }
        : { codigo: 200, cuerpo: DETALLE },
    )

    await page.goto(FICHA)

    const fallo = page.locator('article.detail__estado [role="alert"].detalle-fallo')

    await expect(fallo).toBeVisible({ timeout: 15_000 })
    await expect(fallo).toContainText('No se pudo cargar la ficha')
    await expect(fallo).toContainText('Proveedor: fixture')

    const reintentar = fallo.getByRole('button', { name: 'Reintentar' })

    await expect(reintentar).toBeVisible()
    await expect(fallo.getByRole('button', { name: 'Volver' })).toBeVisible()
    await expect(reintentar).toBeFocused()

    fallando = false
    await reintentar.click()

    await expect(page.locator('.detail__banner h1')).toHaveText('Aurora Nocturna', {
      timeout: 15_000,
    })
    await expect(fallo).toHaveCount(0)
  })

  /**
   * Un 404 no es un fallo: el proveedor contestó que ese título no está.
   *
   * Ofrecer «Reintentar» ahí manda al usuario a repetir una pregunta cuya
   * respuesta ya tiene. Se queda el «Volver» y se dice lo que pasa.
   */
  test('un 404 dice que no está y no ofrece reintentar', async ({ page }) => {
    await entrar(page)
    await interceptarDetalle(page, FICHA, () => ({
      codigo: 404,
      cuerpo: { error: 'el proveedor no conoce esa referencia' },
    }))

    await page.goto(FICHA)

    const fallo = page.locator('article.detail__estado [role="alert"].detalle-fallo')

    await expect(fallo).toBeVisible({ timeout: 15_000 })
    await expect(fallo).toContainText('No se encontró la ficha')
    await expect(fallo).toContainText('Ese título no está en el proveedor.')
    await expect(fallo.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
    await expect(fallo.getByRole('button', { name: 'Volver' })).toBeVisible()
  })

  /**
   * Abrir desde una tarjeta: los datos que la tarjeta ya tenía se pintan ya.
   *
   * Pulsar una tarjeta y ver un esqueleto vacío durante un segundo es perder lo
   * que el usuario tenía delante. El título y la portada viajan con la
   * navegación y la ficha los enseña mientras pide el resto.
   */
  test('al abrir desde una tarjeta el título y la portada se ven antes de los datos', async ({
    page,
  }) => {
    await entrar(page)
    await esperarApp(page)

    const { href, titulo } = await primeraTarjetaDeFicha(page)
    const peticiones = await interceptarDetalle(
      page,
      href,
      () => ({ codigo: 200, cuerpo: detalleDe(href, titulo) }),
      1_500,
    )

    // La portada llega de la tarjeta, pero su imagen apunta al proveedor: se
    // sirve desde la prueba para que el `<img>` exista de verdad mientras dura
    // la espera, que es lo que se quiere medir.
    await servirPortadas(page)

    await page.locator(`a.pz__enlace[href="${href}"]`).first().click()

    const esqueleto = page.locator('article.detail.detalle-esqueleto')

    await expect(esqueleto).toBeVisible()
    // El adelanto de la tarjeta: el titular de verdad, no un bloque gris.
    await expect(page.getByRole('heading', { level: 1, name: titulo })).toBeVisible()

    const portada = page.locator('img.detalle-esqueleto__portada')

    await expect(portada).toBeVisible()
    // Y es la portada de la ficha, no cualquier imagen: la que viajó con la
    // tarjeta, servida por el proxy.
    await expect(portada).toHaveAttribute('src', /^\/(?:api\/cover|api\/anilist\/image)\//)

    // La lectura sale de verdad; si no, el adelanto podría venir de cualquier
    // sitio y la prueba no estaría midiendo la navegación.
    await expect.poll(() => peticiones.length, { timeout: 5_000 }).toBeGreaterThan(0)

    await expect(page.locator('.detail__banner h1')).toHaveText(titulo, { timeout: 15_000 })
    await expect(esqueleto).toHaveCount(0)
  })

  /**
   * Pasar el puntero por una tarjeta pide la ficha antes del clic.
   *
   * El tiempo que se tarda en pulsar es tiempo que el proveedor puede ir
   * contestando. La precarga se retrasa lo justo para que cruzar la pantalla no
   * dispare una petición por cada tarjeta: se mide que el puntero quieto sí la
   * dispara y que el clic todavía no ha navegado.
   */
  test('el puntero sobre una tarjeta precarga la ficha antes del clic', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)

    const { href } = await primeraTarjetaDeFicha(page)
    const peticiones = await contarDetalle(page, href)

    // Se espera a que la home termine de pedir lo suyo: así cualquier petición
    // que aparezca después es de la precarga y no de la propia vitrina.
    await page.waitForLoadState('networkidle')
    const antes = peticiones.length

    await page.locator(`a.pz__enlace[href="${href}"]`).first().hover()

    await expect.poll(() => peticiones.length, { timeout: 5_000 }).toBeGreaterThan(antes)
    // Precargar no navega: el clic sigue siendo el que abre la ficha.
    await expect(page).toHaveURL(/\/$/)
  })

  /**
   * Una respuesta rápida no parpadea.
   *
   * El esqueleto existe en el marcado desde el primer fotograma para reservar la
   * forma, pero sus bloques están apagados hasta los 150 ms. La prueba mira el
   * **suceso de animación** del brillo y no una captura: con la respuesta rápida
   * el `shimmer` no llega a arrancar nunca, y con el umbral a cero arrancaría. Es
   * lo que distingue «no se vio nada» de «no hubo tiempo de verlo».
   */
  test('una respuesta de menos de 150 ms no enciende el esqueleto', async ({ page }) => {
    await page.addInitScript(() => {
      // Un marcador en el documento, para no inventar una propiedad en `window`:
      // si el brillo del esqueleto llega a arrancar, queda escrito aquí.
      document.addEventListener(
        'animationstart',
        (evento) => {
          const objetivo = evento.target

          if (
            evento.animationName === 'shimmer' &&
            objetivo instanceof Element &&
            objetivo.closest('.detalle-esqueleto') !== null
          ) {
            document.documentElement.dataset.brilloEsqueleto = 'si'
          }
        },
        true,
      )
    })

    await entrar(page)
    // Sin demora: la ficha contesta antes de que el esqueleto se encienda.
    await interceptarDetalle(page, FICHA, () => ({ codigo: 200, cuerpo: DETALLE }))

    await page.goto(FICHA)

    await expect(page.locator('.detail__banner h1')).toHaveText('Aurora Nocturna', {
      timeout: 15_000,
    })

    expect(
      await page.evaluate(() => document.documentElement.dataset.brilloEsqueleto ?? 'no'),
    ).toBe('no')
  })

  /**
   * El reloj duro de la ficha: a los veinte segundos se deja de esperar.
   *
   * Sin el tope, una lectura colgada deja el esqueleto para siempre y el usuario
   * recarga. La respuesta se retiene veintiún segundos y a los veinte la pantalla
   * ya tiene que estar en la tarjeta de error con su reintento.
   */
  test('a los veinte segundos corta y ofrece reintentar', async ({ page }) => {
    test.setTimeout(50_000)

    await entrar(page)
    const peticiones = await interceptarDetalle(
      page,
      FICHA,
      () => ({ codigo: 200, cuerpo: DETALLE }),
      21_000,
    )

    await page.goto(FICHA)

    const fallo = page.locator('article.detail__estado [role="alert"].detalle-fallo')

    // El tope es de veinte segundos: el margen del `expect` cubre el arranque.
    await expect(fallo).toBeVisible({ timeout: 25_000 })
    await expect(fallo).toContainText('No se pudo cargar la ficha')
    await expect(fallo.getByRole('button', { name: 'Reintentar' })).toBeVisible()

    // La lectura se pidió una vez y el reloj la cortó; la respuesta retenida no
    // puede resucitar la pantalla después del error.
    expect(peticiones.length).toBeGreaterThan(0)
    await page.waitForTimeout(2_000)
    await expect(fallo).toBeVisible()
  })

  /**
   * Navegar rápido entre fichas no deja estados cruzados.
   *
   * La primera ficha tarda; antes de que conteste se sale a la home y se abre
   * otra. La respuesta vieja no puede pintar el título de la anterior ni un error,
   * y la consola no puede quedarse con una excepción de una promesa cancelada.
   */
  test('ir y volver entre fichas no cruza estados ni ensucia la consola', async ({ page }) => {
    const errores: string[] = []

    page.on('pageerror', (error) => errores.push(error.message))
    page.on('console', (mensaje) => {
      // Los 502 de `fixture.invalid` son portadas que no resuelven y son parte del
      // arnés, no de la aplicación: se descartan. Lo que se busca es una excepción
      // de una promesa cancelada o un `setState` tras desmontar, que sí es un
      // error de la aplicación.
      if (
        mensaje.type() === 'error' &&
        !mensaje.text().includes('Failed to load resource') &&
        // Aviso del navegador sobre la CSP del arnés, no de la aplicación.
        !mensaje.text().includes("Note that 'script-src'")
      ) {
        errores.push(mensaje.text())
      }
    })

    await entrar(page)
    await esperarApp(page)

    const [primera, segunda] = await dosTarjetasDeFicha(page)

    /*
      Un solo interceptor para las dos fichas: la primera tarda seis segundos y la
      segunda contesta al momento. Así la respuesta de la primera llega cuando la
      segunda ya está montada, que es la carrera que hay que medir.
    */
    await page.route(/\/api\/anime\/fixture\/[^/]+$/, async (ruta) => {
      // `camino` es la ruta de la API; el enlace de la tarjeta es la de la ficha.
      const camino = new URL(ruta.request().url()).pathname
      const esPrimera = camino === `/api${primera.href}`

      if (esPrimera) await dormir(6_000)

      const ref = decodeURIComponent(camino.slice(camino.lastIndexOf('/') + 1))

      await ruta
        .fulfill({
          json: {
            ...DETALLE,
            ref: { providerId: 'fixture', value: ref },
            title: esPrimera ? 'Ficha lenta' : 'Ficha rápida',
          },
        })
        .catch(() => undefined)
    })

    await page.locator(`a.pz__enlace[href="${primera.href}"]`).first().click()
    await expect(page.locator('article.detail.detalle-esqueleto')).toBeVisible()

    // Salir antes de que conteste y abrir otra ficha: la respuesta vieja llega
    // cuando la nueva ya está en pantalla.
    await page.locator('.shell__brand').click()
    await expect(page.locator('a.pz__enlace').first()).toBeVisible({ timeout: 15_000 })
    await page.locator(`a.pz__enlace[href="${segunda.href}"]`).first().click()

    await expect(page.locator('.detail__banner h1')).toHaveText('Ficha rápida', {
      timeout: 15_000,
    })
    await expect(page.locator('article.detail__estado')).toHaveCount(0)

    // Se espera a que llegue la respuesta retenida de la primera visita. Tiene que
    // morir en una petición cancelada: ni cambia el título ni deja una excepción.
    await page.waitForTimeout(7_000)
    await expect(page.locator('.detail__banner h1')).toHaveText('Ficha rápida')
    expect(errores).toEqual([])
  })

  /**
   * Volver a una ficha ya cargada no espera al proveedor.
   *
   * La caché de la aplicación guarda la lectura completa, así que la segunda
   * visita pinta la ficha al instante aunque el proveedor tarde dos segundos. Se
   * mide `.detail__cuerpo` y no el `<h1>`: el titular también llega con el
   * adelanto de la tarjeta, así que no distingue una caché de una espera. El
   * refresco sigue saliendo por detrás —stale-while-revalidate—: la caché no
   * puede convertirse en un dato congelado.
   */
  test('volver a una ficha ya cargada la pinta de la caché y refresca detrás', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)

    const { href, titulo } = await primeraTarjetaDeFicha(page)
    const peticiones = await interceptarDetalle(
      page,
      href,
      () => ({ codigo: 200, cuerpo: detalleDe(href, titulo) }),
      2_000,
    )

    // Primera visita: el esqueleto aguanta la respuesta lenta y luego llega.
    await page.locator(`a.pz__enlace[href="${href}"]`).first().click()
    await expect(page.locator('.detail__cuerpo')).toBeVisible({ timeout: 15_000 })

    // Volver a la home sin recargar: el módulo de la caché sigue vivo. Un
    // `page.goto` recargaría la aplicación y borraría lo que se quiere medir.
    await page.locator('.shell__brand').click()

    const tarjeta = page.locator(`a.pz__enlace[href="${href}"]`).first()

    await expect(tarjeta).toBeVisible({ timeout: 15_000 })

    const inicio = Date.now()

    await tarjeta.click()

    // La respuesta interceptada tarda dos segundos: si la ficha aparece mucho
    // antes, salió de la caché y no de la red.
    await expect(page.locator('.detail__cuerpo')).toBeVisible({ timeout: 500 })
    expect(Date.now() - inicio).toBeLessThan(1_000)

    // Y el refresco se pide igual: la segunda visita no se conforma con lo viejo.
    await expect.poll(() => peticiones.length, { timeout: 5_000 }).toBeGreaterThanOrEqual(2)
  })
})

/**
 * Con `prefers-reduced-motion: reduce` el brillo del esqueleto se apaga.
 *
 * El movimiento continuo es justo lo que el ajuste del sistema pide quitar, y un
 * esqueleto que sigue barriendo lo incumple aunque no se mueva nada más.
 */
test.describe('la carga de la ficha con movimiento reducido', () => {
  test.use({ reducedMotion: 'reduce' })

  test('el esqueleto deja de brillar', async ({ page }) => {
    await entrar(page)
    await interceptarDetalle(page, FICHA, () => ({ codigo: 200, cuerpo: DETALLE }), 2_500)

    await page.goto(FICHA)

    const esqueleto = page.locator('article.detail.detalle-esqueleto')

    await expect(esqueleto).toBeVisible()

    const brillo = esqueleto.locator('.skeleton').first()

    await expect(brillo).toBeVisible()

    const animacion = await brillo.evaluate((nodo) => getComputedStyle(nodo).animationName)

    expect(animacion).toBe('none')

    // Y la ficha llega igual: quitar el brillo no puede dejar la pantalla a medias.
    await expect(page.locator('.detail__banner h1')).toHaveText('Aurora Nocturna', {
      timeout: 15_000,
    })
  })
})

/**
 * La ficha en un teléfono.
 *
 * A 390 px la rejilla de la ficha cambia de forma —la portada pasa a cartel—, y
 * el esqueleto tiene que seguir esa misma rejilla: si sólo se probara en
 * escritorio, el móvil podría desbordar a lo ancho justo mientras carga, que es
 * cuando no hay contenido que empuje.
 */
test.describe('la carga de la ficha en el móvil', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('el esqueleto y la ficha no desbordan a lo ancho', async ({ page }) => {
    await entrar(page)
    await interceptarDetalle(page, FICHA, () => ({ codigo: 200, cuerpo: DETALLE }), 1_500)

    await page.goto(FICHA)

    const esqueleto = page.locator('article.detail.detalle-esqueleto')

    await expect(esqueleto).toBeVisible()
    await expect(esqueleto.locator('.skeleton').first()).toBeVisible()

    // Mientras carga.
    expect(await desborde(page)).toBeLessThanOrEqual(1)

    await expect(page.locator('.detail__banner h1')).toHaveText('Aurora Nocturna', {
      timeout: 15_000,
    })

    // Y con el contenido real, que es el estado que se queda.
    expect(await desborde(page)).toBeLessThanOrEqual(1)
  })

  test('el no encontrado tampoco desborda a lo ancho', async ({ page }) => {
    await entrar(page)
    await interceptarDetalle(page, FICHA, () => ({
      codigo: 404,
      cuerpo: { error: 'el proveedor no conoce esa referencia' },
    }))

    await page.goto(FICHA)

    const fallo = page.locator('article.detail__estado [role="alert"].detalle-fallo')

    await expect(fallo).toBeVisible({ timeout: 15_000 })
    await expect(fallo).toContainText('No se encontró la ficha')
    await expect(fallo.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
    await expect(fallo.getByRole('button', { name: 'Volver' })).toBeVisible()

    expect(await desborde(page)).toBeLessThanOrEqual(1)
  })
})
