import { expect, test } from '@playwright/test'
import { entrar } from './fixtures'

/**
 * La página de Descargas, sin nada descargado.
 *
 * El e2e del motor necesita una fuente que descargue y una red de mentira; aquí
 * sólo se mide la pantalla: que exista, que la navegación lleve, que el vacío se
 * explique en vez de dejar una lista en blanco y que la carpeta de destino se
 * pueda cambiar sin el anfitrión de escritorio.
 */
test.describe('las descargas', () => {
  test('la navegación lleva a Descargas y el vacío se explica', async ({ page }) => {
    await entrar(page)
    await page.getByRole('link', { name: 'Descargas' }).click()

    await expect(page).toHaveURL(/\/downloads$/)
    // `level: 1` y no sólo el nombre: el encabezado de la carpeta también dice
    // «descargas» y `getByRole` compara por subcadena.
    await expect(page.getByRole('heading', { level: 1, name: 'Descargas' })).toBeVisible()
    await expect(
      page.getByText('No hay ninguna descarga. Abre un episodio y pulsa «Descargar».'),
    ).toBeVisible()
    await expect(page.getByText(/Libre: .+ de .+\. Las descargas ocupan .+\./)).toBeVisible()
    // En el navegador no hay anfitrión: el selector nativo no se ofrece, pero la
    // carpeta sí se puede escribir a mano.
    await expect(page.getByRole('button', { name: 'Elegir carpeta…' })).toHaveCount(0)
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
    await page.getByRole('link', { name: 'Descargas' }).click()

    await page.getByLabel('Se guardan en').fill('D:\\Anime\\nn-anime')
    await page.getByRole('button', { name: 'Guardar carpeta' }).click()

    await expect.poll(() => cuerpo).toBe(JSON.stringify({ path: 'D:\\Anime\\nn-anime' }))
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
})
