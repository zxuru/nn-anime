/**
 * El watch party, con dos sesiones de navegador.
 *
 * El hueco U11 de la Oleada 7 pedía el flujo completo: el anfitrión crea la
 * sala, el invitado entra con la dirección y el código, se ve el roster y una
 * pausa del anfitrión para al invitado. Ese flujo **no se puede completar hoy**,
 * y no por la prueba: la aplicación rechaza su propia respuesta.
 *
 * `POST /api/party/rooms` contesta 201 con
 * `{"roomId":"…","code":"…","expiresAt":14405682.7656}`. `PartyStore` usa
 * `performance.now()` como reloj —`store.ts:125`—, que en Bun devuelve
 * milisegundos con decimales, y `partyCreateRoomResponseSchema` exige
 * `z.number().int().positive()` —`core/src/party.ts:176`—. `readJson` del
 * cliente lanza `ApiShapeError` y el panel enseña `party.error.shape`: «El
 * servidor contestó algo que la interfaz no entiende». El invitado no llega
 * nunca a entrar: el puente de su instancia valida el join del anfitrión con
 * `partyJoinResponseSchema` —también entero— y contesta 502. Y aunque se
 * saltara ese paso, el `welcome` y los `state` del SSE llevan
 * `expiresAt`/`atMs` fraccionarios y los descarta el mismo `partyEventSchema`;
 * `sync` devuelve `t1`/`t2` fraccionarios y el cliente los rechaza. Las pruebas
 * de servidor inyectan un reloj entero, así que no ven ninguna de las cuatro.
 *
 * Arreglarlo es de `packages/server` y `packages/core`, fuera del alcance de
 * este cambio. Lo que se mide aquí es lo que sí existe hoy: con `RONA_PARTY=1`,
 * `/api/health` publica `party: true` y las dos sesiones —anfitrión e
 * invitado, cada una con su contexto de navegador— ven «Ver juntos», abren el
 * panel y tienen delante su formulario: el anfitrión el de crear, con el botón
 * habilitado porque hay episodio que anunciar; el invitado el de unirse, con
 * dirección, código y nombre.
 *
 * Cuando el reloj del coordinador devuelva enteros, la prueba que falta es la
 * continuación natural de ésta: crear desde el panel, entrar con el código,
 * esperar el roster y medir que el `pause` del anfitrión para al invitado. Hay
 * un segundo hueco que aparecerá entonces: `PartyStore` sólo da de alta a los
 * invitados, así que el anfitrión no está en el roster ni tiene nombre; «los
 * dos nombres» necesita una decisión de producto (una etiqueta fija o pedir
 * nombre al anfitrión). El reporte de la tarea deja el detalle y el arreglo
 * exacto.
 */

import { expect, type Page, test } from '@playwright/test'
import { entrar, RUTA_ESTADO } from './fixtures'

const EPISODIO = '/watch/fixture/aurora-nocturna%233?anime=aurora-nocturna'

/** Entra al episodio y abre el panel de la sala. */
async function abrirPanelDeSala(page: Page): Promise<void> {
  await entrar(page)
  await page.goto(EPISODIO)

  await expect(page.locator('video')).toHaveAttribute('src', /\/stream\//, { timeout: 15_000 })
  await expect(page.locator('.player__seek .player__range')).toBeEnabled({ timeout: 15_000 })

  // El mando sólo se pinta cuando `/api/health` confirma que la sala está
  // montada. Esperar aquí es lo que ata la prueba al arranque con `RONA_PARTY=1`.
  const abrir = page.getByRole('button', { name: 'Ver juntos' })
  await expect(abrir).toBeVisible({ timeout: 10_000 })
  await abrir.click()

  await expect(page.getByRole('dialog', { name: 'Sala de visionado' })).toBeVisible()
}

test('las dos sesiones ven los mandos de la sala y sus formularios', async ({ page, browser }) => {
  test.setTimeout(60_000)
  test.info().annotations.push({
    type: 'bloqueo',
    description:
      'La sala no se puede crear desde el panel: expiresAt sale fraccionario y partyCreateRoomResponseSchema exige entero. Ver la cabecera del archivo.',
  })

  const anfitrion = page
  const contextoInvitado = await browser.newContext({ storageState: RUTA_ESTADO })
  const invitado = await contextoInvitado.newPage()

  try {
    // --- Anfitrión: puede abrir sala --------------------------------------
    await abrirPanelDeSala(anfitrion)

    const crear = anfitrion.locator('.party-panel__submit')
    await expect(crear).toBeEnabled({ timeout: 10_000 })
    await expect(crear).toHaveText('Crear sala')

    // --- Invitado: puede unirse -------------------------------------------
    // Otra sesión de navegador, con el estado que dejó el canje del token: el
    // token de arranque es de un solo uso, así que el contexto del invitado
    // reutiliza la cookie guardada. La bandeja y la pestaña son suyas.
    await abrirPanelDeSala(invitado)

    await invitado.locator('.party-panel__tab').filter({ hasText: 'Unirse' }).click()
    await expect(invitado.getByLabel('Dirección del anfitrión')).toBeVisible()
    await expect(invitado.getByLabel('Código de la sala')).toBeVisible()
    await expect(invitado.getByLabel('Tu nombre')).toBeVisible()
    await expect(invitado.locator('.party-panel__submit')).toBeEnabled()
  } finally {
    await contextoInvitado.close()
  }
})
