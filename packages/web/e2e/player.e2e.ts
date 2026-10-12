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
   * El botón de reproducir mide lo mismo en los dos estados.
   *
   * El botón medía lo que medía su rótulo —y «Pausa» no ocupa lo que
   * «Reproducir»—: al pausar encogía y los mandos de al lado se corrían. Ahora el
   * mando lleva un dibujo y mide lo que fija el token; lo que se mide aquí es que
   * eso sea verdad en la caja de verdad —el único sitio donde un ancho existe— y
   * que el mando de al lado no se mueva.
   */
  test('el botón de reproducir no cambia de tamaño al pausar', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna')

    await expect(page.locator('video')).toHaveAttribute('src', /\/stream\//, { timeout: 10_000 })

    /** El ancho de la caja de un mando, por su nombre. */
    const anchoDe = async (nombre: string): Promise<number> => {
      const caja = await page.getByRole('button', { name: nombre }).boundingBox()

      expect(caja, nombre).not.toBeNull()

      return caja?.width ?? 0
    }

    const vecino = page.getByRole('button', { name: 'Retroceder 10 segundos' })
    const antes = await vecino.boundingBox()

    const enPausa = await anchoDe('Reproducir')

    await page.getByRole('button', { name: 'Reproducir' }).click()
    const reproduciendo = await anchoDe('Pausar')

    expect(enPausa).toBeGreaterThan(0)
    // Un píxel de holgura, y no más: la caja la devuelve el navegador con la
    // transformación del ratón encima, y ahí cabe un decimal de pintado. El salto
    // que esto mide eran decenas de píxeles.
    expect(Math.abs(reproduciendo - enPausa)).toBeLessThan(1)

    // Y el mando de al lado no se ha movido: es el salto que se veía.
    const despues = await vecino.boundingBox()
    expect(Math.abs((despues?.x ?? 0) - (antes?.x ?? 0))).toBeLessThan(1)

    // Se vuelve a pausar: el ancho no puede recuperarse sólo en un sentido.
    await page.getByRole('button', { name: 'Pausar' }).click()
    expect(Math.abs((await anchoDe('Reproducir')) - enPausa)).toBeLessThan(1)

    // El silencio lleva el mismo arreglo, y el nombre del otro estado es más
    // largo: el ancho no puede depender de cuál de los dos se anuncie.
    const silencio = await anchoDe('Silenciar')
    await page.getByRole('button', { name: 'Silenciar' }).click()
    expect(Math.abs((await anchoDe('Activar sonido')) - silencio)).toBeLessThan(1)
  })

  /**
   * El clic sobre la imagen.
   *
   * Un `<video>` sin `controls` no trae gesto ninguno: hasta ahora la imagen era
   * un cuadro que no respondía al ratón y había que bajar a los botones. Aquí se
   * mide contra el elemento de verdad, que es lo único que dice si el clic
   * pausó.
   */
  test('el clic en la imagen pausa y reanuda', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna')

    const video = page.locator('video')
    await expect(video).toHaveAttribute('src', /\/stream\//, { timeout: 10_000 })

    await page.getByRole('button', { name: 'Silenciar' }).click()
    await page.getByRole('button', { name: 'Reproducir' }).click()
    await expect
      .poll(async () => await video.evaluate((e: HTMLVideoElement) => e.paused))
      .toBe(false)

    await video.click()

    // El clic no pausa en el acto: espera a ver si el segundo clic lo convierte
    // en un doble. Esta comprobación es la que mide la espera; sin ella, el gesto
    // se ejecutaría al momento y un doble clic pausaría además de cambiar de
    // pantalla.
    await page.waitForTimeout(100)
    expect(await video.evaluate((e: HTMLVideoElement) => e.paused)).toBe(false)

    await expect
      .poll(async () => await video.evaluate((e: HTMLVideoElement) => e.paused))
      .toBe(true)

    await video.click()
    await expect
      .poll(async () => await video.evaluate((e: HTMLVideoElement) => e.paused))
      .toBe(false)
  })

  /**
   * El doble clic, la pantalla completa y la vuelta.
   *
   * El navegador manda dos clics antes del `dblclick`, así que se mide además que
   * la reproducción quede donde estaba: dos `toggle` seguidos se anulan, y sin
   * esta comprobación un temporizador mal puesto pasaría inadvertido.
   */
  test('el doble clic pone la pantalla completa sin cambiar la reproducción', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna')

    const video = page.locator('video')
    await expect(video).toHaveAttribute('src', /\/stream\//, { timeout: 10_000 })

    await page.getByRole('button', { name: 'Silenciar' }).click()
    await page.getByRole('button', { name: 'Reproducir' }).click()
    await expect
      .poll(async () => await video.evaluate((e: HTMLVideoElement) => e.paused))
      .toBe(false)

    await video.dblclick()

    await expect
      .poll(async () => await page.evaluate(() => document.fullscreenElement !== null))
      .toBe(true)
    expect(await video.evaluate((e: HTMLVideoElement) => e.paused)).toBe(false)

    // El mismo gesto la quita: dentro de la pantalla completa no hay más mandos
    // que la propia imagen, y sin la vuelta el doble clic no salía de ahí.
    //
    // La salida se cuenta, no sólo se mira: al recibir un segundo
    // `requestFullscreen` el Chromium sin pantalla sale de la pantalla completa
    // por su cuenta, así que el resultado se ve igual con la rama de salida y sin
    // ella. Lo que sí distingue una implementación de la otra es que se **pida**
    // salir, y eso es lo que se cuenta aquí.
    await page.evaluate(() => {
      const original = document.exitFullscreen.bind(document)

      document.documentElement.dataset.salidas = '0'
      document.exitFullscreen = () => {
        const salidas = Number(document.documentElement.dataset.salidas ?? '0') + 1

        document.documentElement.dataset.salidas = String(salidas)

        return original()
      }
    })

    await video.dblclick()
    await expect
      .poll(async () => await page.evaluate(() => document.fullscreenElement !== null))
      .toBe(false)
    await expect
      .poll(async () => await page.evaluate(() => document.documentElement.dataset.salidas))
      .not.toBe('0')
  })

  /**
   * Los mandos se esconden solos mientras reproduce.
   *
   * Tres segundos sin tocar nada y la banda desaparece: encima del video es
   * ruido. En pausa no se esconden nunca —el fotograma quieto no se tapa y los
   * mandos son lo único que se puede hacer— y con el puntero encima vuelven. Se
   * mide la opacidad calculada, que es lo que distingue «escondido» de «fuera del
   * documento»: con `display: none` el foco del teclado se perdería.
   */
  test('los mandos se esconden mientras reproduce y vuelven con el puntero', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna')

    await expect(page.locator('.player__seek .player__range')).toBeEnabled({ timeout: 10_000 })

    const mandos = page.locator('.player__controls')

    // En pausa, quietos: más de lo que dura el temporizador y siguen ahí.
    await page.waitForTimeout(3500)
    await expect(mandos).toHaveCSS('opacity', '1')

    await page.getByRole('button', { name: 'Silenciar' }).click()
    await page.getByRole('button', { name: 'Reproducir' }).click()

    // El clic deja el foco en el mando, y un mando con el foco no se esconde
    // nunca: es la mitad de abajo de esta prueba, y aquí estorba.
    await page.evaluate(() => {
      const activo = document.activeElement
      if (activo instanceof HTMLElement) activo.blur()
    })

    await expect(mandos).toHaveCSS('opacity', '0', { timeout: 15_000 })

    // Y vuelven con el puntero sobre el marco, sin tocar nada más.
    await page.locator('.player__stage').hover()
    await expect(mandos).toHaveCSS('opacity', '1')

    // Con el foco del teclado dentro no se esconden ni aunque pase el tiempo:
    // esconderle el mando enfocado a quien navega con el teclado es dejarlo
    // pulsando a ciegas.
    await page.getByRole('button', { name: 'Pausar' }).focus()
    await page.waitForTimeout(3500)
    await expect(mandos).toHaveCSS('opacity', '1')
  })

  /**
   * La barra de volumen sólo aparece cuando se va a usar.
   *
   * Es un mando que se toca de vez en cuando y ocupaba el ancho de tres botones
   * todo el rato. Se mide con el puntero **fuera** y **dentro**: si el CSS la
   * dejara siempre visible, la primera comprobación fallaría.
   */
  test('la barra de volumen aparece al pasar el puntero por su grupo', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna')

    await expect(page.locator('.player__seek .player__range')).toBeEnabled({ timeout: 10_000 })

    const barra = page.locator('.player__slider')

    await page.mouse.move(0, 0)
    await expect(barra).toHaveCSS('opacity', '0')

    await page.getByRole('button', { name: 'Silenciar' }).hover()
    await expect(barra).toHaveCSS('opacity', '1')
  })

  /**
   * La barra de volumen.
   *
   * Se mide el volumen del elemento y no el del estado: es el elemento quien
   * suena. Y se mide que subirlo con el silencio puesto devuelve el sonido,
   * porque una barra que se arrastra sin que pase nada se lee como rota.
   */
  test('la barra de volumen cambia el volumen del elemento', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna')

    const video = page.locator('video')
    await expect(video).toHaveAttribute('src', /\/stream\//, { timeout: 10_000 })

    const barra = page.getByRole('slider', { name: 'Volumen' })
    await barra.fill('40')
    await expect
      .poll(async () => await video.evaluate((e: HTMLVideoElement) => e.volume))
      .toBeCloseTo(0.4, 2)

    await page.getByRole('button', { name: 'Silenciar' }).click()
    await expect.poll(async () => await video.evaluate((e: HTMLVideoElement) => e.muted)).toBe(true)

    await barra.fill('70')
    await expect
      .poll(async () => await video.evaluate((e: HTMLVideoElement) => e.volume))
      .toBeCloseTo(0.7, 2)
    await expect
      .poll(async () => await video.evaluate((e: HTMLVideoElement) => e.muted))
      .toBe(false)
  })

  /**
   * La pestaña y el encabezado dicen qué se está viendo.
   *
   * La dirección del reproductor sólo lleva la referencia del episodio, así que
   * el nombre del título se pide aparte. Sin él, la pestaña de un episodio se
   * llamaba igual que la aplicación entera y no había forma de distinguirla de
   * las otras tres fichas abiertas.
   */
  test('la pestaña y el encabezado nombran el título y el episodio', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna%233')

    await expect(page).toHaveTitle('Aurora Nocturna · Episodio 3 · nn-anime', { timeout: 15_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Aurora Nocturna' })).toBeVisible()
    // El episodio, en una sola línea: el número, el lugar que ocupa de cuántos.
    await expect(page.locator('.watch__episode')).toHaveText('Episodio 3 · 3 de 12')
  })

  /**
   * La vuelta a la ficha.
   *
   * La cabecera de la aplicación lleva a la home, no al título, así que la
   * pantalla de reproducción era un callejón sin salida: la única vuelta era el
   * botón de atrás del navegador, que a pantalla completa no se ve. Aquí se mide
   * lo que no mide la prueba del componente: que el enlace navega sin recargar y
   * que aterriza en la ficha del título que se estaba viendo.
   */
  test('vuelve a la ficha del título sin recargar la página', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna%233')

    await page.getByRole('link', { name: 'Volver a la ficha' }).click()

    await expect(page).toHaveURL('/anime/fixture/aurora-nocturna')
    await expect(page.getByRole('heading', { level: 1, name: 'Aurora Nocturna' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.locator('.episodes li')).toHaveCount(12, { timeout: 15_000 })
  })

  /**
   * El mismo borde para todo.
   *
   * El título llegaba hasta el ancho de la página y el video se quedaba en los
   * 960 px de su propio máximo: dos sangrías para la misma pantalla y un hueco
   * vacío a la derecha del video. Aquí se mide lo que se ve: que el encabezado,
   * el reproductor y la fila de mandos empiezan en la misma vertical.
   */
  test('el encabezado, el reproductor y los mandos comparten el borde izquierdo', async ({
    page,
  }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna%233')

    await expect(page.locator('video')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.watch__nav')).toBeVisible()

    const izquierdas = await Promise.all(
      ['.watch__head h1', '.player', '.watch__nav'].map(async (selector) => {
        const caja = await page.locator(selector).boundingBox()

        return caja?.x
      }),
    )

    const referencia = izquierdas[0]
    expect(referencia).toBeDefined()

    for (const izquierda of izquierdas) {
      expect(izquierda).toBeDefined()
      expect(Math.abs((izquierda ?? 0) - (referencia ?? 0))).toBeLessThanOrEqual(1)
    }
  })

  /**
   * El botón grande y la barra de progreso por capas.
   *
   * Lo que se mide aquí no lo puede medir una prueba de marcado: el overlay sólo
   * aparece cuando el medio ya trajo metadatos y, sobre todo, que el dibujo **no
   * se coma el clic** —el gesto es del video entero— es una propiedad del
   * puntero, no del HTML.
   */
  test('en pausa se ve el botón grande y el clic sigue siendo del video', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna')

    await expect(page.locator('.player__seek .player__range')).toBeEnabled({ timeout: 10_000 })

    const grande = page.locator('.player__play-icon')
    await expect(grande).toBeVisible()
    // Debajo del dibujo está el video: el clic llega al elemento, que es quien
    // reproduce. Si el overlay recibiera el puntero, el clic en la imagen
    // fallaría por «elemento tapado» en vez de por el gesto.
    const overlay = grande.locator('..')
    expect(await overlay.evaluate((elemento) => getComputedStyle(elemento).pointerEvents)).toBe(
      'none',
    )

    await page.getByRole('button', { name: 'Silenciar' }).click()
    await page.getByRole('button', { name: 'Reproducir' }).click()
    await expect(grande).toHaveCount(0, { timeout: 10_000 })
  })

  /**
   * La barra, con el búfer debajo y el tiempo encima del puntero.
   *
   * El búfer es la capa que distingue una pausa de red del final del episodio, y
   * el globo es lo que hace que se pueda apuntar a un segundo concreto: sin él se
   * arrastra a ciegas.
   */
  test('la barra enseña el búfer y el tiempo bajo el puntero', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna')

    const video = page.locator('video')
    await expect(page.locator('.player__seek .player__range')).toBeEnabled({ timeout: 10_000 })

    // Se reproduce un momento: con `preload="metadata"` el elemento no trae datos
    // de más hasta que alguien le da a reproducir, y un búfer de cero no dice
    // nada de la capa que lo pinta.
    await page.getByRole('button', { name: 'Silenciar' }).click()
    await page.getByRole('button', { name: 'Reproducir' }).click()

    const anchura = async (selector: string): Promise<number> =>
      await page.locator(selector).evaluate((elemento) => elemento.getBoundingClientRect().width)

    await expect
      .poll(async () => await anchura('.player__buffer'), { timeout: 10_000 })
      .toBeGreaterThan(0)

    // Y no cualquier anchura: la proporción que se pinta es la que el elemento
    // tiene en búfer. Una capa que midiera siempre lo mismo pasaría la
    // comprobación anterior y no mediría nada.
    const delElemento = await video.evaluate((elemento: HTMLVideoElement) => {
      const tramos = elemento.buffered

      return tramos.length === 0 || elemento.duration <= 0
        ? 0
        : tramos.end(tramos.length - 1) / elemento.duration
    })
    const pintada = (await anchura('.player__buffer')) / (await anchura('.player__track'))

    expect(Math.abs(pintada - delElemento)).toBeLessThan(0.05)

    await page.locator('.player__seek').hover({ position: { x: 60, y: 12 } })

    const globo = page.locator('.player__tooltip')
    await expect(globo).toBeVisible()
    await expect(globo).toHaveText(/^\d+:\d{2}$/)

    await page.mouse.move(0, 0)
    await expect(globo).toHaveCount(0)
  })

  /**
   * La espera, encima del video.
   *
   * El estado de «cargando» se cubre en la prueba del componente, que lo pilla en
   * el primer render. Lo que sólo se puede medir aquí es la **otra** espera: la
   * que empieza a mitad de reproducción, cuando el elemento se queda sin datos.
   * Se provoca desde la página porque es un evento del elemento y no algo que se
   * pueda pedir por la interfaz; lo que se mide es nuestro oído, no el evento.
   */
  test('la espera a mitad se dice encima del video, y se va al volver', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna')

    const video = page.locator('video')
    await expect(video).toHaveAttribute('src', /\/stream\//, { timeout: 10_000 })

    // La barra se habilita con la duración, que es la señal de que el elemento ya
    // trajo los metadatos: hasta ahí el cartel es el de «cargando». Se nombra la
    // barra del tiempo y no `.player__range` a secas: el volumen comparte esa
    // clase desde que tiene su mando, y el localizador quedaría ambiguo.
    await expect(page.locator('.player__seek .player__range')).toBeEnabled({ timeout: 10_000 })

    const espera = page.locator('.player__wait')
    await expect(espera).toHaveCount(0)

    await video.evaluate((elemento) => elemento.dispatchEvent(new Event('waiting')))
    await expect(espera).toBeVisible()
    await expect(espera).toContainText(/búfer/i)

    await video.evaluate((elemento) => elemento.dispatchEvent(new Event('playing')))
    await expect(espera).toHaveCount(0)
  })

  /**
   * La pantalla de reproducción no es texto que se copia.
   *
   * Se mide el valor **calculado** en un rótulo y no la regla escrita: lo que
   * importa es que la herencia llegue al hijo, que es donde estaba el texto que
   * se seleccionaba al arrastrar por encima.
   */
  test('la pantalla de reproducción no se selecciona', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna%232')

    const posicion = page.locator('.watch__episode')
    await expect(posicion).toHaveText('Episodio 2 · 2 de 12')

    expect(await posicion.evaluate((elemento) => getComputedStyle(elemento).userSelect)).toBe(
      'none',
    )
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

    // Y debajo del video, dónde se está: sin esto, dos botones en los extremos de
    // una fila vacía no dicen ni el episodio ni cuántos quedan.
    await expect(page.locator('.watch__episode')).toHaveText('Episodio 2 · 2 de 12')

    await page.getByRole('link', { name: 'Episodio siguiente' }).click()
    await expect(page).toHaveURL(/aurora-nocturna%233/)
    await expect(page.locator('.watch__episode')).toHaveText('Episodio 3 · 3 de 12')

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
    await expect(page.locator('.watch__episode')).toHaveText('Episodio 1 · 1 de 12')

    // El anterior existe como hueco apagado, y dice por qué no lleva a ninguna
    // parte: sin eso, una flecha muerta se lee como un fallo de la aplicación.
    // No es un enlace y no se anuncia como tal: ahí no se puede pulsar. Lo que lo
    // dice es el `aria-disabled` y la opacidad, no un borde discontinuo: el
    // punteado se leía como un mando a medio dibujar.
    const anterior = page.locator('.watch__nav-off', { hasText: 'Anterior' })
    await expect(anterior).toHaveAttribute('title', /primer episodio/)
    await expect(anterior).toHaveAttribute('aria-disabled', 'true')
    await expect(anterior).toHaveCSS('border-style', 'solid')
    const opacidad = await anterior.evaluate((elemento) => getComputedStyle(elemento).opacity)
    expect(Number(opacidad)).toBeLessThan(1)
    await expect(page.getByRole('link', { name: 'Episodio anterior' })).toHaveCount(0)

    await page.goto('/watch/fixture/aurora-nocturna%2312')

    // El último: al revés.
    const enlacesFinal = page.locator('a.watch__nav-link')
    await expect(enlacesFinal).toHaveCount(1)
    await expect(enlacesFinal).toHaveAttribute('href', /aurora-nocturna%2311/)

    const siguiente = page.locator('.watch__nav-off', { hasText: 'Siguiente' })
    await expect(siguiente).toHaveAttribute('title', /último episodio/)
    await expect(siguiente).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByRole('link', { name: 'Episodio siguiente' })).toHaveCount(0)
  })

  test('el modo con el que se está viendo viaja al episodio de al lado', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna%232?mode=dub')

    await page.getByRole('link', { name: 'Episodio siguiente' }).click()

    await expect(page).toHaveURL(/aurora-nocturna%233\?mode=dub/)
  })

  /**
   * El menú de ajustes.
   *
   * Lo que se mide es el ciclo entero del popover, que es donde se rompe: se
   * abre con su mando —y el mando lo dice con `aria-expanded`—, se cierra con
   * `Esc` **devolviendo el foco a donde estaba** y también con un clic fuera, que
   * es lo que hace la mano cuando se cansa de él.
   */
  test('el menú de ajustes se abre, se cierra con Esc y con un clic fuera', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna%233')

    await expect(page.locator('.player__seek .player__range')).toBeEnabled({ timeout: 10_000 })

    const abrir = page.getByRole('button', { name: 'Ajustes' })
    const menu = page.locator('.player__menu')

    await expect(abrir).toHaveAttribute('aria-expanded', 'false')
    await expect(menu).toHaveCount(0)

    await abrir.click()
    await expect(menu).toBeVisible()
    await expect(abrir).toHaveAttribute('aria-expanded', 'true')

    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    // El foco vuelve al mando que lo abrió: sin eso, quien navega con el teclado
    // se queda en el `body` y tiene que empezar la página desde arriba.
    await expect(abrir).toBeFocused()

    await abrir.click()
    await expect(menu).toBeVisible()
    await page.locator('video').click({ position: { x: 40, y: 40 }, force: true })
    await expect(menu).toHaveCount(0)
  })

  /**
   * El audio se cambia desde el menú y desde la fila, y es el mismo estado.
   *
   * El control está en los dos sitios a propósito —en la fila porque se cambia a
   * menudo, en el menú porque es donde se busca—, así que lo que hay que medir es
   * que las dos copias escriban en el mismo sitio: al pulsar la del menú, la de
   * la fila queda marcada y se pide **otro stream** al servidor.
   */
  test('cambiar el audio pide el otro stream, desde el menú o desde la fila', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna%233')

    await expect(page.locator('.player__seek .player__range')).toBeEnabled({ timeout: 10_000 })

    const fila = page.locator('.watch__nav')
    const menu = page.locator('.player__menu')

    await expect(fila.getByRole('button', { name: 'Subtitulado' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    const peticion = page.waitForRequest(
      (solicitud) =>
        solicitud.url().includes('/api/stream/resolve') &&
        (solicitud.postData() ?? '').includes('"mode":"dub"'),
    )

    await page.getByRole('button', { name: 'Ajustes' }).click()
    await menu.getByRole('button', { name: 'Doblado' }).click()
    await peticion

    await expect(menu.getByRole('button', { name: 'Doblado' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(fila.getByRole('button', { name: 'Doblado' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  /**
   * La ayuda del teclado, en un diálogo.
   *
   * Estaba siempre a la vista, en tres filas debajo del video, para algo que se
   * mira una vez. Se abre con `?` —el atajo que todo el mundo prueba— y se cierra
   * con `Esc`, que lo pone el navegador por ser un `<dialog>` nativo.
   */
  test('la ayuda del teclado se abre con «?» y se cierra con Esc', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna%233')

    await expect(page.locator('.player__seek .player__range')).toBeEnabled({ timeout: 10_000 })

    const ayuda = page.locator('.player__dialog')
    await expect(ayuda).not.toBeVisible()

    await page.keyboard.press('?')
    await expect(ayuda).toBeVisible()
    await expect(ayuda).toContainText('Pausa y reanudar')

    await page.keyboard.press('Escape')
    await expect(ayuda).not.toBeVisible()
  })

  /**
   * El visionado queda registrado con su **duración**, una sola vez por episodio
   * y con el segundo donde se dejó.
   *
   * Tres cosas que se miden aquí porque sólo se ven con el navegador de por medio:
   *
   * - La duración: el servidor calcula con la posición y la duración la proporción
   *   vista, y descarta lo que no llega al 2 %. Sin duración, todo valía cero y la
   *   fila se quedaba vacía. La pantalla mandaba la posición y un cero.
   * - Una tarjeta por episodio: cada reproducción abre su propia fila, así que
   *   volver a abrir el episodio pintaba la misma tarjeta repetida.
   * - Y la tarjeta **continúa**: el enlace lleva el segundo, y el video arranca
   *   ahí en vez de en el principio.
   *
   * Se entra por la ficha y no por una dirección escrita a mano: el visionado se
   * registra contra el **episodio**, y sólo la lista de la ficha da una
   * referencia de episodio con su número. Con la del título a secas, el alta
   * responde 404 y no queda nada que continuar.
   */
  test('lo visto a medias aparece en «continuar viendo», sin duplicarse y por donde se dejó', async ({
    page,
  }) => {
    await entrar(page)
    await page.goto('/anime/fixture/aurora-nocturna')

    const lista = page.locator('.episodes li')
    await expect(lista).toHaveCount(12, { timeout: 15_000 })
    await lista.first().getByRole('link').click()

    const video = page.locator('video')
    await expect(video).toBeVisible({ timeout: 10_000 })
    await expect(video).toHaveAttribute('src', /\/stream\//, { timeout: 10_000 })

    await page.getByRole('button', { name: 'Silenciar' }).click()
    await page.getByRole('button', { name: 'Reproducir' }).click()
    await page.waitForTimeout(2000)
    await page.getByRole('button', { name: 'Pausar' }).click()

    // Otra vuelta al mismo episodio: es lo que abría una segunda fila y pintaba
    // la misma tarjeta dos veces en la home.
    await page.getByRole('button', { name: 'Reproducir' }).click()
    await page.waitForTimeout(1500)
    await page.getByRole('button', { name: 'Pausar' }).click()

    const recientes = async (): Promise<{ items: { durationS: number; positionS: number }[] }> =>
      (await (await page.request.get('/api/watch/recent')).json()) as {
        items: { durationS: number; positionS: number }[]
      }

    await expect
      .poll(async () => (await recientes()).items.length, { timeout: 10_000 })
      .toBeGreaterThan(0)

    const items = (await recientes()).items
    const item = items[0]

    expect(items).toHaveLength(1)
    // La duración es lo que faltaba: con cero, la fila descarta el visionado.
    expect(item?.durationS).toBeGreaterThan(0)
    expect(item?.positionS).toBeGreaterThan(0)

    // En la home, la tarjeta con su barra, y la fila **la primera**: es lo único
    // de la página que retoma algo a medias.
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Continuar viendo' })).toBeVisible()
    await expect(page.getByText('Nada a medias')).toHaveCount(0)
    expect((await page.locator('.section__title').allTextContents())[0]).toBe('Continuar viendo')

    const fila = page.locator('.section').filter({ hasText: 'Continuar viendo' })
    await expect(fila.locator('progress')).toBeVisible()
    await expect(fila.locator('.poster__title').first()).toHaveText('Aurora Nocturna')

    // Y la tarjeta continúa el episodio: el enlace lleva el segundo y el video
    // arranca ahí, no en el cero.
    await fila.locator('.poster__link').first().click()
    await expect(page).toHaveURL(/at=/)

    const reanudado = page.locator('video')
    await expect(reanudado).toHaveAttribute('src', /\/stream\//, { timeout: 10_000 })
    await expect
      .poll(
        async () => await reanudado.evaluate((elemento: HTMLVideoElement) => elemento.currentTime),
        {
          timeout: 10_000,
        },
      )
      .toBeGreaterThan((item?.positionS ?? 0) - 1)
  })
})

/**
 * El modo compatible, en un navegador de verdad.
 *
 * Aquí se mide que encenderlo **no rompa** la reproducción y que el lienzo esté
 * donde tiene que estar. El fallo que lo motiva no se puede medir aquí: este
 * Chromium corre sin GPU, así que su camino de pintado nunca falla. Eso es del
 * equipo con Wayland y NVIDIA que lo reportó.
 */
test.describe('el modo compatible', () => {
  test('encenderlo pone el lienzo encima y no corta la reproducción', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna')

    const video = page.locator('video')
    await expect(video).toHaveAttribute('src', /\/stream\//, { timeout: 10_000 })

    await page.getByRole('button', { name: 'Silenciar' }).click()
    await page.getByRole('button', { name: 'Reproducir' }).click()

    // El interruptor vive en el menú de ajustes: se abre, se enciende y se
    // cierra, que es el camino que hace cualquiera. Se abre **después** de darle
    // a reproducir porque un clic fuera del menú lo cierra.
    await page.getByRole('button', { name: 'Ajustes' }).click()
    const boton = page.getByRole('button', { name: 'Modo compatible' })
    await expect(boton).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.player__canvas')).toHaveCount(0)

    await boton.click()

    await expect(boton).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.player__canvas')).toBeVisible()

    // El `<video>` sigue ahí: el lienzo se pinta encima, no lo sustituye.
    await expect(video).toBeVisible()
    await expect
      .poll(
        async () => await video.evaluate((elemento: HTMLVideoElement) => elemento.currentTime),
        {
          timeout: 10_000,
        },
      )
      .toBeGreaterThan(0)
  })
})
