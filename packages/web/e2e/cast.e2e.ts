import { expect, test } from '@playwright/test'
import { entrar } from './fixtures'

interface CargaFalsa {
  readonly media: { readonly contentId: string; readonly contentType: string }
}

interface LlamadasFalsas {
  playOrPause: number
  seek: number
  setVolumeLevel: number
  muteOrUnmute: number
  endSession: number
}

/**
 * El cast de punta a punta, con un SDK falso y rutas de servidor falsas.
 *
 * La TV no entra en CI y el servidor de la suite no está en modo LAN. Lo que se
 * mide aquí es la **conversación de la interfaz**: que pida la sesión con el
 * ticket que ya usa, que mande la URL absoluta con su tipo, que los mandos
 * llamen al receptor y que al parar revoque la sesión y la URL deje de servir.
 * El camino real del servidor —ticket de 4 h, guards, `Range`— está medido en
 * `packages/server/src/routes/cast-session.test.ts`.
 */
test('transmitir: sesión, URL de LAN, mandos y parada', async ({ page }) => {
  let peticion: Record<string, unknown> | undefined
  let borrada = false
  let revocada = false

  await page.route('**/api/cast/info', async (ruta) => {
    await ruta.fulfill({
      json: { available: true, urls: ['http://127.0.0.1:7801'] },
    })
  })

  await page.route('**/api/cast/session', async (ruta) => {
    if (ruta.request().method() !== 'POST') {
      await ruta.continue()

      return
    }

    const cuerpo: unknown = ruta.request().postDataJSON()
    if (typeof cuerpo === 'object' && cuerpo !== null) {
      peticion = cuerpo as Record<string, unknown>
    }

    const kind = peticion?.kind === 'hls' ? 'hls' : 'file'
    await ruta.fulfill({
      json: {
        id: 'emision-1',
        kind,
        urls: ['http://127.0.0.1:7801/stream/cast-ticket'],
        expiresAt: Date.now() + 3_600_000,
        title: 'Aurora nocturna',
        subtitles: [],
      },
    })
  })

  await page.route('**/api/cast/session/**', async (ruta) => {
    borrada = true
    revocada = true
    await ruta.fulfill({ status: 204 })
  })

  await page.route('**/stream/cast-ticket', async (ruta) => {
    await ruta.fulfill({
      status: revocada ? 401 : 200,
      headers: { 'content-type': 'video/mp4' },
      body: 'cast-bytes',
    })
  })

  await page.addInitScript(() => {
    const ventana = window as unknown as {
      chrome?: unknown
      cast?: unknown
      __castLoad?: CargaFalsa
      __castCalls?: LlamadasFalsas
      __castRemote?: {
        isPaused: boolean
        currentTime: number
        duration: number
        volumeLevel: number
        isMuted: boolean
        playerState: string
      }
    }

    const llamadas: LlamadasFalsas = {
      playOrPause: 0,
      seek: 0,
      setVolumeLevel: 0,
      muteOrUnmute: 0,
      endSession: 0,
    }

    const remoto = {
      isPaused: true,
      currentTime: 0,
      duration: 60,
      volumeLevel: 0.5,
      isMuted: false,
      playerState: 'PAUSED',
    }

    const oyentes = new Map<string, Set<() => void>>()

    const controlador = {
      playOrPause: () => {
        llamadas.playOrPause += 1
        remoto.isPaused = !remoto.isPaused
        remoto.playerState = remoto.isPaused ? 'PAUSED' : 'PLAYING'
      },
      seek: () => {
        llamadas.seek += 1
      },
      setVolumeLevel: () => {
        llamadas.setVolumeLevel += 1
      },
      muteOrUnmute: () => {
        llamadas.muteOrUnmute += 1
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

    const sesion = {
      loadMedia: (peticion: { currentTime?: number; media: CargaFalsa['media'] }) => {
        ventana.__castLoad = { media: peticion.media }
        remoto.playerState = 'PLAYING'
        remoto.isPaused = false
        remoto.currentTime = peticion.currentTime ?? 0

        return Promise.resolve({})
      },
      endSession: () => {
        llamadas.endSession += 1
      },
      getCastDevice: () => ({ friendlyName: 'TV de prueba' }),
    }

    const contexto = {
      requestSession: () => Promise.resolve({}),
      getCurrentSession: () => sesion,
      setOptions: () => {},
    }

    function MediaInfo(this: Record<string, unknown>, contentId: string, contentType: string) {
      this.contentId = contentId
      this.contentType = contentType
      this.streamType = 'BUFFERED'
      this.tracks = []
      this.activeTrackIds = []
    }

    function LoadRequest(this: Record<string, unknown>, media: unknown) {
      this.media = media
      this.currentTime = 0
      this.autoplay = false
    }

    function crearMetadataFalsa(this: Record<string, unknown>) {
      void this
    }

    function crearRemotePlayer(this: unknown) {
      return remoto
    }

    function crearControlador(this: unknown) {
      return controlador
    }

    const media = {
      MediaInfo,
      LoadRequest,
      GenericMediaMetadata: crearMetadataFalsa,
      StreamType: { BUFFERED: 'BUFFERED' },
      DEFAULT_MEDIA_RECEIVER_APP_ID: 'CC1AD845',
    }

    ventana.chrome = { cast: { media } }
    ventana.cast = {
      framework: {
        CastContext: { getInstance: () => contexto },
        RemotePlayer: crearRemotePlayer,
        RemotePlayerController: crearControlador,
      },
    }
    ventana.__castCalls = llamadas
    ventana.__castRemote = remoto
  })

  await entrar(page)
  await page.goto('/watch/fixture/aurora-nocturna')

  const boton = page.locator('.player__cast')
  await expect(boton).toBeVisible({ timeout: 10_000 })
  await boton.click()

  const aviso = page.locator('.player__cast-notice')
  await expect(aviso).toContainText('Se está viendo en TV de prueba')
  await expect(aviso).toBeVisible()

  // La petición lleva el ticket del reproductor, no una URL absoluta.
  expect(peticion?.url).toMatch(/^\/stream\//)
  expect(['file', 'hls']).toContain(String(peticion?.kind))

  const carga = await page.evaluate(() => {
    const v = window as unknown as { __castLoad?: CargaFalsa }

    return v.__castLoad
  })

  expect(carga?.media.contentId).toBe('http://127.0.0.1:7801/stream/cast-ticket')
  expect(carga?.media.contentType).toBe(
    peticion?.kind === 'hls' ? 'application/vnd.apple.mpegurl' : 'video/mp4',
  )

  // La TV puede pedir esa URL aunque no tenga la cookie: la ruta falsa mide el
  // contrato del cliente y el servidor real lo mide su propia prueba.
  const recibido = await page.evaluate(async (url) => {
    const respuesta = await fetch(url)

    return { status: respuesta.status, texto: await respuesta.text() }
  }, carga?.media.contentId ?? '')

  expect(recibido.status).toBe(200)
  expect(recibido.texto).toBe('cast-bytes')

  await page.getByRole('button', { name: 'Pausar' }).click()
  await page.keyboard.press('ArrowRight')

  const llamadas = await page.evaluate(() => {
    const v = window as unknown as {
      __castCalls?: LlamadasFalsas
      __castRemote?: { currentTime: number }
    }

    return { ...v.__castCalls, posicion: v.__castRemote?.currentTime }
  })

  expect(llamadas.playOrPause).toBeGreaterThanOrEqual(1)
  expect(llamadas.seek).toBeGreaterThanOrEqual(1)
  expect(llamadas.posicion).toBeGreaterThan(0)

  await aviso.getByRole('button', { name: 'Dejar de transmitir' }).click()
  await expect(aviso).toBeHidden()
  expect(borrada).toBe(true)

  const finales = await page.evaluate(() => {
    const v = window as unknown as { __castCalls?: LlamadasFalsas }

    return v.__castCalls?.endSession
  })
  expect(finales).toBe(1)

  const revocadaRespuesta = await page.evaluate(async (url) => {
    const respuesta = await fetch(url)

    return respuesta.status
  }, carga?.media.contentId ?? '')
  expect(revocadaRespuesta).toBe(401)
})

/**
 * El encadenado automático (T395b).
 *
 * Al terminar un episodio, la pantalla navega al siguiente y el reproductor se
 * monta de nuevo. La sesión del receptor no se pierde: se pide un ticket nuevo
 * al servidor y se manda con `loadMedia` sobre la misma sesión, sin volver a
 * `requestSession`. Los contadores viven en `localStorage` porque la navegación
 * recarga la página y el guion falso vuelve a empezar.
 */
test('encadenar: el siguiente episodio reutiliza la sesión de la TV', async ({ page }) => {
  let altas = 0
  let borrados = 0

  await page.route('**/api/cast/info', async (ruta) => {
    await ruta.fulfill({ json: { available: true, urls: ['http://127.0.0.1:7801'] } })
  })

  await page.route('**/api/cast/session', async (ruta) => {
    if (ruta.request().method() !== 'POST') {
      await ruta.continue()

      return
    }

    altas += 1
    const cuerpo: unknown = ruta.request().postDataJSON()
    const kind =
      typeof cuerpo === 'object' && cuerpo !== null && 'kind' in cuerpo && cuerpo.kind === 'hls'
        ? 'hls'
        : 'file'

    await ruta.fulfill({
      json: {
        id: `emision-${altas}`,
        kind,
        urls: [`http://127.0.0.1:7801/stream/cast-ticket-${altas}`],
        expiresAt: Date.now() + 3_600_000,
        title: 'Aurora nocturna',
        subtitles: [],
      },
    })
  })

  await page.route('**/api/cast/session/**', async (ruta) => {
    borrados += 1
    await ruta.fulfill({ status: 204 })
  })

  await page.addInitScript(() => {
    const CLAVE_PETICIONES = 'cast:requestSession'
    const CLAVE_CARGAS = 'cast:loads'

    const ventana = window as unknown as {
      chrome?: unknown
      cast?: unknown
      __castRemote?: { isPaused: boolean; playerState: string }
      __castEmitir?: (evento: string) => void
    }

    const leerNumero = (clave: string): number => Number(localStorage.getItem(clave) ?? '0')
    const leerCargas = (): string[] => {
      const crudo = localStorage.getItem(CLAVE_CARGAS)

      return crudo === null ? [] : (JSON.parse(crudo) as string[])
    }

    const remoto = {
      isPaused: true,
      currentTime: 0,
      duration: 60,
      volumeLevel: 0.5,
      isMuted: false,
      playerState: 'PAUSED',
    }
    const oyentes = new Map<string, Set<() => void>>()

    const sesion = {
      loadMedia: (peticion: { currentTime?: number; media: { contentId: string } }) => {
        localStorage.setItem(
          CLAVE_CARGAS,
          JSON.stringify([...leerCargas(), peticion.media.contentId]),
        )
        remoto.playerState = 'PLAYING'
        remoto.isPaused = false
        remoto.currentTime = peticion.currentTime ?? 0

        return Promise.resolve({})
      },
      endSession: () => {},
      getCastDevice: () => ({ friendlyName: 'TV de prueba' }),
    }

    const controlador = {
      playOrPause: () => {},
      seek: () => {},
      setVolumeLevel: () => {},
      muteOrUnmute: () => {},
      addEventListener: (evento: string, oyente: () => void) => {
        const lista = oyentes.get(evento) ?? new Set()
        lista.add(oyente)
        oyentes.set(evento, lista)
      },
      removeEventListener: (evento: string, oyente: () => void) => {
        oyentes.get(evento)?.delete(oyente)
      },
    }

    const contexto = {
      requestSession: () => {
        localStorage.setItem(CLAVE_PETICIONES, String(leerNumero(CLAVE_PETICIONES) + 1))

        return Promise.resolve({})
      },
      getCurrentSession: () => sesion,
      setOptions: () => {},
    }

    function MediaInfo(this: Record<string, unknown>, contentId: string, contentType: string) {
      this.contentId = contentId
      this.contentType = contentType
      this.streamType = 'BUFFERED'
      this.tracks = []
      this.activeTrackIds = []
    }

    function LoadRequest(this: Record<string, unknown>, media: unknown) {
      this.media = media
      this.currentTime = 0
      this.autoplay = false
    }

    function crearMetadataFalsa(this: Record<string, unknown>) {
      void this
    }

    function crearRemotePlayer(this: unknown) {
      return remoto
    }

    function crearControlador(this: unknown) {
      return controlador
    }

    ventana.chrome = {
      cast: {
        media: {
          MediaInfo,
          LoadRequest,
          GenericMediaMetadata: crearMetadataFalsa,
          StreamType: { BUFFERED: 'BUFFERED' },
          DEFAULT_MEDIA_RECEIVER_APP_ID: 'CC1AD845',
        },
      },
    }
    ventana.cast = {
      framework: {
        CastContext: { getInstance: () => contexto },
        RemotePlayer: crearRemotePlayer,
        RemotePlayerController: crearControlador,
      },
    }
    ventana.__castRemote = remoto
    ventana.__castEmitir = (evento: string) => {
      for (const oyente of oyentes.get(evento) ?? []) oyente()
    }
  })

  await entrar(page)
  await page.goto('/watch/fixture/aurora-nocturna?n=1')

  await page.locator('.player__cast').click()
  const aviso = page.locator('.player__cast-notice')
  await expect(aviso).toContainText('Se está viendo en TV de prueba')

  // El receptor dice que terminó: la pantalla cuenta ocho segundos y navega.
  await page.evaluate(() => {
    const v = window as unknown as {
      __castRemote?: { playerState: string; isPaused: boolean }
      __castEmitir?: (evento: string) => void
    }

    if (v.__castRemote === undefined) return

    v.__castRemote.playerState = 'PLAYING'
    v.__castRemote.isPaused = false
    v.__castEmitir?.('playerStateChanged')
    v.__castRemote.playerState = 'IDLE'
    v.__castEmitir?.('playerStateChanged')
  })

  await expect.poll(() => page.url(), { timeout: 30_000 }).toContain('n=2')

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const crudo = localStorage.getItem('cast:loads')

          return crudo === null ? 0 : (JSON.parse(crudo) as string[]).length
        }),
      { timeout: 20_000 },
    )
    .toBe(2)

  const resultado = await page.evaluate(() => {
    const cargas = JSON.parse(localStorage.getItem('cast:loads') ?? '[]') as string[]

    return {
      peticiones: Number(localStorage.getItem('cast:requestSession') ?? '0'),
      cargas,
    }
  })

  expect(resultado.peticiones).toBe(1)
  expect(resultado.cargas[0]).toContain('/stream/cast-ticket-1')
  expect(resultado.cargas[1]).toContain('/stream/cast-ticket-2')
  expect(borrados).toBe(1)

  // El aviso sigue y la posición del mando es la del episodio nuevo.
  await expect(page.locator('.player__cast-notice')).toContainText('Se está viendo en TV de prueba')
  expect(altas).toBe(2)
})
