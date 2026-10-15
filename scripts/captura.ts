/**
 * Las capturas de la home, para el README: tema oscuro y tema claro.
 *
 * Se hacen con el arnés del e2e —servidor con el fixture, base temporal y la
 * excepción de loopback— porque una captura hecha a mano envejece sin que nadie
 * se entere: éstas se pueden volver a hacer con un comando.
 *
 * **El token de arranque es de un solo uso**, así que las dos capturas se hacen
 * en la misma sesión: la segunda cambia el atributo del tema a mano. Intentarlo
 * con dos navegadores daba una segunda captura en blanco, con un 401, porque el
 * token ya estaba gastado.
 */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { chromium } from '@playwright/test'

const PORT = Number(process.env.NN_ANIME_E2E_PORT ?? '7801')
const DESTINO = process.env.NN_ANIME_CAPTURA ?? 'docs/captura.png'
const DESTINO_CLARO = process.env.NN_ANIME_CAPTURA_CLARO ?? 'docs/captura-claro.png'
const token = (await readFile('.tmp/e2e-boot-token', 'utf8')).trim()

const navegador = await chromium.launch({ args: ['--mute-audio'] })
const contexto = await navegador.newContext({
  viewport: { width: 1280, height: 800 },
  colorScheme: 'dark',
})
const pagina = await contexto.newPage()

await pagina.goto(`http://127.0.0.1:${PORT}/?boot=${token}`)
await pagina.waitForLoadState('networkidle')

// Se abre una ficha antes de la captura: sin títulos en la base, la home no
// tiene géneros ni continuar viendo, y la captura saldría a medio poblar. Es lo
// que hace cualquiera al estrenar la aplicación.
await pagina.goto(`http://127.0.0.1:${PORT}/anime/fixture/aurora-nocturna`)
await pagina.waitForTimeout(1500)
await pagina.goto(`http://127.0.0.1:${PORT}/`)
// La home carga sus filas por detrás: sin esta espera, la cinta y las piezas
// salen vacías en la captura. Lo encontró la primera captura del rediseño.
await pagina.waitForSelector('.pz__enlace', { timeout: 15_000 }).catch(() => {})
await pagina.waitForTimeout(1500)

for (const [tema, destino] of [
  ['dark', DESTINO],
  ['light', DESTINO_CLARO],
] as const) {
  await pagina.evaluate((valor: string) => {
    document.documentElement.dataset.theme = valor
  }, tema)

  await mkdir(dirname(destino), { recursive: true })
  // Página entera: la captura del rediseño recortada a la ventana no enseñaba
  // ni el top ni las filas, que es lo que había que revisar.
  await pagina.screenshot({ path: destino, fullPage: true })
  console.log(`captura ${tema} en ${destino}`)
}

await navegador.close()
