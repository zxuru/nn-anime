/**
 * El watch party, con dos sesiones de navegador.
 *
 * El hueco U11 de la Oleada 7: el anfitrión crea la sala desde la pantalla de
 * reproducción, el invitado entra con la dirección y el código, se ve el
 * invitado en el roster y una pausa del anfitrión para al invitado. Se mide lo
 * que los dos pueden observar sin mirar por dentro:
 *
 * 1. El código que enseña el invitado es el de la sala a la que entró.
 * 2. El alta del invitado llega al anfitrión por su flujo de eventos; el
 *    invitado se ve a sí mismo en el roster.
 * 3. El invitado adopta el episodio y arranca solo cuando el anfitrión
 *    reproduce: no hay un clic paralelo en su pestaña.
 * 4. Al pausar el anfitrión, el `<video>` del invitado se para. Es el gesto que
 *    el protocolo sincroniza de verdad: `useParty` publica `play`/`pause` del
 *    elemento del anfitrión y aplica la corrección al del invitado.
 * 5. La píldora del invitado llega a «Sincronizado», que es la señal de que la
 *    medición del reloj terminó y la deriva está dentro del tramo bueno.
 *
 * El roster **no incluye al anfitrión**: `PartyStore` sólo da de alta a los
 * invitados, así que el anfitrión no tiene nombre ni entrada. Por eso aquí se
 * comprueba el nombre del invitado en los dos paneles y no «los dos nombres»;
 * el hueco es de producto y queda anotado en el informe.
 *
 * Los dos contextos son dos sesiones de navegador distintas, pero **una sola
 * instancia del servidor**: el invitado entra con la dirección de este mismo
 * arnés y su servidor hace de puente contra él, igual que en una LAN. Lo que no
 * se prueba aquí es el despliegue de dos procesos: el protocolo, el SSE y la
 * corrección son los mismos.
 */

import { expect, type Page, test } from '@playwright/test'
import { BASE, entrar, RUTA_ESTADO } from './fixtures'

const EPISODIO = '/watch/fixture/aurora-nocturna%233?anime=aurora-nocturna'
const INVITADA = 'Invitada'

/** Si el `<video>` de la página está en pausa, leído del elemento de verdad. */
function enPausa(page: Page): Promise<boolean> {
  return page.locator('video').evaluate((video: HTMLVideoElement) => video.paused)
}

/** El segundo en el que va el `<video>`, leído del elemento de verdad. */
function posicion(page: Page): Promise<number> {
  return page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)
}

/** Entra al episodio y abre el panel de la sala. */
async function abrirPanelDeSala(page: Page): Promise<void> {
  await entrar(page)
  await page.goto(EPISODIO)

  await expect(page.locator('video')).toHaveAttribute('src', /\/stream\//, { timeout: 15_000 })
  // La barra habilitada es la señal de que el elemento ya trajo la duración: con
  // el medio a medias, la corrección de la sala no tendría contra qué colocarse.
  await expect(page.locator('.player__seek .player__range')).toBeEnabled({ timeout: 15_000 })

  // El mando sólo se pinta cuando `/api/health` confirma que la sala está
  // montada. Esperar aquí es lo que ata la prueba al arranque con `RONA_PARTY=1`.
  const abrir = page.getByRole('button', { name: 'Ver juntos' })
  await expect(abrir).toBeVisible({ timeout: 10_000 })
  await abrir.click()

  await expect(page.getByRole('dialog', { name: 'Sala de visionado' })).toBeVisible()
}

/** Cierra el panel y espera a que desaparezca del documento. */
async function cerrarPanelDeSala(page: Page): Promise<void> {
  await page.locator('.party-panel__close').click()
  await expect(page.getByRole('dialog', { name: 'Sala de visionado' })).toHaveCount(0)
}

test('el anfitrión crea la sala, el invitado entra y la pausa se sincroniza', async ({
  page,
  browser,
}) => {
  // La medición del reloj son cinco idas y vueltas, hay dos reproductores
  // cargando y la corrección del invitado va a ticks de medio segundo. El
  // límite por defecto se queda corto y subirlo aquí es más honesto que un
  // `waitForTimeout` largo en medio del flujo.
  test.setTimeout(120_000)

  const anfitrion = page

  // --- El anfitrión abre la sala -----------------------------------------
  await abrirPanelDeSala(anfitrion)

  const crear = anfitrion.locator('.party-panel__submit')
  await expect(crear).toBeEnabled({ timeout: 10_000 })
  await crear.click()

  const codigo = anfitrion.locator('.party-panel__code')
  await expect(codigo).toHaveText(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/, { timeout: 15_000 })
  const codigoDeLaSala = ((await codigo.textContent()) ?? '').trim()
  expect(codigoDeLaSala).not.toBe('')

  // --- El invitado entra con ese código -----------------------------------
  // Otra sesión de navegador, con el estado que dejó el canje del token: el
  // token de arranque es de un solo uso, así que el contexto del invitado
  // reutiliza la cookie guardada. La bandeja y la pestaña son suyas.
  const contextoInvitado = await browser.newContext({ storageState: RUTA_ESTADO })
  const invitado = await contextoInvitado.newPage()

  try {
    await abrirPanelDeSala(invitado)

    await invitado.locator('.party-panel__tab').filter({ hasText: 'Unirse' }).click()
    await invitado.getByLabel('Dirección del anfitrión').fill(BASE)
    await invitado.getByLabel('Código de la sala').fill(codigoDeLaSala)
    await invitado.getByLabel('Tu nombre').fill(INVITADA)
    await invitado.locator('.party-panel__submit').click()

    // El código que enseña el invitado es el de la sala a la que entró, no el
    // que tecleó: lo pone el panel con la respuesta del join.
    await expect(invitado.locator('.party-panel__code')).toHaveText(codigoDeLaSala, {
      timeout: 15_000,
    })
    await expect(invitado.locator('.party-panel__roster-name')).toContainText(INVITADA)

    // El alta llega al anfitrión por su flujo de eventos, no por una recarga:
    // si el SSE del anfitrión no entregara el roster, esto se queda esperando.
    // El anfitrión no aparece en la lista: el store sólo da de alta invitados.
    await expect(anfitrion.locator('.party-panel__roster-name')).toContainText(INVITADA, {
      timeout: 15_000,
    })

    // --- La barra dice quién manda ----------------------------------------
    await cerrarPanelDeSala(anfitrion)
    await cerrarPanelDeSala(invitado)

    const pildoraAnfitrion = anfitrion.locator('.party-bar__pill')
    await expect(pildoraAnfitrion).toHaveAttribute('data-sync', 'host')
    await expect(pildoraAnfitrion).toHaveText('Coordinando la sala.')
    await expect(invitado.locator('.party-bar__notice')).toHaveText(
      'El anfitrión controla la reproducción.',
    )

    // El invitado conoce el episodio del anfitrión: la sala sólo manda su forma
    // pequeña —título, temporada y episodio—, no la fuente ni el ticket.
    await expect(invitado.locator('.party-bar__media')).toContainText('Aurora Nocturna', {
      timeout: 15_000,
    })

    // --- Reproducir en el anfitrión arranca al invitado ---------------------
    // Los dos mudos: el invitado reproduce por una llamada de la corrección, no
    // por un clic suyo, y el sonido no aporta nada a la medida.
    await anfitrion.getByRole('button', { name: 'Silenciar' }).click()
    await invitado.getByRole('button', { name: 'Silenciar' }).click()

    await anfitrion.getByRole('button', { name: 'Reproducir' }).click()
    await expect.poll(async () => await enPausa(anfitrion), { timeout: 10_000 }).toBe(false)

    // El invitado no pulsa «Reproducir»: lo arranca la corrección al adoptar el
    // estado `paused: false` del anfitrión.
    await expect.poll(async () => await enPausa(invitado), { timeout: 20_000 }).toBe(false)

    // La píldora sólo pasa a «Sincronizado» cuando la medición del reloj ya
    // terminó; con «Midiendo…» la corrección ni siquiera se aplica.
    await expect(invitado.locator('.party-bar__pill')).toHaveAttribute('data-sync', 'ok', {
      timeout: 15_000,
    })

    // Que el invitado vaya avanzando, no sólo «no pausado» en el segundo cero.
    await expect
      .poll(async () => await posicion(invitado), { timeout: 15_000 })
      .toBeGreaterThan(0.5)

    // --- Pausar en el anfitrión para al invitado ---------------------------
    // Los mandos se esconden a los tres segundos de reproducir y con ellos el
    // puntero: se devuelven pasando por el marco, que es lo que hace una mano.
    await anfitrion.locator('.player__stage').hover()
    await expect(anfitrion.locator('.player__controls')).toHaveCSS('opacity', '1')
    await anfitrion.getByRole('button', { name: 'Pausar' }).click()

    await expect.poll(async () => await enPausa(anfitrion), { timeout: 10_000 }).toBe(true)

    // La medida central: el `<video>` del invitado se para por el estado del
    // anfitrión. Antes se comprobó que estaba reproduciendo, así que no es una
    // pausa que ya estuviera ahí.
    await expect.poll(async () => await enPausa(invitado), { timeout: 10_000 }).toBe(true)

    // Con los dos quietos, la deriva se asienta y la píldora lo dice.
    await expect(invitado.locator('.party-bar__pill')).toHaveAttribute('data-sync', 'ok', {
      timeout: 10_000,
    })

    // Y el invitado se quedó donde el anfitrión pausó, no donde iba él: dos
    // segundos de holgura cubren el viaje del evento y el tick de corrección.
    const [posicionAnfitrion, posicionInvitado] = await Promise.all([
      posicion(anfitrion),
      posicion(invitado),
    ])
    expect(Math.abs(posicionInvitado - posicionAnfitrion)).toBeLessThanOrEqual(2)
  } finally {
    await contextoInvitado.close()
  }
})
