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
    // es un elemento de lista y la amenaza una celda de la tabla.
    await expect(dialogo.getByRole('listitem').filter({ hasText: 'DNS rebinding' })).toBeVisible()
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
    expect(await respuesta.text()).toContain('# Seguridad de nn-anime')
  })
})
