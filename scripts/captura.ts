/**
 * La captura de la home, para el README: tema oscuro.
 *
 * Se hace con el arnés del e2e —servidor con el fixture, base temporal y la
 * excepción de loopback— porque una captura hecha a mano envejece sin que nadie
 * se entere: ésta se puede volver a hacer con un comando. **El README publica un
 * solo tema**: el claro existió y se retiró porque duplicaba la imagen sin decir
 * nada nuevo, y dos capturas de dos megas pesan en el repositorio.
 *
 * **El token de arranque es de un solo uso**: se canjea al abrir la página. Con
 * un segundo navegador la captura salía en blanco, con un 401, porque el token
 * ya estaba gastado.
 */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { chromium } from '@playwright/test'
import {
  AVISOS,
  CLAVE_GUIA,
  RECORRIDOS,
  VERSION_GUIA,
} from '../packages/web/src/features/guia/guia'

const PORT = Number(process.env.NN_ANIME_E2E_PORT ?? '7801')
const DESTINO = process.env.NN_ANIME_CAPTURA ?? 'docs/captura.png'
const token = (await readFile('.tmp/e2e-boot-token', 'utf8')).trim()

const navegador = await chromium.launch({ args: ['--mute-audio'] })
const contexto = await navegador.newContext({
  viewport: { width: 1280, height: 800 },
  colorScheme: 'dark',
})

// La guía de primera vez y el aviso de lo nuevo, ya vistos: sin esto el
// recorrido automático tapa el destacado y la captura del README enseña un
// tutorial en vez de la home. Se siembra el mismo estado que deja la guía al
// cerrarla, leído de su módulo —clave, versión, recorridos y avisos—, así que
// un recorrido nuevo no obliga a tocar esta lista.
const estadoGuia = {
  v: VERSION_GUIA,
  recorridos: RECORRIDOS.map((recorrido) => recorrido.id),
  vistos: AVISOS.map((aviso) => aviso.id),
}
await contexto.addInitScript(
  ([clave, valor]: readonly [string, string]) => {
    try {
      localStorage.setItem(clave, valor)
    } catch {
      // Sin almacén —modo privado— la guía saldría en la captura. Se dice en la
      // salida en vez de sacar una imagen con un tutorial encima.
      console.warn('la captura no pudo sembrar el estado de la guía')
    }
  },
  [CLAVE_GUIA, JSON.stringify(estadoGuia)] as const,
)

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

// La página se captura entera: recortada a la ventana no enseña ni el top ni las
// filas, que es lo que hay que revisar. El tema se fija a mano porque la captura
// no puede depender de la preferencia del sistema de quien la saca.
await pagina.evaluate(() => {
  document.documentElement.dataset.theme = 'dark'
})

await mkdir(dirname(DESTINO), { recursive: true })
await pagina.screenshot({ path: DESTINO, fullPage: true })
console.log(`captura en ${DESTINO}`)

await navegador.close()
