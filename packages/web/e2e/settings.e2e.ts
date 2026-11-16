import { expect, test } from '@playwright/test'
import { entrar, esperarApp } from './fixtures'

/**
 * El aviso de seguridad, de extremo a extremo.
 *
 * Antes esto era un enlace a `/SECURITY.md`, un documento que no estaba en el
 * build: el servido de estáticos caía al `index.html` —el enrutado es del
 * cliente— y el enlace parecía recargar la página. Un test que sólo mira el
 * `href` del componente no lo detectaba.
 *
 * Ahora el documento se lee dentro de la aplicación y esto comprueba las dos
 * mitades: que el diálogo enseña el texto, y que el archivo sigue servido para
 * quien lo quiera entero.
 */

test.describe('el aviso de seguridad', () => {
  test('el botón abre el documento dentro de la aplicación', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)
    await page.goto('/settings')

    await page.getByRole('button', { name: 'Leer el aviso de seguridad' }).click()

    const dialogo = page.getByRole('dialog', { name: 'Antes de copiar un plugin, lee esto' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo.getByText('Riesgo residual, en texto claro')).toBeVisible()
    await expect(dialogo.getByRole('table')).toBeVisible()
    // El texto entra en elementos, no como markdown en crudo: el riesgo residual
    // es un elemento de lista y la amenaza una celda de la tabla. El documento
    // puede nombrar el rebinding en más de un riesgo residual —hoy lo hace en el
    // 2 y en el 10—, así que se comprueba que hay al menos uno visible, no que
    // sea el único.
    await expect(
      dialogo.getByRole('listitem').filter({ hasText: 'DNS rebinding' }).first(),
    ).toBeVisible()
    await expect(dialogo.getByRole('cell', { name: /Un plugin lee o escribe/ })).toBeVisible()

    await dialogo.getByRole('button', { name: 'Cerrar' }).click()
    await expect(dialogo).toBeHidden()
  })

  test('el documento entero sigue servido, con su enlace al pie', async ({ page, request }) => {
    await entrar(page)
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Leer el aviso de seguridad' }).click()

    const enlace = page.getByRole('dialog').getByRole('link', { name: 'Ver SECURITY.md entero' })
    await expect(enlace).toHaveAttribute('href', '/SECURITY.md')

    const respuesta = await request.get('/SECURITY.md')

    expect(respuesta.status()).toBe(200)
    expect(respuesta.headers()['content-type']).toContain('text/markdown')
    expect(await respuesta.text()).toContain('# Seguridad de RoNa')
  })
})

/**
 * El índice de la página.
 *
 * Las secciones son datos (`secciones.ts`) y los dos lados —el enlace y el `id` de
 * la sección— salen de la misma lista, pero eso no se ve en una prueba de
 * servidor: lo que se mide aquí es que el navegador salta de verdad y que en una
 * ventana de 390 px la fila no arrastra la página.
 */
const SECCIONES: readonly (readonly [string, string])[] = [
  ['Fuentes', 'fuentes'],
  ['Reproducción', 'reproduccion'],
  ['Apariencia', 'apariencia'],
  ['Privacidad y contenido', 'privacidad'],
  ['Sistema', 'sistema'],
  ['Guía', 'guia'],
]

test.describe('el índice de Ajustes', () => {
  test('cada enlace lleva a su sección y la marca', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)
    await page.goto('/settings')

    const indice = page.getByRole('navigation', { name: 'Secciones de los ajustes' })
    await expect(indice).toBeVisible()

    for (const [nombre, id] of SECCIONES) {
      const enlace = indice.getByRole('link', { name: nombre, exact: true })

      await enlace.click()
      await expect(page).toHaveURL(new RegExp(`#${id}$`))
      await expect(page.locator(`#${id}`)).toBeInViewport()
      // El observador marca la sección que se está leyendo; el `:target` sólo
      // dura mientras el hash está en la dirección y no cuenta si uno baja solo.
      await expect(enlace).toHaveAttribute('aria-current', 'location')
    }
  })

  test('a 390 px la fila se desplaza y no desborda la página', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await entrar(page)
    await page.goto('/settings')

    const lista = page.locator('.settings__indice-lista')
    await expect(lista).toBeVisible()

    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(desborde).toBeLessThanOrEqual(0)

    // Seis destinos no caben en 390: la fila tiene su propio desplazamiento.
    expect(await lista.evaluate((nodo) => nodo.scrollWidth > nodo.clientWidth)).toBe(true)

    const guia = lista.getByRole('link', { name: 'Guía', exact: true })
    await guia.scrollIntoViewIfNeeded()
    await guia.click()
    await expect(page.locator('#guia')).toBeInViewport()
  })
})
