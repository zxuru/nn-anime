import { describe, expect, test } from 'bun:test'

/**
 * Comprueba que no haya referencias muertas entre componentes y estilos.
 *
 * Una clase usada en el marcado y no definida en ningún CSS no da error en
 * ningún sitio: simplemente no hace nada, y nadie se entera hasta que mira la
 * pantalla y no entiende por qué. Este test lo convierte en un fallo.
 *
 * Se leen los archivos directamente en lugar de importar el CSS, porque el
 * runner de tests no tiene por qué saber resolver hojas de estilo.
 */

async function readIfExists(path: string): Promise<string> {
  const file = Bun.file(path)
  return (await file.exists()) ? file.text() : ''
}

async function stylesheets(): Promise<string> {
  const tokens = await readIfExists(new URL('./styles/tokens.css', import.meta.url).pathname)
  const shell = await readIfExists(new URL('./styles/shell.css', import.meta.url).pathname)
  return `${tokens}\n${shell}`
}

async function classesUsedIn(relative: string): Promise<readonly string[]> {
  const source = await Bun.file(new URL(relative, import.meta.url).pathname).text()
  const found = new Set<string>()

  for (const match of source.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
    for (const name of (match[1] ?? match[2] ?? '').split(/\s+/)) {
      if (name !== '') found.add(name)
    }
  }

  return [...found]
}

describe('referencias entre marcado y estilos', () => {
  test('toda clase usada en la aplicación está definida en algún CSS', async () => {
    const css = await stylesheets()
    const used = await classesUsedIn('./app.tsx')

    expect(used.length).toBeGreaterThan(0)

    for (const name of used) {
      expect(css, `la clase .${name} se usa pero no está definida`).toContain(`.${name}`)
    }
  })

  test('las clases de la estructura están todas definidas', async () => {
    const css = await stylesheets()

    for (const name of ['shell', 'shell__header', 'shell__brand', 'shell__nav', 'shell__main']) {
      expect(css, `falta .${name}`).toContain(`.${name}`)
    }
  })
})

describe('tokens de diseño', () => {
  test('define color, espaciado, radios y tipografía', async () => {
    const css = await readIfExists(new URL('./styles/tokens.css', import.meta.url).pathname)

    for (const prefix of ['--color-', '--space-', '--radius-', '--font-', '--text-']) {
      expect(css, `faltan tokens ${prefix}`).toContain(prefix)
    }
  })

  test('la hoja de estructura no usa valores literales de color', async () => {
    const css = await readIfExists(new URL('./styles/shell.css', import.meta.url).pathname)

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\brgb\(/)
  })

  test('respeta la preferencia de movimiento reducido', async () => {
    const css = await readIfExists(new URL('./styles/tokens.css', import.meta.url).pathname)

    expect(css).toContain('prefers-reduced-motion')
  })

  test('tiene tema claro además del oscuro', async () => {
    const css = await readIfExists(new URL('./styles/tokens.css', import.meta.url).pathname)

    expect(css).toMatch(/data-theme=["']light["']/)
  })
})
