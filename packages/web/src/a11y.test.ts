import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

/**
 * Contraste de la paleta, medido y no afirmado.
 *
 * El spec de la interfaz exige 4.5:1 en texto normal y 3:1 en texto grande. Un
 * comentario que diga «cumple» no protege nada: el día que alguien ajuste un
 * color, el comentario sigue ahí. Esto lo convierte en un fallo de test.
 *
 * Las fórmulas son las de WCAG 2.1: luminancia relativa con corrección de
 * gamma y cociente de contraste.
 */

const TOKENS = fileURLToPath(new URL('./styles/tokens.css', import.meta.url))

function luminance(hex: string): number {
  const digits = hex.replace('#', '')
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((c) => c + c)
          .join('')
      : digits

  const channels = [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))

  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)

  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05)
}

/** Extrae los `--color-*` de un bloque de tema. */
function colorsOf(block: string): Record<string, string> {
  const found: Record<string, string> = {}

  for (const match of block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{3,8})/g)) {
    const name = match[1]
    const value = match[2]
    if (name !== undefined && value !== undefined) found[name] = value
  }

  return found
}

async function themes(): Promise<Record<string, Record<string, string>>> {
  const css = await Bun.file(TOKENS).text()
  const [dark = '', light = ''] = css.split(/\[data-theme=["']light["']\]/)

  return { oscuro: colorsOf(dark), claro: colorsOf(light) }
}

/** Pares que el spec exige que cumplan, por fondo. */
const PAIRS: readonly (readonly [string, string, number])[] = [
  ['text', 'bg', 4.5],
  ['text-dim', 'bg', 4.5],
  ['text-dim', 'surface', 4.5],
  ['accent', 'bg', 4.5],
  ['danger', 'bg', 4.5],
  ['success', 'bg', 4.5],
]

describe('la fórmula de contraste', () => {
  test('el blanco sobre el negro da 21', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 1)
  })

  test('un color consigo mismo da 1', () => {
    expect(contrast('#6aa9ff', '#6aa9ff')).toBeCloseTo(1, 5)
  })
})

describe('contraste de la paleta', () => {
  test('los dos temas definen los colores que se comprueban', async () => {
    for (const [nombre, colors] of Object.entries(await themes())) {
      for (const [foreground, background] of PAIRS) {
        expect(colors[foreground], `${nombre} no define --color-${foreground}`).toBeString()
        expect(colors[background], `${nombre} no define --color-${background}`).toBeString()
      }
    }
  })

  test('cada par supera el mínimo del spec', async () => {
    for (const [nombre, colors] of Object.entries(await themes())) {
      for (const [foreground, background, minimum] of PAIRS) {
        const fg = colors[foreground]
        const bg = colors[background]
        if (fg === undefined || bg === undefined) continue

        const ratio = contrast(fg, bg)
        expect(
          ratio,
          `${nombre}: --color-${foreground} sobre --color-${background}`,
        ).toBeGreaterThanOrEqual(minimum)
      }
    }
  })

  test('el tema claro redefine todo lo que el oscuro define de color', async () => {
    const { oscuro = {}, claro = {} } = await themes()
    const faltan = Object.keys(oscuro).filter((name) => !(name in claro))

    // `surface-raised`, `border` y `accent-contrast` también cuentan.
    expect(faltan).toEqual([])
  })
})
