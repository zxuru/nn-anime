import { test as setup } from '@playwright/test'
import { BASE, bootToken, RUTA_ESTADO } from './fixtures'

/**
 * El canje del token de arranque, **una sola vez**.
 *
 * El token es de un solo uso —es una de las mitigaciones del spec— así que sólo
 * una pestaña puede canjearlo. Si cada prueba lo intentara, la segunda recibiría
 * un 401 y fallaría por el motivo equivocado: eso fue exactamente lo que pasó
 * antes de separar esto.
 *
 * Aquí se canjea, se guarda el estado del navegador —la cookie de sesión— y las
 * demás pruebas lo reutilizan. El flujo del token se prueba donde corresponde:
 * en las pruebas del servidor, que es quien lo emite y lo canjea.
 */

setup('canjear el token de arranque y guardar la sesión', async ({ page }) => {
  await page.goto(`${BASE}/?boot=${await bootToken()}`)
  await page.waitForLoadState('networkidle')

  await page.context().storageState({ path: RUTA_ESTADO })
})
