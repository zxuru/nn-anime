import { test as setup } from '@playwright/test'
import { AVISOS, CLAVE_GUIA, RECORRIDOS, VERSION_GUIA } from '../src/features/guia/guia'
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

  /*
    Los recorridos salen solos la primera vez que se entra en cada pantalla y
    tapan lo que hay debajo. En el arnés se dan por vistos —la prueba de la guía
    los borra para verlos—: sin esto, cada prueba de la suite empezaría con un
    popover encima y ningún clic llegaría a su destino. Los avisos también se dan
    por vistos: un faro latiendo en la cabecera taparía el enlace que varias
    pruebas pulsan.
  */
  await page.evaluate(
    ({ clave, estado }) => {
      localStorage.setItem(clave, JSON.stringify(estado))
    },
    {
      clave: CLAVE_GUIA,
      estado: {
        v: VERSION_GUIA,
        recorridos: RECORRIDOS.map((recorrido) => recorrido.id),
        vistos: AVISOS.map((aviso) => aviso.id),
      },
    },
  )

  await page.context().storageState({ path: RUTA_ESTADO })
})
