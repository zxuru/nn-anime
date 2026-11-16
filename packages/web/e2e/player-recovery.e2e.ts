/**
 * El fallo de un fragmento a mitad de reproducción, y la recuperación.
 *
 * El caso real que persigue este archivo: a los pocos minutos de ver un HLS, el
 * proxy devuelve 403 en un fragmento —la firma caducó—, hls.js emite un
 * `fragLoadError` fatal y el reproductor se quedaba parado con el aviso delante.
 * Lo que se mide aquí es que se renueva la fuente sola, sin enseñar el error y
 * sin perder el segundo; y que si la renovación también falla, entonces sí se
 * avisa y el botón «Reintentar» reanuda donde iba.
 *
 * **Por qué hay un hls.js falso.** El Chromium que descarga Playwright no
 * decodifica H.264 ni AAC —son códecs con licencia y el build libre no los
 * trae—, así que un HLS de verdad no se puede ver en este navegador por muchos
 * segmentos válidos que se le sirvan. Y el ffmpeg que trae Playwright es un build
 * mínimo sólo VP9/WebM: tampoco puede fabricar un HLS que este Chromium
 * decodifique. Por eso el transporte y el medio se separan: el medio es el WAV
 * que `scripts/e2e-server.ts` ya sirve (el tiempo avanza de verdad) y el
 * transporte es `e2e/hls-falso.ts`, que imita la API pública de hls.js y emite el
 * mismo `ErrorData` que la biblioteca. El código de `usePlayer` y `attachHls` se
 * ejercita tal cual: lo único de mentira es por dónde viajan los fragmentos.
 *
 * El episodio marcador del arnés es `aurora-nocturna#7`: el plugin del e2e lo
 * declara `kind: 'hls'` y el resto siguen siendo archivos progresivos, para no
 * cambiar el camino que ya prueban los demás e2e.
 */

import { expect, type Locator, type Page, test } from '@playwright/test'
import { entrar } from './fixtures'

declare global {
  interface Window {
    /**
     * El gancho del hls falso, que sólo existe en el bundle del e2e. Sirve para
     * programar el fallo de un fragmento desde la prueba.
     */
    __nnAnimeE2E?: {
      readonly fallarFragmento: (codigo: number) => void
      readonly fragmentos: number
    }
  }
}

/** La pantalla del episodio que el arnés declara HLS. */
const EPISODIO_HLS = '/watch/fixture/aurora-nocturna%237'

/**
 * Las peticiones de fragmento del transporte falso.
 *
 * Cada una se atiende con 200 mientras la prueba no haya programado el fallo: el
 * medio real no depende de ellas, así que un 404 del proxy sólo ensuciaría la
 * medida. Cuando toca, la siguiente se responde 403 y se desarma sola.
 */
const FRAGMENTO = /\/stream\/[^/?]+\?frag=\d+$/

/** El tiempo del elemento, en segundos. */
async function tiempoDe(video: Locator): Promise<number> {
  return await video.evaluate((elemento: HTMLVideoElement) => elemento.currentTime)
}

/**
 * El aviso de error de reproducción, sin confundirlo con el del audio sin imagen.
 *
 * El arnés sirve un WAV —no hay vídeo que decodificar—, así que a partir del
 * segundo dos el reproductor enseña su aviso de «el audio suena y la imagen no
 * llega», que también vive en `.search__error`. Ese aviso es del medio del
 * arnés, no del fallo que se mide: se descarta por su texto, que es el único que
 * no habla de un fallo.
 */
function avisoDeReproduccion(page: Page): Locator {
  return page.locator('.search__error').filter({ hasNotText: 'El audio suena' })
}

/** Espera a que el transporte falso esté cargado y haya pedido su primer fragmento. */
async function esperarTransporte(page: Page): Promise<void> {
  await expect
    .poll(async () => await page.evaluate(() => window.__nnAnimeE2E?.fragmentos ?? 0), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0)
}

/**
 * Entra en el episodio y lo deja reproduciendo, silenciado.
 *
 * Silenciar no es un adorno de la prueba: sin audio activo, la política de
 * reproducción automática de Chromium sin pantalla no concede activación a un
 * clic sintético y el elemento se queda en el segundo cero. Es el mismo motivo
 * que documenta `player.e2e.ts`.
 */
async function reproducir(page: Page, video: Locator): Promise<void> {
  await expect(page.locator('.player__seek .player__range')).toBeEnabled({ timeout: 20_000 })

  await page.getByRole('button', { name: 'Silenciar' }).click()
  await page.getByRole('button', { name: 'Reproducir' }).click()

  // Más de dos segundos: el fallo tiene que llegar con reproducción de verdad
  // detrás, no en la carga, que es otro caso.
  await expect.poll(async () => await tiempoDe(video), { timeout: 20_000 }).toBeGreaterThan(2)
}

test.describe('recuperación de un fragmento caducado', () => {
  test('renueva la fuente sola y sigue en el mismo segundo, sin avisar', async ({ page }) => {
    await entrar(page)

    // La primera ráfaga de fragmentos se responde bien; el 403 se dispara desde
    // la prueba, no desde el arranque.
    let fragmentoArmado = false

    await page.route(FRAGMENTO, async (ruta) => {
      if (!fragmentoArmado) {
        await ruta.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'ok' })

        return
      }

      fragmentoArmado = false
      await ruta.fulfill({ status: 403, contentType: 'text/plain', body: 'Forbidden' })
    })

    await page.goto(EPISODIO_HLS)

    const video = page.locator('video')
    await expect(video).toHaveAttribute('src', /\/stream\//, { timeout: 20_000 })

    await reproducir(page, video)
    await esperarTransporte(page)

    const capturado = await tiempoDe(video)

    // La espera se pide antes de provocar el fallo: la renovación sale en cuanto
    // el módulo emite el error, y pedirla después se la perdería.
    const renovacion = page.waitForRequest(
      (solicitud) =>
        solicitud.url().includes('/api/stream/resolve') &&
        (solicitud.postData() ?? '').includes('"refresh":true'),
      { timeout: 20_000 },
    )

    fragmentoArmado = true
    await page.evaluate((codigo) => window.__nnAnimeE2E?.fallarFragmento(codigo), 403)

    // Lo primero: se pidió una fuente nueva, con el refresco forzado.
    await renovacion

    // Y el episodio sigue, en el mismo segundo —la búsqueda de metadatos de la
    // fuente nueva puede dejarlo un instante en cero, así que se pregunta hasta
    // que vuelva a la posición—.
    await expect
      .poll(async () => await tiempoDe(video), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(capturado - 1)

    expect(await video.evaluate((elemento: HTMLVideoElement) => elemento.paused)).toBe(false)

    // Y no se avisó al usuario: el fallo se resolvió por dentro. El aviso del
    // audio sin imagen se descarta aparte, ver `avisoDeReproduccion`.
    await expect(avisoDeReproduccion(page)).toHaveCount(0)
  })

  test('si la renovación también falla, avisa y «Reintentar» reanuda en el mismo segundo', async ({
    page,
  }) => {
    await entrar(page)

    let fragmentoArmado = false

    await page.route(FRAGMENTO, async (ruta) => {
      if (!fragmentoArmado) {
        await ruta.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'ok' })

        return
      }

      fragmentoArmado = false
      await ruta.fulfill({ status: 403, contentType: 'text/plain', body: 'Forbidden' })
    })

    // La renovación falla la primera vez. El usuario pulsa «Reintentar» y la
    // segunda sí funciona: es el camino completo, no una recuperación fingida.
    let renovacionesFalladas = 0

    await page.route('**/api/stream/resolve', async (ruta) => {
      const cuerpo = ruta.request().postData() ?? ''
      const esRenovacion = cuerpo.includes('"refresh":true')

      if (esRenovacion && renovacionesFalladas === 0) {
        renovacionesFalladas = 1
        await ruta.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'la fuente no responde' }),
        })

        return
      }

      await ruta.continue()
    })

    await page.goto(EPISODIO_HLS)

    const video = page.locator('video')
    await expect(video).toHaveAttribute('src', /\/stream\//, { timeout: 20_000 })

    await reproducir(page, video)
    await esperarTransporte(page)

    const capturado = await tiempoDe(video)

    fragmentoArmado = true
    await page.evaluate((codigo) => window.__nnAnimeE2E?.fallarFragmento(codigo), 403)

    // Se agotó la renovación: ahora sí hay que decírselo a quien está mirando,
    // con un mando para volver a intentarlo.
    const aviso = avisoDeReproduccion(page)
    await expect(aviso).toBeVisible({ timeout: 20_000 })

    const reintentar = page.getByRole('button', { name: 'Reintentar' })
    await expect(reintentar).toBeVisible()

    const segundaRenovacion = page.waitForRequest(
      (solicitud) =>
        solicitud.url().includes('/api/stream/resolve') &&
        (solicitud.postData() ?? '').includes('"refresh":true'),
      { timeout: 20_000 },
    )

    await reintentar.click()
    await segundaRenovacion

    // Reanuda donde iba, y en marcha: el botón no puede devolver el episodio al
    // principio ni dejarlo en pausa.
    await expect
      .poll(async () => await tiempoDe(video), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(capturado - 1)

    expect(await video.evaluate((elemento: HTMLVideoElement) => elemento.paused)).toBe(false)

    // Y el aviso se retira: ya no hay nada que contar.
    await expect(aviso).toHaveCount(0)
  })
})
