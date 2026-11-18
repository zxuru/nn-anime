/**
 * Los saltos de intro y ending, en un navegador de verdad.
 *
 * Las dos lecturas se contestan desde la prueba con `page.route`: lo que se mide
 * es la interfaz —el botón, el salto y las marcas de la barra— y no el servidor ni
 * la red del tercero, que no está en el arnés. La ficha y el detalle sí son los
 * del arnés, y por eso el orden real de peticiones se mantiene —la ficha cachea el
 * enriquecimiento, que es lo que el hook espera para pedirlo—.
 *
 * El video es el WAV de un minuto del arnés, así que un intervalo de 5 a 20 s
 * cabe entero y el salto se puede medir en `currentTime`.
 */

import { expect, type Page, type Route, test } from '@playwright/test'
import { entrar } from './fixtures'

/**
 * El enriquecimiento del título: lo mínimo que valida `enrichmentResponseSchema`
 * —estricto— con un `anilistId` con el que pedir los saltos.
 */
const ENRIQUECIMIENTO = {
  enrichment: {
    anilistId: 555,
    cover: '/api/anilist/image/cover/555',
    genres: ['Misterio', 'Fantasía'],
    adult: false,
    siteUrl: 'https://anilist.co/anime/555',
    studios: ['Estudio Cobre'],
  },
}

/** Un opening al principio y un ending al final: dos marcas en la barra. */
const INTERVALOS = [
  { type: 'op', start: 5, end: 20 },
  { type: 'ed', start: 40, end: 55 },
]

/** La dirección del episodio que se mira en todas las pruebas. */
const EPISODIO = '/watch/fixture/aurora-nocturna%233?anime=aurora-nocturna'

/** Lo que las rutas interceptadas contestaron, para contar peticiones. */
interface Recuento {
  readonly enriquecimiento: () => number
  readonly saltos: () => number
  /**
   * Vuelve a cero los contadores.
   *
   * La vitrina de la home también pide el enriquecimiento del destacado —que es
   * la misma ruta—, y `entrar` pasa por ella antes de abrir el episodio. Contar
   * desde la home mediría las peticiones de otra pantalla; se reinicia justo
   * antes de la navegación que se mide.
   */
  readonly reiniciar: () => void
}

/**
 * Intercepta las dos lecturas y las contesta.
 *
 * El enriquecimiento se intercepta **sin** esperar a la base local: la prueba no
 * necesita el orden de la caché, sino medir que la interfaz pide una sola vez y
 * que el botón aparece cuando llegan los intervalos. La ruta exacta del detalle
 * (`/api/anime/fixture/aurora-nocturna`) sigue saliendo del arnés.
 */
async function interceptar(page: Page, intervalos: readonly unknown[]): Promise<Recuento> {
  let enriquecimiento = 0
  let saltos = 0

  await page.route('**/api/anime/*/*/enrichment', async (ruta: Route) => {
    enriquecimiento += 1
    await ruta.fulfill({ status: 200, json: ENRIQUECIMIENTO })
  })

  await page.route('**/api/skip-times/**', async (ruta: Route) => {
    saltos += 1
    await ruta.fulfill({ status: 200, json: intervalos })
  })

  return {
    enriquecimiento: () => enriquecimiento,
    saltos: () => saltos,
    reiniciar: () => {
      enriquecimiento = 0
      saltos = 0
    },
  }
}

/** Espera a que el reproductor haya traído metadatos y se pueda saltar. */
async function esperarReproductor(page: Page): Promise<void> {
  await expect(page.locator('.player__seek .player__range')).toBeEnabled({ timeout: 15_000 })
  await expect(page.locator('video')).toBeVisible()
}

/** El segundo en el que va el elemento. */
async function segundoDe(page: Page): Promise<number> {
  return await page.locator('video').evaluate((elemento: HTMLVideoElement) => elemento.currentTime)
}

/** Deja la reproducción dentro del opening, en el segundo 6. */
async function ponerseDentroDelOpening(page: Page): Promise<void> {
  await page.locator('video').evaluate((elemento: HTMLVideoElement) => {
    elemento.currentTime = 6
  })
}

test.describe('los saltos', () => {
  /**
   * El botón, con su etiqueta y sus marcas.
   *
   * Se comprueba además el orden de las peticiones: el enriquecimiento se pide
   * **después** de que la ficha haya respondido —es la que la cachea— y los
   * saltos después, cuando ya se conoce la duración. Una sola vez cada una.
   */
  test('el botón salta al final del intervalo y pide los datos en orden', async ({ page }) => {
    const orden: string[] = []

    page.on('request', (peticion) => {
      const url = new URL(peticion.url())

      if (url.pathname === '/api/anime/fixture/aurora-nocturna') orden.push('ficha')
      if (url.pathname.endsWith('/enrichment')) orden.push('enriquecimiento')
      if (url.pathname.startsWith('/api/skip-times/')) orden.push('saltos')
    })

    const recuento = await interceptar(page, INTERVALOS)

    await entrar(page)
    // La home pide el enriquecimiento del destacado por la misma ruta: lo que se
    // mide es la ficha del episodio que se abre, no lo que pidió la vitrina.
    recuento.reiniciar()
    orden.length = 0
    await page.goto(EPISODIO)
    await esperarReproductor(page)
    await ponerseDentroDelOpening(page)

    const boton = page.locator('.player__skip')
    await expect(boton).toBeVisible({ timeout: 10_000 })
    await expect(boton).toHaveText('Saltar intro')
    // El mando declara el atajo que lo dispara.
    await expect(boton).toHaveAttribute('aria-keyshortcuts', 'S')

    // El botón se apoya por encima de la banda entera. Su caja no puede
    // solaparse con el carril: con el alto calculado a ojo caía justo encima de
    // la barra de progreso, que es lo que se está midiendo aquí.
    const cajaBoton = await boton.boundingBox()
    const cajaCarril = await page.locator('.player__seek').boundingBox()

    expect(cajaBoton, 'el botón no tiene caja').not.toBeNull()
    expect(cajaCarril, 'el carril no tiene caja').not.toBeNull()
    expect((cajaBoton?.y ?? 0) + (cajaBoton?.height ?? 0)).toBeLessThan(cajaCarril?.y ?? 0)

    // Los dos intervalos están marcados en la barra de progreso.
    await expect(page.locator('.player__skip-marker')).toHaveCount(2)

    await boton.click()

    await expect
      .poll(async () => await segundoDe(page), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(19.9)
    // Al salir del intervalo, el botón deja de ofrecerse.
    await expect(boton).toHaveCount(0)

    expect(recuento.enriquecimiento()).toBe(1)
    expect(recuento.saltos()).toBe(1)

    const deLaFicha = orden.indexOf('ficha')
    const delEnriquecimiento = orden.indexOf('enriquecimiento')
    const deLosSaltos = orden.indexOf('saltos')

    expect(deLaFicha, 'la ficha no se pidió').toBeGreaterThanOrEqual(0)
    expect(delEnriquecimiento, 'el enriquecimiento no se pidió').toBeGreaterThan(deLaFicha)
    expect(deLosSaltos, 'los saltos no se pidieron').toBeGreaterThan(delEnriquecimiento)
  })

  /** El atajo hace el mismo salto que el botón: una sola función detrás. */
  test('la tecla S salta el intervalo', async ({ page }) => {
    await interceptar(page, INTERVALOS)

    await entrar(page)
    await page.goto(EPISODIO)
    await esperarReproductor(page)
    await ponerseDentroDelOpening(page)

    await expect(page.locator('.player__skip')).toBeVisible({ timeout: 10_000 })

    await page.keyboard.press('s')

    await expect
      .poll(async () => await segundoDe(page), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(19.9)
    await expect(page.locator('.player__skip')).toHaveCount(0)
  })

  /**
   * El salto automático, una sola vez.
   *
   * Se enciende desde el almacén del navegador —es la preferencia que guarda
   * `/settings`— y se entra en el intervalo. El primer paso salta solo; al
   * volver al intervalo, el botón se ofrece otra vez pero la reproducción no se
   * mueve sola: la marca de «ya saltado» lleva el episodio y el intervalo.
   */
  test('el salto automático ocurre una sola vez aunque se vuelva al intervalo', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('rona:skipAuto', 'si')
    })
    await interceptar(page, INTERVALOS)

    await entrar(page)
    await page.goto(EPISODIO)
    await esperarReproductor(page)
    await ponerseDentroDelOpening(page)

    await expect
      .poll(async () => await segundoDe(page), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(19.9)

    // Se sale del intervalo antes de volver: el botón se retira al salir y la
    // marca de «ya saltado» se borra en ese momento. Volver a entrar después es
    // el caso que mide que el salto automático no se repite. Se espera a que la
    // barra diga 30 —la posición ya pintada— antes de volver.
    await page.locator('video').evaluate((elemento: HTMLVideoElement) => {
      elemento.currentTime = 30
    })
    await expect
      .poll(async () => Number(await page.locator('.player__seek .player__range').inputValue()), {
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(29.9)

    await ponerseDentroDelOpening(page)
    await expect(page.locator('.player__skip')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(700)

    expect(await segundoDe(page)).toBeLessThan(7)
  })

  /**
   * A pantalla completa, que es donde el botón no puede quedarse fuera.
   *
   * La pantalla completa se pide sobre el marco y no sobre el `<video>`: si se
   * pidiera sobre el elemento de video, este botón —hermano suyo dentro del
   * marco— no se vería.
   */
  test('el botón se ve y salta a pantalla completa', async ({ page }) => {
    await interceptar(page, INTERVALOS)

    await entrar(page)
    await page.goto(EPISODIO)
    await esperarReproductor(page)

    await page.getByRole('button', { name: 'Pantalla completa' }).click()
    await expect
      .poll(async () => await page.evaluate(() => document.fullscreenElement !== null))
      .toBe(true)

    await ponerseDentroDelOpening(page)

    const boton = page.locator('.player__skip')
    await expect(boton).toBeVisible({ timeout: 10_000 })
    await boton.click()

    await expect
      .poll(async () => await segundoDe(page), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(19.9)
  })

  /**
   * Sin datos, la pantalla queda exactamente como estaba.
   *
   * Es el caso normal: AniSkip sólo conoce una parte del catálogo. No hay botón,
   * no hay marcas en la barra y no hay errores en consola —una petición que
   * contesta vacío no se reintenta—.
   */
  test('sin intervalos no aparece nada y la consola queda limpia', async ({ page }) => {
    const errores: string[] = []

    page.on('pageerror', (error) => errores.push(error.message))
    page.on('console', (mensaje) => {
      // Los avisos de recurso son del navegador —una portada del fixture que no
      // existe, por ejemplo—, no de la aplicación: lo que se mide aquí es que
      // nuestro camino no escriba nada.
      if (mensaje.type() !== 'error') return
      if (mensaje.text().includes('Failed to load resource')) return
      // Chromium avisa por consola de que la CSP no declara `script-src`; es una
      // nota del navegador sobre la cabecera del servidor, no un error de la
      // interfaz, y aparece también sin tocarla.
      if (mensaje.text().includes("Note that 'script-src'")) return

      errores.push(mensaje.text())
    })

    const recuento = await interceptar(page, [])

    await entrar(page)
    await page.goto(EPISODIO)
    await esperarReproductor(page)

    // Se da tiempo a que la petición de saltos vuelva con la lista vacía.
    await page.waitForTimeout(1200)

    await expect(page.locator('.player__skip')).toHaveCount(0)
    await expect(page.locator('.player__skip-marker')).toHaveCount(0)
    await expect(page.locator('video')).toBeVisible()

    expect(recuento.saltos(), 'la respuesta vacía no se vuelve a pedir').toBeLessThanOrEqual(1)
    expect(errores).toEqual([])
  })
})
