import { expect, test } from '@playwright/test'
import { entrar } from './fixtures'

/**
 * AirPlay de punta a punta, con un doble de `HTMLMediaElement.remote`.
 *
 * La TV de Apple no entra en CI. Lo que se mide es la conversación de la
 * interfaz: que el mando exista sólo con la puerta abierta, que la sesión se pida
 * al servidor, que el `<video>` oculto reciba la **URL absoluta** de la emisión,
 * que el video local se pause y que al parar se revoque la sesión y se reanude.
 * La medida física con un Apple TV queda declarada en `docs/cast.md`.
 */
test('AirPlay: mando, URL absoluta, video local e ingreso', async ({ page }) => {
  let peticion: Record<string, unknown> | undefined
  let borrada = false

  await page.route('**/api/cast/info', async (ruta) => {
    await ruta.fulfill({ json: { available: true, urls: ['http://127.0.0.1:7801'] } })
  })

  await page.route('**/api/cast/session', async (ruta) => {
    if (ruta.request().method() !== 'POST') {
      await ruta.continue()

      return
    }

    const cuerpo: unknown = ruta.request().postDataJSON()
    if (typeof cuerpo === 'object' && cuerpo !== null) peticion = cuerpo as Record<string, unknown>

    await ruta.fulfill({
      json: {
        id: 'airplay-1',
        kind: 'file',
        urls: ['http://127.0.0.1:7801/stream/airplay-ticket'],
        expiresAt: Date.now() + 3_600_000,
        title: 'Aurora nocturna',
        subtitles: [],
      },
    })
  })

  await page.route('**/api/cast/session/**', async (ruta) => {
    borrada = true
    await ruta.fulfill({ status: 204 })
  })

  await page.addInitScript(() => {
    const oyentes = new Map<string, Set<() => void>>()
    const remoto = {
      state: 'disconnected',
      prompt: () => {
        remoto.state = 'connected'
        for (const oyente of oyentes.get('statechange') ?? []) oyente()

        return Promise.resolve()
      },
      addEventListener: (evento: string, oyente: () => void) => {
        const lista = oyentes.get(evento) ?? new Set()
        lista.add(oyente)
        oyentes.set(evento, lista)
      },
      removeEventListener: (evento: string, oyente: () => void) => {
        oyentes.get(evento)?.delete(oyente)
      },
    }

    Object.defineProperty(HTMLMediaElement.prototype, 'remote', {
      configurable: true,
      get: () => remoto,
    })

    // Sin pista de verdad no hay `play` que resuelva; el doble dice que sí para
    // que el flujo llegue al `prompt` sin depender de un archivo de vídeo.
    const pausas = new WeakMap<HTMLMediaElement, boolean>()
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      get() {
        return pausas.get(this) ?? true
      },
    })
    HTMLMediaElement.prototype.play = function reproducir() {
      pausas.set(this, false)
      this.dispatchEvent(new Event('play'))

      return Promise.resolve()
    }
    HTMLMediaElement.prototype.pause = function pausar() {
      pausas.set(this, true)
      this.dispatchEvent(new Event('pause'))
    }
  })

  await entrar(page)
  await page.goto('/watch/fixture/aurora-nocturna?n=1')

  const boton = page.locator('.player__airplay')
  await expect(boton).toBeVisible({ timeout: 10_000 })
  await expect(boton).toHaveAttribute('aria-label', 'Transmitir por AirPlay')

  await boton.click()

  const aviso = page.locator('.player__cast-notice')
  await expect(aviso).toContainText('Se está viendo por AirPlay')

  // El ticket viaja como ruta del proxy: el servidor no acepta una URL elegida
  // por el cliente. La URL absoluta la construye él.
  expect(peticion?.url).toMatch(/^\/stream\//)

  const estado = await page.evaluate(() => {
    const videos = [...document.querySelectorAll('video')]
    const oculto = videos.find((video) => video.className === '')
    const local = document.querySelector('.player__video')

    return {
      oculto: oculto?.getAttribute('src') ?? null,
      localPausado: local instanceof HTMLVideoElement ? local.paused : null,
      videos: videos.length,
    }
  })

  expect(estado.oculto).toBe('http://127.0.0.1:7801/stream/airplay-ticket')
  expect(estado.localPausado).toBe(true)
  expect(estado.videos).toBe(2)

  await aviso.getByRole('button', { name: 'Dejar de transmitir' }).click()
  await expect(aviso).toBeHidden()
  expect(borrada).toBe(true)

  const despues = await page.evaluate(() => {
    const videos = [...document.querySelectorAll('video')]
    const local = document.querySelector('.player__video')

    return {
      oculto: videos.filter((video) => video.className === '').length,
      localPausado: local instanceof HTMLVideoElement ? local.paused : null,
    }
  })

  expect(despues.oculto).toBe(0)
  expect(despues.localPausado).toBe(false)
})
