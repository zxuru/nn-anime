import { expect, test } from '@playwright/test'
import { entrar } from './fixtures'

/**
 * La página de Descargas, sin nada descargado.
 *
 * El e2e del motor necesita una fuente que descargue y una red de mentira; aquí
 * sólo se mide la pantalla: que exista, que la navegación lleve y que el vacío se
 * explique en vez de dejar una lista en blanco.
 */
test.describe('las descargas', () => {
  test('la navegación lleva a Descargas y el vacío se explica', async ({ page }) => {
    await entrar(page)
    await page.getByRole('link', { name: 'Descargas' }).click()

    await expect(page).toHaveURL(/\/downloads$/)
    await expect(page.getByRole('heading', { name: 'Descargas' })).toBeVisible()
    await expect(
      page.getByText('No hay ninguna descarga. Abre un episodio y pulsa «Descargar».'),
    ).toBeVisible()
    await expect(page.getByText(/^Libre: .+ de .+\. Las descargas ocupan .+\.$/)).toBeVisible()
  })

  test('una fuente que declara la capacidad ofrece el botón', async ({ page }) => {
    await entrar(page)
    await page.goto('/watch/fixture/aurora-nocturna')

    await expect(page.getByRole('button', { name: 'Descargar' })).toBeVisible({
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
})
