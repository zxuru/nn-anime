import { describe, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Comprueba que no haya referencias muertas entre componentes y estilos.
 *
 * Una clase usada en el marcado y no definida en ningún CSS no da error en
 * ningún sitio: simplemente no hace nada, y nadie se entera hasta que mira la
 * pantalla y no entiende por qué. Este test lo convierte en un fallo.
 *
 * Se leen los archivos directamente en lugar de importar el CSS, porque el
 * runner de tests no tiene por qué saber resolver hojas de estilo. Las rutas se
 * obtienen con `fileURLToPath` y no con `URL.pathname`, que deja `%20` en una
 * ruta con espacios y hace fallar la lectura con un mensaje que engaña.
 */

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const TOKENS = fileURLToPath(new URL('./styles/tokens.css', import.meta.url))
const SHELL = fileURLToPath(new URL('./styles/shell.css', import.meta.url))

async function read(path: string): Promise<string> {
  const file = Bun.file(path)
  if (!(await file.exists())) throw new Error(`no existe ${path}`)

  return file.text()
}

async function readIfExists(path: string): Promise<string> {
  const file = Bun.file(path)
  return (await file.exists()) ? file.text() : ''
}

async function stylesheets(): Promise<string> {
  return `${await readIfExists(TOKENS)}\n${await readIfExists(SHELL)}`
}

async function classesUsedIn(relative: string): Promise<readonly string[]> {
  const source = await read(`${ROOT}${relative}`)
  const found = new Set<string>()

  for (const match of source.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
    for (const name of (match[1] ?? match[2] ?? '').split(/\s+/)) {
      if (name !== '') found.add(name)
    }
  }

  return [...found]
}

/** Todos los componentes, no sólo la raíz: una clase nueva vive en su archivo. */
async function componentFiles(): Promise<readonly string[]> {
  const found: string[] = []

  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(join(ROOT, relative), { withFileTypes: true })) {
      const path = `${relative}${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') await walk(`${path}/`)
        continue
      }
      if (entry.name.endsWith('.tsx')) found.push(path)
    }
  }

  await walk('./')

  return found.sort()
}

describe('referencias entre marcado y estilos', () => {
  test('el directorio del paquete se resuelve aunque la ruta tenga espacios', () => {
    expect(ROOT).not.toContain('%20')
    expect(ROOT.endsWith('src/')).toBe(true)
  })

  test('toda clase usada en un componente está definida en algún CSS', async () => {
    const css = await stylesheets()
    const files = await componentFiles()

    expect(files.length).toBeGreaterThan(1)

    for (const file of files) {
      for (const name of await classesUsedIn(file)) {
        expect(css, `la clase .${name} se usa en ${file} y no está definida`).toContain(`.${name}`)
      }
    }
  })
})

describe('tokens de diseño', () => {
  test('define color, espaciado, radios y tipografía', async () => {
    const css = await read(TOKENS)

    for (const prefix of ['--color-', '--space-', '--radius-', '--font-', '--text-']) {
      expect(css, `faltan tokens ${prefix}`).toContain(prefix)
    }
  })

  test('la hoja de estructura no usa valores literales de color', async () => {
    const css = await read(SHELL)

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\brgb\(/)
  })

  test('la hoja de estructura no usa medidas literales', async () => {
    const css = await read(SHELL)

    // Cualquier `12px`, `1.5rem`, `-0.01em` o `60ch` que no venga de un token.
    const literals = [...css.matchAll(/(?<![\w(])(-?[\d.]+)(px|rem|em|ch)\b/g)].map(
      (match) => match[0],
    )

    expect(literals, `medidas sueltas: ${literals.join(', ')}`).toEqual([])
  })

  /**
   * El rótulo que no toca se oculta **sin salir del flujo**.
   *
   * Es lo que sostiene que el botón de reproducir no cambie de ancho: con
   * `display: none` —o sin el segundo rótulo en el documento— el botón vuelve a
   * medir lo que mide el rótulo visible, que es el salto que se midió a mano
   * («Reproducir» mide más que «Pausa»). Y los dos van en la misma celda: en dos
   * filas el botón crecería a lo alto en vez de a lo ancho.
   */
  test('el rótulo alterno ocupa su hueco aunque no se vea', async () => {
    const css = await read(SHELL)

    const alterno = /\.player__label--alterno\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(alterno).toContain('visibility: hidden')
    expect(alterno).not.toContain('display')

    const celda = /\.player__label\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(celda).toContain('grid-area: 1 / 1')
  })

  /**
   * El encabezado se apila por encima del contenido.
   *
   * No es un detalle de pintura: con la misma capa que una insignia o que el
   * número del top, gana el que va después en el documento —el contenido— y la
   * barra pegajosa se ve atravesada por lo que debería tapar. Pasó con la
   * insignia «Destacado» y con los números del top, y se mide aquí porque el
   * fallo no rompe ninguna prueba de componente: sólo se ve al desplazarse.
   */
  test('el encabezado se apila por encima del contenido', async () => {
    const capa = /--layer-header:\s*(\d+)/.exec(await read(TOKENS))?.[1]

    expect(capa, 'falta --layer-header en tokens.css').toBeDefined()

    const capasDelContenido = [...(await read(SHELL)).matchAll(/z-index:\s*(\d+)/g)].map((match) =>
      Number(match[1]),
    )

    expect(capasDelContenido.length).toBeGreaterThan(0)

    for (const capaDelContenido of capasDelContenido) {
      expect(Number(capa)).toBeGreaterThan(capaDelContenido)
    }
  })

  test('respeta la preferencia de movimiento reducido', async () => {
    expect(await read(TOKENS)).toContain('prefers-reduced-motion')
  })

  test('tiene tema claro además del oscuro', async () => {
    expect(await read(TOKENS)).toMatch(/data-theme=["']light["']/)
  })
})
