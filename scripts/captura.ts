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
await pagina.waitForTimeout(1200)

for (const [tema, destino] of [
  ['dark', DESTINO],
  ['light', DESTINO_CLARO],
] as const) {
  await pagina.evaluate((valor: string) => {
    document.documentElement.dataset.theme = valor
  }, tema)

  await mkdir(dirname(destino), { recursive: true })
  await pagina.screenshot({ path: destino, fullPage: false })
  console.log(`captura ${tema} en ${destino}`)
}

await navegador.close()
