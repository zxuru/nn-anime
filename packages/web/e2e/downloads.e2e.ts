import { expect, test } from '@playwright/test'
import { entrar } from './fixtures'

/**
 * La biblioteca, sin nada descargado.
 *
 * El e2e del motor necesita una fuente que descargue y una red de mentira; aquí
 * sólo se mide la pantalla: que exista, que la navegación lleve, que el vacío se
 * explique en vez de dejar una lista en blanco y que la carpeta de destino se
 * pueda cambiar sin el anfitrión de escritorio. Los ajustes de la carpeta viven
 * dentro de un desplegable: la biblioteca enseña la colección, no la
 * configuración.
 */
test.describe('la biblioteca', () => {
  test('la navegación lleva a Biblioteca y el vacío se explica', async ({ page }) => {
    await entrar(page)
    await page.getByRole('link', { name: 'Biblioteca', exact: true }).click()

    await expect(page).toHaveURL(/\/library$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Biblioteca' })).toBeVisible()
    await expect(page.getByText('Tu biblioteca está vacía.')).toBeVisible()

    await page.getByText('Carpeta y espacio').click()
    await expect(page.getByText(/Libre: .+ de .+\. Las descargas ocupan .+\./)).toBeVisible()
    // Sin anfitrión no hay diálogo del sistema, pero el botón está: abre el
    // explorador que sirve la aplicación. Y la ruta se sigue pudiendo escribir.
    await expect(page.getByRole('button', { name: 'Elegir carpeta…' })).toBeVisible()
    await expect(page.getByLabel('Se guardan en')).toHaveValue(/.+/)
  })

  /**
   * La carpeta de destino, en el único sitio donde se puede elegir sin anfitrión.
   *
   * El `PATCH` va interceptado para no mover la raíz de verdad: el servidor de
   * e2e descarga en su propio directorio y cambiarlo dejaría al resto de las
   * pruebas apuntando a una carpeta que nadie limpia. Lo que se mide aquí es que
   * la pantalla mande la ruta tal cual y diga que se guardó; que el servidor la
   * acepte y la aplique ya lo mide `packages/server/src/routes/downloads.test.ts`.
   */
  test('la carpeta de descargas se cambia escribiendo una ruta', async ({ page }) => {
    let cuerpo: string | undefined

    await page.route('**/api/downloads/dir', async (ruta) => {
      cuerpo = ruta.request().postData() ?? ''
      await ruta.fulfill({ json: { path: 'D:\\Anime\\nn-anime' } })
    })

    await entrar(page)
    await page.getByRole('link', { name: 'Biblioteca', exact: true }).click()
    await page.getByText('Carpeta y espacio').click()

    await page.getByLabel('Se guardan en').fill('D:\\Anime\\nn-anime')
    await page.getByRole('button', { name: 'Guardar carpeta' }).click()

    await expect.poll(() => cuerpo).toBe(JSON.stringify({ path: 'D:\\Anime\\nn-anime' }))
    await expect(page.getByText('Carpeta cambiada.')).toBeVisible()
  })

  /**
   * El explorador de carpetas: navegar con el ratón y elegir, sin escribir nada.
   *
   * El listado va interceptado para que el recorrido no dependa del disco de la
   * máquina que corre el e2e —y para poder afirmar una ruta concreta—; que el
   * servidor liste de verdad lo mide `packages/server/src/routes/downloads.test.ts`.
   * Lo que se mide aquí es el gesto completo: abrir, entrar en una carpeta,
   * elegirla y que la ruta que viaja sea la que se está viendo.
   */
  test('el explorador navega y elige la carpeta sin escribir la ruta', async ({ page }) => {
    let cuerpo: string | undefined

    await page.route('**/api/downloads/dir', async (ruta) => {
      cuerpo = ruta.request().postData() ?? ''
      await ruta.fulfill({ json: { path: 'C:\\Videos\\Anime' } })
    })

    // El árbol de mentira se ancla en la carpeta que pide el diálogo —abre en la
    // actual, no en una raíz fija—, para no depender de dónde descarga el e2e.
    await page.route('**/api/downloads/dirs**', async (ruta) => {
      const pedida = new URL(ruta.request().url()).searchParams.get('path') ?? 'C:\\Videos'
      const dentro = pedida.endsWith('Anime')

      await ruta.fulfill({
        json: {
          path: pedida,
          parent: dentro ? pedida.slice(0, pedida.length - 'Anime'.length - 1) : null,
          dirs: dentro ? [] : [{ name: 'Anime', path: `${pedida}\\Anime` }],
          volumes: [],
        },
      })
    })

    await entrar(page)
    await page.getByRole('link', { name: 'Biblioteca', exact: true }).click()
    await page.getByText('Carpeta y espacio').click()
    await page.getByRole('button', { name: 'Elegir carpeta…' }).click()

    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Anime' }).click()
    await page.getByRole('button', { name: 'Usar esta carpeta' }).click()

    // La ruta que viaja es la que se está viendo: la elegida, no la de partida.
    await expect.poll(() => cuerpo ?? '').toMatch(/Anime"\}$/)
    await expect(page.getByText('Carpeta cambiada.')).toBeVisible()
  })

  /**
   * El botón no espera a que la fuente declare nada.
   *
   * El fixture del arnés no declara `capabilities.download` y aun así el botón
   * tiene que estar habilitado: la descarga la hace la aplicación resolviendo el
   * stream, no la fuente. Con la comprobación vieja quedaba deshabilitado, con el
   * texto de error al lado.
   */
  test('el botón está habilitado aunque la fuente no declare la capacidad', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna')

    await expect(page.getByRole('button', { name: 'Descargar' })).toBeEnabled({
      timeout: 10_000,
    })
    await expect(page.getByText('Esta fuente no permite descargar.')).toHaveCount(0)
  })

  /**
   * La estantería y su reproductor.
   *
   * Una descarga completa tiene que aparecer agrupada y abrirse en su propia
   * pantalla. El elemento se sirve por su id, así que la prueba intercepta la
   * ficha y el archivo no hace falta: lo que se mide es que el enlace lleve a
   * `/library/:id` y que el `<video>` apunte a la ruta de la descarga.
   */
  test('una descarga completa aparece en la biblioteca y abre su reproductor', async ({ page }) => {
    const item = {
      id: 1,
      providerId: 'fixture',
      animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
      episodeRef: { providerId: 'fixture', value: 'aurora-nocturna#1' },
      title: 'Aurora Nocturna',
      episodeLabel: 'Episodio 1',
      kind: 'file',
      status: 'complete',
      bytes: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    await page.route('**/api/downloads/space', async (ruta) => {
      await ruta.fulfill({
        json: {
          path: 'C:\\Descargas',
          freeBytes: 1,
          totalBytes: 2,
          downloadsBytes: 3,
        },
      })
    })
    await page.route('**/api/downloads/1', async (ruta) => {
      await ruta.fulfill({ json: item })
    })
    await page.route('**/api/downloads', async (ruta) => {
      if (ruta.request().method() !== 'GET') return ruta.continue()

      await ruta.fulfill({ json: { items: [item] } })
    })

    await entrar(page)
    await page.getByRole('link', { name: 'Biblioteca', exact: true }).click()

    await expect(page.getByText('Aurora Nocturna').first()).toBeVisible()
    await page.getByRole('link', { name: /Episodio 1/ }).click()

    await expect(page).toHaveURL(/\/library\/1$/)
    await expect(page.locator('video')).toHaveAttribute('src', '/api/downloads/1/file', {
      timeout: 10_000,
    })
  })

  test('con una copia completa, el reproductor no pide el stream al proveedor', async ({
    page,
  }) => {
    await entrar(page)

    await page.route('**/api/downloads', async (ruta) => {
      await ruta.fulfill({
        json: {
          items: [
            {
              id: 1,
              providerId: 'fixture',
              animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
              episodeRef: { providerId: 'fixture', value: 'aurora-nocturna#1' },
              title: 'Aurora Nocturna',
              episodeLabel: 'Episodio 1',
              kind: 'file',
              status: 'complete',
              bytes: 3,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      })
    })

    // Si el reproductor pidiera el stream, esto lo delataría.
    await page.route('**/api/stream/resolve', async (ruta) => {
      await ruta.fulfill({ status: 502, json: { error: 'no debería pedirse' } })
    })

    await page.goto('/watch/fixture/aurora-nocturna%231?mode=sub&anime=aurora-nocturna&n=1')

    await expect(page.locator('video')).toHaveAttribute('src', '/api/downloads/1/file', {
      timeout: 10_000,
    })
  })

  /**
   * La cola, cerrada por defecto y con lo que avanza delante.
   *
   * Con una serie entera apuntada la cola son cientos de filas y empujaba la
   * estantería fuera de la pantalla. Ahora se abre y se cierra desde su
   * cabecera, y al abrirla lo que se está bajando va primero: es lo único que
   * hay que mirar de reojo mientras se busca qué ver.
   */
  test('la cola se abre y pone delante lo que se está bajando', async ({ page }) => {
    const fila = (id: number, status: string) => ({
      id,
      providerId: 'fixture',
      animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
      episodeRef: { providerId: 'fixture', value: `aurora-nocturna#${id}` },
      title: 'Aurora Nocturna',
      episodeLabel: `Episodio ${id}`,
      kind: 'file',
      status,
      bytes: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    await page.route('**/api/downloads', async (ruta) => {
      if (ruta.request().method() !== 'GET') return ruta.continue()

      // El orden que da el servidor: el alta más nueva primero.
      await ruta.fulfill({
        json: { items: [fila(1, 'queued'), fila(2, 'downloading'), fila(3, 'failed')] },
      })
    })

    await entrar(page)
    await page.getByRole('link', { name: 'Biblioteca', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Descargas' })).toBeVisible()
    await expect(page.getByText('3 en curso')).toBeVisible()
    // Cerrada: la cola no ocupa sitio y la estantería queda a la vista.
    await expect(page.getByText('Episodio 2')).toHaveCount(0)

    await page.getByRole('button', { name: 'Ver descargas' }).click()
    await expect(page.getByText('Episodio 2')).toBeVisible()

    const etiquetas = await page.locator('.library__download-episode').allTextContents()
    expect(etiquetas).toEqual(['Episodio 2', 'Episodio 1', 'Episodio 3'])

    await page.getByRole('button', { name: 'Ocultar descargas' }).click()
    await expect(page.getByText('Episodio 2')).toHaveCount(0)
  })

  /**
   * La serie entera, en el reproductor.
   *
   * Antes el reproductor de una descarga era un episodio y nada más: para ver el
   * siguiente había que volver a la estantería. Ahora trae a sus hermanas, las
   * marca y deja pasar de una a otra sin salir de la pantalla.
   */
  test('el reproductor encadena los episodios descargados de la serie', async ({ page }) => {
    const item = (id: number) => ({
      id,
      providerId: 'fixture',
      animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
      episodeRef: { providerId: 'fixture', value: `aurora-nocturna#${id}` },
      title: 'Aurora Nocturna',
      episodeLabel: `Episodio ${id}`,
      kind: 'file',
      status: 'complete',
      bytes: 3,
      createdAt: `2026-01-0${id}T00:00:00.000Z`,
      updatedAt: `2026-01-0${id}T00:00:00.000Z`,
    })
    const items = [item(1), item(2), item(3)]

    await page.route('**/api/downloads', async (ruta) => {
      if (ruta.request().method() !== 'GET') return ruta.continue()

      await ruta.fulfill({ json: { items } })
    })

    await page.route(/\/api\/downloads\/\d+$/, async (ruta) => {
      const id = Number(new URL(ruta.request().url()).pathname.split('/').pop())
      await ruta.fulfill({ json: items.find((candidato) => candidato.id === id) ?? items[0] })
    })

    // El archivo no hace falta para medir la navegación: el `<video>` se queda
    // sin fuente y la pantalla sigue teniendo su lista y sus flechas.
    await page.route('**/api/downloads/*/file', async (ruta) => {
      await ruta.fulfill({ status: 200, contentType: 'audio/wav', body: '' })
    })

    await entrar(page)
    await page.goto('/library/1')

    await expect(page.getByRole('heading', { name: 'Episodios descargados' })).toBeVisible()

    const lista = page.locator('.watch__list-item')
    await expect(lista).toHaveCount(3)
    await expect(lista.nth(0)).toHaveAttribute('aria-current', 'page')
    await expect(page.getByText('1 de 3')).toBeVisible()

    // Al terminar, la tarjeta del siguiente aparece y se puede parar. El evento
    // se dispara a mano: el archivo del arnés no se reproduce hasta el final.
    await page.locator('.player__video').evaluate((video) => {
      video.dispatchEvent(new Event('ended'))
    })
    await expect(page.getByText(/Siguiente episodio en/)).toBeVisible()
    await page.getByRole('button', { name: 'Cancelar' }).click()
    await expect(page.getByText(/Siguiente episodio en/)).toHaveCount(0)

    await page.getByRole('link', { name: 'Siguiente: Episodio 2' }).click()
    await expect(page).toHaveURL(/\/library\/2$/)
    await expect(page.getByText('2 de 3')).toBeVisible()
    await expect(page.locator('.watch__list-item[aria-current="page"]')).toContainText('Episodio 2')

    await page.getByRole('link', { name: 'Anterior: Episodio 1' }).click()
    await expect(page).toHaveURL(/\/library\/1$/)

    // La lista también lleva: el tercero se abre desde ella.
    await page.getByRole('link', { name: 'Episodio 3' }).click()
    await expect(page).toHaveURL(/\/library\/3$/)
  })
})
