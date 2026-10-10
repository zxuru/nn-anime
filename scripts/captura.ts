/**
 * Una captura de la home, para el README.
 *
 * Se hace con el arnés del e2e —servidor con el fixture, base temporal y la
 * excepción de loopback— porque una captura hecha a mano envejece sin que nadie
 * se entere: ésta se puede volver a hacer con un comando.
 *
 * `bun run captura` con el servidor del e2e ya levantado, o con
 * `PLAYWRIGHT_BROWSERS_PATH` puesto como en el e2e.
 */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { chromium } from '@playwright/test'

const PORT = Number(process.env.NN_ANIME_E2E_PORT ?? '7801')
const DESTINO = process.env.NN_ANIME_CAPTURA ?? 'docs/captura.png'
const token = (await readFile('.tmp/e2e-boot-token', 'utf8')).trim()

const navegador = await chromium.launch({ args: ['--mute-audio'] })
const contexto = await navegador.newContext({ viewport: { width: 1280, height: 800 } })
const pagina = await contexto.newPage()

await pagina.goto(`http://127.0.0.1:${PORT}/?boot=${token}`)
await pagina.waitForLoadState('networkidle')
await pagina.waitForTimeout(1200)

await mkdir(dirname(DESTINO), { recursive: true })
await pagina.screenshot({ path: DESTINO, fullPage: false })

await navegador.close()
console.log(`captura en ${DESTINO}`)
