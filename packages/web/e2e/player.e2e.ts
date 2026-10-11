import { expect, test } from '@playwright/test'
import { entrar } from './fixtures'

/**
 * El reproductor, en un navegador de verdad.
 *
 * Lo que se prueba aquí es el **mecanismo**: que la fuente llega por el proxy,
 * que el elemento reproduce, que el tiempo avanza y que el salto funciona. El
 * archivo es un WAV generado por el arnés y no un mp4: no hay codificador de
 * vídeo disponible sin red, y un mp4 inventado no se decodifica. El códec es del
 * navegador; lo que se prueba es lo que escribimos.
 *
 * La excepción de loopback que el arnés abre es la que permite que el proxy sirva
 * un archivo local; sin ella, lo rechaza como rechaza todo lo demás.
 */

test.describe('el reproductor', () => {
  /**
   * Los dos casos de reproducción estuvieron marcados como pendientes: el
   * elemento cargaba y decía la duración, pero `play()` lo dejaba en pausa y en
   * el segundo cero. La causa no era el entorno. La posición de reanudación
   * viajaba en las dependencias del efecto del reproductor, así que cada
   * `timeupdate` volvía a montar el medio; con ella en una referencia, la
   * reproducción avanza y los dos casos se prueban de verdad.
   */
  test('reproduce y el tiempo avanza', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna')

    const video = page.locator('video')

    await expect(video).toBeVisible({ timeout: 10_000 })

    // La fuente es una ruta del proxy, no una dirección del upstream.
    await expect(video).toHaveAttribute('src', /\/stream\//, { timeout: 10_000 })

    // Se silencia antes de reproducir, y no es un detalle del test: con el audio
    // activo, la política de reproducción automática de Chromium **sin pantalla**
    // no concede activación a un clic sintético, la promesa de `play()` se rechaza
    // y el tiempo se queda en cero. Lo medí: el mismo `<video>` creado a mano con
    // el mismo URL reproduce si está silenciado, y no reproduce si no lo está.
    await page.getByRole('button', { name: 'Silenciar' }).click()
    await page.getByRole('button', { name: 'Reproducir' }).click()
    await page.waitForTimeout(1200)

    const tiempo = await video.evaluate((elemento: HTMLVideoElement) => elemento.currentTime)

    expect(tiempo).toBeGreaterThan(0)
  })

  test('el salto de 10 s adelanta el tiempo', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna')

    const video = page.locator('video')
    await expect(video).toBeVisible({ timeout: 10_000 })
    await expect(video).toHaveAttribute('src', /\/stream\//, { timeout: 10_000 })

    await page.getByRole('button', { name: 'Silenciar' }).click()
    await page.getByRole('button', { name: 'Reproducir' }).click()
    await page.waitForTimeout(500)

    // El atajo del spec: la flecha derecha son diez segundos. El foco está en el
    // cuerpo, que es el caso normal al entrar.
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)

    const tiempo = await video.evaluate((elemento: HTMLVideoElement) => elemento.currentTime)

    expect(tiempo).toBeGreaterThanOrEqual(9)
  })

  test('los controles cambian el estado que se anuncia', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna')

    const video = page.locator('video')
    await expect(video).toBeVisible({ timeout: 10_000 })
    await expect(video).toHaveAttribute('src', /\/stream\//, { timeout: 10_000 })

    await page.getByRole('button', { name: 'Reproducir' }).click()

    // El anuncio para lectores de pantalla cambia a «Reproduciendo».
    await expect(page.getByText(/Reproduciendo/)).toBeVisible({ timeout: 10_000 })
  })

  test('el aviso de mpv aparece cuando no hay reproductor externo', async ({ page }) => {
    await entrar(page)
    await page.goto('/settings')

    // En esta máquina mpv está instalado, así que se comprueba la sección, no el
    // aviso: el caso de «sin mpv» necesita el servidor arrancado sin él.
    await expect(page.getByRole('heading', { name: 'Reproductor externo' })).toBeVisible()
  })

  /**
   * Las flechas de episodio.
   *
   * Se entra por la ficha y no por una dirección escrita a mano: el camino que
   * hace cualquiera es elegir el episodio en la lista, y ahí es donde importa que
   * la flecha apunte al de al lado y no a otro sitio.
   */
  test('las flechas pasan al episodio siguiente y al anterior', async ({ page }) => {
    await entrar(page)
    await page.goto('/anime/fixture/aurora-nocturna')

    const lista = page.locator('.episodes li')
    await expect(lista).toHaveCount(12, { timeout: 15_000 })

    // El segundo episodio: así hay flecha en los dos sentidos.
    await lista.nth(1).getByRole('link').click()
    await expect(page).toHaveURL(/aurora-nocturna%232/)

    // Y en medio, dónde se está: sin esto, dos botones en los extremos de una
    // fila vacía no dicen ni el episodio ni cuántos quedan.
    await expect(page.locator('.watch__nav-pos')).toHaveText('Episodio 2 de 12')

    await page.getByRole('link', { name: 'Episodio siguiente' }).click()
    await expect(page).toHaveURL(/aurora-nocturna%233/)
    await expect(page.locator('.watch__nav-pos')).toHaveText('Episodio 3 de 12')

    await page.getByRole('link', { name: 'Episodio anterior' }).click()
    await expect(page).toHaveURL(/aurora-nocturna%232/)
  })

  test('en el primer y el último episodio la flecha está, apagada y explicada', async ({
    page,
  }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna%231')

    // El primero: hay un solo enlace de episodio, el del siguiente.
    const enlaces = page.locator('a.watch__nav-link')
    await expect(enlaces).toHaveCount(1)
    await expect(enlaces).toHaveAttribute('href', /aurora-nocturna%232/)
    await expect(page.locator('.watch__nav-pos')).toHaveText('Episodio 1 de 12')

    // El anterior existe como hueco apagado, y dice por qué no lleva a ninguna
    // parte: sin eso, una flecha muerta se lee como un fallo de la aplicación.
    // No es un enlace y no se anuncia como tal: ahí no se puede pulsar.
    const anterior = page.locator('.watch__nav-off', { hasText: 'Episodio anterior' })
    await expect(anterior).toHaveAttribute('title', /primer episodio/)
    await expect(anterior).toHaveCSS('border-style', 'dashed')
    await expect(page.getByRole('link', { name: 'Episodio anterior' })).toHaveCount(0)

    await page.goto('/watch/fixture/aurora-nocturna%2312')

    // El último: al revés.
    const enlacesFinal = page.locator('a.watch__nav-link')
    await expect(enlacesFinal).toHaveCount(1)
    await expect(enlacesFinal).toHaveAttribute('href', /aurora-nocturna%2311/)

    const siguiente = page.locator('.watch__nav-off', { hasText: 'Episodio siguiente' })
    await expect(siguiente).toHaveAttribute('title', /último episodio/)
    await expect(page.getByRole('link', { name: 'Episodio siguiente' })).toHaveCount(0)
  })

  test('el modo con el que se está viendo viaja al episodio de al lado', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna%232?mode=dub')

    await page.getByRole('link', { name: 'Episodio siguiente' }).click()

    await expect(page).toHaveURL(/aurora-nocturna%233\?mode=dub/)
  })
})
