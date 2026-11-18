import { describe, expect, test } from 'bun:test'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { encodePng, render } from '../../../scripts/icon'

/**
 * La marca de la cabecera, medida.
 *
 * El `logo.png` del build pesaba 1 241 909 B para pintarse a 40×40: más que todo
 * el JavaScript de entrada. La cabecera usa ahora el SVG maestro, que pesa 4 KB
 * y se ve nítido a cualquier tamaño. Estas pruebas impiden que vuelva el PNG
 * gigante o que el SVG de la web se desincronice del maestro.
 */

const APP = fileURLToPath(new URL('./app.tsx', import.meta.url))
const INDEX = fileURLToPath(new URL('../index.html', import.meta.url))
const BRAND = fileURLToPath(new URL('../public/brand', import.meta.url))
const LOGO = `${BRAND}/logo.svg`
const MAESTRO = fileURLToPath(new URL('../../../packaging/icons/icon.svg', import.meta.url))

async function read(path: string): Promise<string> {
  const file = Bun.file(path)
  if (!(await file.exists())) throw new Error(`no existe ${path}`)

  return file.text()
}

describe('la marca de la cabecera', () => {
  test('usa el SVG y no el PNG grande', async () => {
    const app = await read(APP)

    expect(app).toContain('/brand/logo.svg')
    expect(app).not.toContain('/brand/logo.png')
  })

  test('el favicon no carga el logo grande', async () => {
    const html = await read(INDEX)

    expect(html).not.toContain('/brand/logo.png')
    expect(html).toContain('/brand/favicon-32.png')
  })

  test('el SVG de la web es el maestro de packaging/icons', async () => {
    expect(await read(LOGO)).toBe(await read(MAESTRO))
  })

  test('el SVG no llega a 10 KB', async () => {
    const info = await stat(LOGO)

    expect(info.size).toBeLessThan(10 * 1024)
  })

  /**
   * Los dos PNG de la web salen del maestro, no de una mano.
   *
   * Se comparan con lo que produce `bun run icon` para la misma talla: si
   * alguien guardara un favicon retocado, o si el generador dejara de escribir
   * los dos archivos, la marca de la pestaña y la del ejecutable volverían a ser
   * dos dibujos distintos. El táctil no es una talla de la app —180— y por eso
   * también se mide aquí.
   */
  test('el favicon y el icono táctil son el maestro rasterizado', async () => {
    const favicon = new Uint8Array(await Bun.file(`${BRAND}/favicon-32.png`).arrayBuffer())
    const tactil = new Uint8Array(await Bun.file(`${BRAND}/touch-180.png`).arrayBuffer())

    expect([...favicon]).toEqual([...encodePng(render(32), 32)])
    expect([...tactil]).toEqual([...encodePng(render(180), 180)])
  })
})
