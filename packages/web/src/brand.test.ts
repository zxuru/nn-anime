import { describe, expect, test } from 'bun:test'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

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
const LOGO = fileURLToPath(new URL('../public/brand/logo.svg', import.meta.url))
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
})
