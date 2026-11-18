/**
 * La biblioteca, sin red: un episodio descargado se abre, avanza, se recarga y
 * se reanuda desde el almacén del navegador.
 *
 * Lo que mide este spec, y por qué no lo medía `downloads.e2e.ts`: allí el
 * contexto tiene red; aquí se apaga con `context.setOffline(true)` y se comprueba
 * que el `<video>` sigue reproduciendo y que al recargar la pantalla vuelve al
 * segundo guardado **sin pedirle el stream al proveedor**.
 *
 * **Qué se sirve y de dónde.** Una descarga completa es un archivo en disco; en
 * la aplicación real lo sirve el propio servidor local por
 * `/api/downloads/:id/file`, que no necesita internet. Aquí no hay una descarga
 * de verdad —el motor bajaría del proveedor del fixture, que no resuelve—, así
 * que la copia se dobla con `page.route`: la ficha de la descarga sale de un
 * `DownloadItem` completo y el archivo, del WAV de un minuto que el arnés ya
 * sirve en su puerto de medios. El doble se registra **antes** de desconectar y
 * sus `fulfill` no usan la red, así que con el contexto offline sigue habiendo
 * algo que leer: es la copia en disco.
 *
 * **El armazón.** Un `reload()` con el navegador offline no puede pedir el HTML
 * —el servidor lo manda con `no-store`—, y sin HTML no hay aplicación que
 * recargar. El armazón se captura en la primera visita, con la red encendida, y
 * se vuelve a servir desde memoria: es la aplicación ya instalada, que en el
 * escritorio viaja con el binario y no se descarga. Lo mismo con sus recursos
 * con hash. Cualquier otra petición —las de la API, las del proveedor— no tiene
 * copia: con la red apagada, si alguien las pidiera, fallarían.
 *
 * **Qué NO se mide.** No se ejercita el motor de descarga (para eso está su
 * prueba de cola), ni la conversión de segmentos a MP4, ni la red real del
 * proveedor: el fixture no tiene ninguna. Tampoco se prueba un MP4: Chromium sin
 * códecs no decodifica H.264, y el arnés reproduce un WAV para medir el
 * mecanismo del reproductor —que la fuente llega, que el tiempo avanza y que
 * reanuda—, no el códec. Y no se recarga contra el servidor: el documento viene
 * de la copia capturada, que es lo que un equipo sin conexión tiene.
 */

import { expect, test } from '@playwright/test'
import { entrar } from './fixtures'

/** El puerto donde `scripts/e2e-server.ts` sirve el WAV del arnés. */
const PUERTO_MEDIOS = Number(process.env.RONA_E2E_MEDIA_PORT ?? '7902')
const TONO = `http://127.0.0.1:${PUERTO_MEDIOS}/tono.wav`

/**
 * La clave del progreso local de la descarga.
 *
 * La escribe `LibraryPlayerPage` con `guardarProgreso`; es la misma que usa el
 * reproductor del proveedor para el episodio, porque para el resto de la
 * aplicación es el mismo capítulo. Aquí sólo se lee: el test no la escribe, o
 * mediría su propia escritura en vez de la del reproductor.
 */
const CLAVE = 'rona:progreso:fixture:aurora-nocturna#1'

/** La fila que devuelve el servidor cuando la descarga ya está completa. */
const DESCARGA = {
  id: 1,
  providerId: 'fixture',
  animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
  episodeRef: { providerId: 'fixture', value: 'aurora-nocturna#1' },
  title: 'Aurora Nocturna',
  episodeLabel: 'Episodio 1',
  mode: 'sub',
  kind: 'file',
  status: 'complete',
  bytes: 1_000_044,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as const

interface Copia {
  readonly status: number
  readonly headers: Record<string, string>
  readonly body: Buffer
}

/**
 * El trozo que pide el navegador, acotado al archivo.
 *
 * Se atiende el `Range` de verdad y no se devuelve siempre el archivo entero:
 * un elemento al que se le miente sobre lo que admite queda sin `seekable`, y
 * entonces reanudar no se puede medir —saltaría a una posición que no existe—.
 * Es el mismo criterio que el servidor de medios del arnés.
 */
function recortarTono(tono: Buffer, cabecera: string | undefined): Copia {
  const total = tono.byteLength
  const completos = {
    'accept-ranges': 'bytes',
    'content-type': 'audio/wav',
    'content-length': String(total),
  }
  const coincidencia = /^bytes=(\d*)-(\d*)$/.exec(cabecera?.trim() ?? '')

  if (coincidencia === null) return { status: 200, headers: completos, body: tono }

  const [, crudoDesde = '', crudoHasta = ''] = coincidencia
  const desde = crudoDesde === '' ? Math.max(total - Number(crudoHasta), 0) : Number(crudoDesde)
  const hasta =
    crudoDesde === '' || crudoHasta === '' ? total - 1 : Math.min(Number(crudoHasta), total - 1)

  if (
    !Number.isInteger(desde) ||
    !Number.isInteger(hasta) ||
    desde < 0 ||
    desde >= total ||
    hasta < desde
  ) {
    return { status: 200, headers: completos, body: tono }
  }

  const cuerpo = tono.subarray(desde, hasta + 1)

  return {
    status: 206,
    headers: {
      'accept-ranges': 'bytes',
      'content-type': 'audio/wav',
      'content-range': `bytes ${desde}-${hasta}/${total}`,
      'content-length': String(cuerpo.byteLength),
    },
    body: cuerpo,
  }
}

test('un episodio descargado se reanuda con el navegador sin red', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(90_000)

  // El WAV del arnés, leído una vez mientras hay red. A partir de aquí, el
  // archivo viaja en memoria: es la copia que estaría en el disco.
  const respuesta = await request.get(TONO)
  expect(respuesta.ok()).toBe(true)
  const tono = await respuesta.body()

  /**
   * El armazón ya instalado, capturado en la primera visita.
   *
   * Sólo se copian documentos, guiones, hojas, imágenes y fuentes: lo que viaja
   * con la aplicación. Las llamadas de la API y del proveedor no se copian a
   * propósito, para que ninguna se cuele por aquí y la prueba diga la verdad
   * cuando afirma que sin red no se pide nada.
   */
  const ARMAZON = new Set([
    'document',
    'script',
    'stylesheet',
    'image',
    'font',
    'manifest',
    'other',
  ])
  const copias = new Map<string, Copia>()
  let desconectado = false

  // El comodín va primero: Playwright evalúa las rutas al revés de como se
  // registran, así que las concretas —la API y el archivo— corren antes y esta
  // sólo atiende lo que no es de nadie.
  await page.route('**/*', async (ruta) => {
    if (!ARMAZON.has(ruta.request().resourceType())) return ruta.fallback()

    const url = ruta.request().url()
    const copia = copias.get(url)

    if (copia !== undefined) {
      await ruta.fulfill({ status: copia.status, headers: copia.headers, body: copia.body })
      return
    }

    // Sin copia y sin red no hay nada que servir: se corta en el acto en vez de
    // dejar que la petición espere a un tiempo de espera que no va a llegar.
    if (desconectado) return ruta.abort('internetdisconnected')

    const original = await ruta.fetch()
    const tipo = original.headers()['content-type']
    const cuerpo = await original.body()
    const cabeceras = tipo === undefined ? {} : { 'content-type': tipo }

    copias.set(url, { status: original.status(), headers: cabeceras, body: cuerpo })
    await ruta.fulfill({ status: original.status(), headers: cabeceras, body: cuerpo })
  })

  /** Cuántas veces el navegador pidió el archivo a la copia local. */
  const peticionesDelArchivo: string[] = []

  await page.route('**/api/downloads/1/file', async (ruta) => {
    const cabecera = ruta.request().headers().range
    peticionesDelArchivo.push(cabecera ?? 'sin-rango')

    const trozo = recortarTono(tono, cabecera)

    await ruta.fulfill({ status: trozo.status, headers: trozo.headers, body: trozo.body })
  })

  await page.route('**/api/downloads/1', async (ruta) => {
    if (ruta.request().method() !== 'GET') return ruta.fallback()

    await ruta.fulfill({ json: DESCARGA })
  })

  await page.route('**/api/downloads/space', async (ruta) => {
    await ruta.fulfill({
      json: { path: 'C:\\Descargas', freeBytes: 1, totalBytes: 2, downloadsBytes: 3 },
    })
  })

  await page.route('**/api/downloads', async (ruta) => {
    if (ruta.request().method() !== 'GET') return ruta.fallback()

    await ruta.fulfill({ json: { items: [DESCARGA] } })
  })

  // Si el reproductor pidiera el stream, esto lo contaría; con una copia
  // completa no debe ni intentarlo.
  let pidioElProveedor = 0
  await page.route('**/api/stream/resolve', async (ruta) => {
    pidioElProveedor += 1
    await ruta.fulfill({ status: 502, json: { error: 'no debería pedirse' } })
  })

  /** Peticiones a un anfitrión de proveedor, por si alguna se saltara la API. */
  const alProveedor: string[] = []
  page.on('request', (peticion) => {
    const anfitrion = new URL(peticion.url()).hostname

    if (anfitrion.endsWith('fixture.invalid')) alProveedor.push(peticion.url())
  })

  // --- Con red: abrir el episodio descargado ------------------------------

  await entrar(page)
  await page.goto('/library/1')

  const video = page.locator('video')
  await expect(video).toHaveAttribute('src', '/api/downloads/1/file', { timeout: 15_000 })

  // Los metadatos: sin duración no hay barra y no se puede medir nada. El WAV
  // del arnés dura un minuto, justo por encima del mínimo para reanudar.
  const duracion = async (): Promise<number> =>
    await video.evaluate((elemento: HTMLVideoElement) => elemento.duration)
  await expect.poll(duracion, { timeout: 20_000 }).toBeGreaterThan(55)

  // --- Sin red: reproducir, avanzar y apuntarlo ---------------------------

  await context.setOffline(true)
  desconectado = true
  expect(await page.evaluate(() => navigator.onLine)).toBe(false)

  // La reproducción arranca y el reloj avanza con la red apagada: los trozos
  // salen de la copia del archivo, no del proveedor.
  await page.getByRole('button', { name: 'Reproducir' }).click()

  const posicion = async (): Promise<number> =>
    await video.evaluate((elemento: HTMLVideoElement) => elemento.currentTime)
  await expect.poll(posicion, { timeout: 15_000 }).toBeGreaterThan(1)

  await page.getByRole('button', { name: 'Pausar' }).click()

  // Avanzar con el mando de la barra, que es el gesto de verdad. Al pausar
  // después, el reproductor guarda la posición en el acto: es la misma escritura
  // que hace al salir de la pantalla.
  await page.getByRole('slider', { name: 'Posición del video' }).fill('30')
  await expect.poll(posicion, { timeout: 10_000 }).toBeGreaterThan(29)

  await page.getByRole('button', { name: 'Reproducir' }).click()
  await expect.poll(posicion, { timeout: 15_000 }).toBeGreaterThan(30.5)
  await page.getByRole('button', { name: 'Pausar' }).click()

  /** Lo que el reproductor apuntó en el almacén del navegador. */
  const apuntado = async (): Promise<{ positionS: number; durationS: number } | undefined> =>
    await page.evaluate((clave) => {
      const crudo = localStorage.getItem(clave)

      return crudo === null
        ? undefined
        : (JSON.parse(crudo) as { positionS: number; durationS: number })
    }, CLAVE)

  await expect
    .poll(async () => (await apuntado())?.positionS ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(30)

  const antesDeRecargar = await apuntado()
  expect(antesDeRecargar?.durationS).toBeGreaterThan(55)

  // --- Sin red: recargar la pantalla y volver al segundo guardado ---------

  await page.reload()

  // Que el contexto siga offline no es un detalle: si la recarga lo levantara,
  // lo que sigue se estaría midiendo con la red encendida.
  expect(await page.evaluate(() => navigator.onLine)).toBe(false)

  await expect(page.locator('video')).toHaveAttribute('src', '/api/downloads/1/file', {
    timeout: 20_000,
  })
  await expect.poll(duracion, { timeout: 20_000 }).toBeGreaterThan(55)

  // La reanudación retrocede unos segundos para dar contexto
  // —`RETROCESO_REANUDAR_S`—, así que se comprueba que vuelve cerca de la
  // posición guardada y nunca al segundo cero.
  const reanudado = async (): Promise<number> =>
    await page.locator('video').evaluate((elemento: HTMLVideoElement) => elemento.currentTime)

  await expect
    .poll(reanudado, { timeout: 20_000 })
    .toBeGreaterThan((antesDeRecargar?.positionS ?? 0) - 4)
  expect(await reanudado()).toBeLessThan((antesDeRecargar?.positionS ?? 0) + 1)

  // Y sigue avanzando desde ahí, sin red.
  const alReanudar = await reanudado()
  await page.getByRole('button', { name: 'Reproducir' }).click()
  await expect.poll(reanudado, { timeout: 15_000 }).toBeGreaterThan(alReanudar + 1)
  await page.getByRole('button', { name: 'Pausar' }).click()

  // --- Sin red: volver a la biblioteca y abrirlo otra vez -----------------

  await page.locator('.library-player__back').click()
  await expect(page).toHaveURL(/\/library$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Biblioteca' })).toBeVisible()
  await expect(page.getByText('Aurora Nocturna').first()).toBeVisible()

  // La posición de salida es la de esta visita —la reanudada más lo que se
  // reprodujo—, no la de antes de recargar: reanudar retrocede tres segundos a
  // propósito, y compararla con la de antes leería ese retroceso como una
  // pérdida del sitio.
  const antesDeVolver = await apuntado()
  expect(antesDeVolver?.positionS ?? 0).toBeGreaterThan(alReanudar)

  await page.getByRole('link', { name: /Episodio 1/ }).click()
  await expect(page).toHaveURL(/\/library\/1$/)
  await expect(page.locator('video')).toHaveAttribute('src', '/api/downloads/1/file', {
    timeout: 20_000,
  })

  const reanudadoOtraVez = async (): Promise<number> =>
    await page.locator('video').evaluate((elemento: HTMLVideoElement) => elemento.currentTime)

  await expect
    .poll(reanudadoOtraVez, { timeout: 20_000 })
    .toBeGreaterThan((antesDeVolver?.positionS ?? 0) - 4)

  // --- Que no se haya pedido nada al proveedor ---------------------------

  expect(pidioElProveedor).toBe(0)
  expect(alProveedor).toEqual([])
  // El archivo se pidió, y se sirvió: la reproducción no fue un fotograma
  // congelado. Incluye las peticiones de después de la recarga.
  expect(peticionesDelArchivo.length).toBeGreaterThan(0)
})
