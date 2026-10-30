/**
 * Las páginas de lista en un teléfono.
 *
 * Perfil, Biblioteca y Ajustes comparten contenedor, y el criterio de estas
 * pruebas es el mismo en las tres: que la página no desplace a lo ancho y que sus
 * mandos principales estén a la vista y se puedan pulsar. La biblioteca con
 * descargas y su reproductor van por rutas interceptadas: el arnés del e2e no
 * descarga nada de verdad y lo que se mide aquí es la pantalla, no el motor.
 */

import { expect, type Page, test } from '@playwright/test'
import { entrar, esperarApp } from './fixtures'

test.use({ viewport: { width: 390, height: 844 } })

/** El ancho que sobra a la página: cero o negativo significa que no hay desborde. */
async function desborde(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

/** Una descarga completa, con lo que la pantalla necesita para pintarla. */
function descarga(id: number, episodio: string, bytes = 1024 * 1024) {
  return {
    id,
    providerId: 'fixture',
    animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
    episodeRef: { providerId: 'fixture', value: `aurora-nocturna#${id}` },
    title: 'Aurora Nocturna',
    episodeLabel: episodio,
    kind: 'file',
    status: 'complete',
    bytes,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

async function interceptarDescargas(page: Page, items: readonly unknown[]): Promise<void> {
  await page.route('**/api/downloads', async (ruta) => {
    await ruta.fulfill({ json: { items } })
  })
  await page.route('**/api/downloads/space', async (ruta) => {
    await ruta.fulfill({
      json: {
        freeBytes: 700 * 1024 ** 3,
        totalBytes: 930 * 1024 ** 3,
        downloadsBytes: 2 * 1024 ** 3,
        path: 'C:\\Users\\nn\\Descargas',
      },
    })
  })
}

test.describe('la biblioteca en el móvil', () => {
  test('el vacío se explica, la carpeta se abre y nada desborda', async ({ page }) => {
    await entrar(page)
    await page.locator('.barra').getByRole('link', { name: 'Biblioteca' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Biblioteca' })).toBeVisible()
    await expect(page.getByText('Tu biblioteca está vacía.')).toBeVisible()

    await page.getByText('Carpeta y espacio').click()
    await expect(page.getByLabel('Se guardan en')).toHaveValue(/.+/)
    await expect(page.getByRole('button', { name: 'Elegir carpeta…' })).toBeVisible()

    expect(await desborde(page)).toBeLessThanOrEqual(0)
  })
})

test.describe('el reproductor de una descarga en el móvil', () => {
  test('los mandos están y la página no desborda', async ({ page }) => {
    await interceptarDescargas(page, [descarga(42, 'Episodio 1'), descarga(43, 'Episodio 2')])
    await page.route('**/api/downloads/42', async (ruta) => {
      await ruta.fulfill({ json: descarga(42, 'Episodio 1') })
    })

    await entrar(page)
    await page.goto('/library/42')

    await expect(page.getByRole('heading', { level: 1, name: 'Aurora Nocturna' })).toBeVisible()
    await expect(page.locator('.library-player__badge')).toBeVisible()
    await expect(page.locator('.library-player__back')).toBeVisible()

    // A 390 px el reproductor ya es «compacto»: los saltos de diez segundos y el
    // volumen no caben en la barra y viven en el menú. Lo que tiene que estar a
    // la vista es lo de siempre: play, ajustes y pantalla completa.
    for (const mando of ['Reproducir', 'Ajustes', 'Pantalla completa']) {
      await expect(page.getByRole('button', { name: mando })).toBeVisible()
    }

    await page.getByRole('button', { name: 'Ajustes' }).click()
    await expect(page.getByRole('button', { name: 'Silenciar' })).toBeVisible()

    // Las flechas de episodio y la lista, debajo del reproductor.
    await expect(page.getByRole('link', { name: /Siguiente: Episodio 2/ })).toBeVisible()
    await expect(page.locator('.watch__list-item', { hasText: 'Episodio 2' })).toBeVisible()

    expect(await desborde(page)).toBeLessThanOrEqual(0)
  })

  test('borrar un episodio pide confirmación', async ({ page }) => {
    await interceptarDescargas(page, [descarga(42, 'Episodio 1')])
    await entrar(page)
    await page.goto('/library')

    await page.getByRole('button', { name: 'Borrar Episodio 1' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: '¿Eliminar la descarga?' })).toBeVisible()

    await page.getByRole('button', { name: 'Cancelar' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
  })
})

test.describe('el perfil en el móvil', () => {
  test('las cuatro secciones, con su eje y sin desbordes', async ({ page }) => {
    await entrar(page)
    await page.goto('/profile')
    await esperarApp(page)

    await expect(page.getByRole('heading', { level: 1, name: 'Perfil' })).toBeVisible()

    for (const seccion of ['Favoritos', 'Ya vistos', 'Quiero ver', 'Historial']) {
      await expect(page.getByRole('heading', { level: 2, name: seccion })).toBeVisible()
    }

    // Cuatro secciones, cada una con tarjetas o con su tarjeta de vacío: la
    // pasada del e2e comparte base y no se puede exigir que estén vacías.
    await expect(page.locator('.perfil .pagina__seccion')).toHaveCount(4)
    await expect(
      page.locator('.perfil .pagina__seccion .pz, .perfil .estado-vacio').first(),
    ).toBeVisible()

    // El Perfil comparte el margen de las otras páginas: su título y sus
    // secciones empiezan en el mismo eje.
    const eje = await page.evaluate(() => {
      const titulo = document.querySelector('.perfil > h1')?.getBoundingClientRect().left ?? -1
      const seccion =
        document.querySelector('.perfil .pagina__titulo')?.getBoundingClientRect().left ?? -2

      return { titulo, seccion }
    })
    expect(eje.seccion).toBe(eje.titulo)

    expect(await desborde(page)).toBeLessThanOrEqual(0)
  })
})

test.describe('los ajustes en el móvil', () => {
  test('el aviso, los proveedores y la carpeta, sin desbordes', async ({ page }) => {
    await entrar(page)
    await page.goto('/settings')
    await esperarApp(page)

    await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Antes de copiar un plugin, lee esto' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Leer el aviso de seguridad' })).toBeVisible()

    // Con un proveedor activo, sus mandos de orden están y el primero no sube.
    await expect(page.getByRole('heading', { name: 'Proveedores', exact: true })).toBeVisible()
    const subir = page.getByRole('button', { name: /^Subir / }).first()
    await expect(subir).toBeVisible()
    await expect(subir).toBeDisabled()

    await expect(page.getByRole('heading', { name: 'Proveedores de un repositorio' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Usar proveedor predeterminado/ })).toBeVisible()

    expect(await desborde(page)).toBeLessThanOrEqual(0)
  })
})
