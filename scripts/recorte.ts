/**
 * Un recorte de una zona de la home, para comparar con un diseño.
 *
 * Se le pasa el selector y saca la captura de ese elemento: comparar el top de
 * la semana a página entera es comparar a ciegas.
 */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { chromium } from '@playwright/test'

const PORT = Number(process.env.NN_ANIME_E2E_PORT ?? '7801')
const SELECTOR = process.env.NN_ANIME_RECORTE ?? '.section--top'
const DESTINO = process.env.NN_ANIME_RECORTE_SALIDA ?? 'docs/recorte.png'
const token = (await readFile('.tmp/e2e-boot-token', 'utf8')).trim()

const navegador = await chromium.launch({ args: ['--mute-audio'] })
const contexto = await navegador.newContext({
  viewport: { width: 1360, height: 900 },
  colorScheme: 'dark',
})
const pagina = await contexto.newPage()

await pagina.goto(`http://127.0.0.1:${PORT}/?boot=${token}`)
await pagina.waitForLoadState('networkidle')
await pagina.goto(`http://127.0.0.1:${PORT}/anime/fixture/aurora-nocturna`)
await pagina.waitForTimeout(1200)
await pagina.goto(`http://127.0.0.1:${PORT}/`)
// La sección existe antes que sus datos: sin esperar a las tarjetas, el recorte
// sale con el estado vacío y no con el top. Lo encontró el primer recorte.
await pagina.waitForSelector(`${SELECTOR} .pz__enlace`, { timeout: 15_000 })
await pagina.waitForTimeout(1200)

await mkdir(dirname(DESTINO), { recursive: true })
await pagina.locator(SELECTOR).first().screenshot({ path: DESTINO })
await navegador.close()
console.log(`recorte de ${SELECTOR} en ${DESTINO}`)
