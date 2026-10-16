import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { UMBRAL_DE_TINTA } from './features/home/tinta'

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

/** La raíz del paquete, para recorrer los componentes. */
const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url))

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

/**
 * Las capas de la barra de progreso.
 *
 * Son partes de un componente, así que el mínimo es 3:1 y no 4.5:1. Se miden
 * **compuestas sobre negro**, que es lo que hay detrás: la barra va sobre el
 * degradado de los mandos y el degradado es negro en los dos temas. Un color con
 * alfa medido a secas —como si fuera opaco— daría un número que no es el que se
 * ve.
 */
describe('contraste de la barra de progreso', () => {
  /** El color con su alfa, ya mezclado sobre negro, en hexadecimal. */
  function sobreNegro(color: string): string {
    // Un hexadecimal no lleva alfa: es el color tal cual, ya opaco.
    const hex = /^#([0-9a-f]{6})\b/i.exec(color.trim())
    if (hex?.[1] !== undefined) return `#${hex[1]}`

    const numeros = (color.match(/[\d.]+/g) ?? []).map(Number)
    const [r = 0, g = 0, b = 0] = numeros
    const alfa = (numeros[3] ?? 100) / 100
    const canal = (valor: number): string =>
      Math.round(valor * alfa)
        .toString(16)
        .padStart(2, '0')

    return `#${canal(r)}${canal(g)}${canal(b)}`
  }

  test('el carril, el búfer y el tramo reproducido pasan el 3:1', async () => {
    const tokens = await Bun.file(TOKENS).text()
    const color = (nombre: string): string =>
      new RegExp(`--${nombre}:\\s*([^;]+);`).exec(tokens)?.[1]?.trim() ?? ''

    const capas = [
      ['seek-track', color('seek-track')],
      ['seek-buffer', color('seek-buffer')],
      ['color-accent', color('color-accent')],
    ] as const

    for (const [nombre, valor] of capas) {
      expect(valor, `falta --${nombre}`).not.toBe('')

      const ratio = contrast(sobreNegro(valor), '#000000')

      expect(ratio, `--${nombre} sobre el video: ${valor}`).toBeGreaterThanOrEqual(3)
    }
  })

  test('la fórmula de la mezcla es la que se cree', () => {
    // Un crema opaco es él mismo; al 50 % sobre negro, la mitad.
    expect(sobreNegro('rgb(242 233 216 / 100%)')).toBe('#f2e9d8')
    expect(sobreNegro('rgb(242 233 216 / 50%)')).toBe('#79756c')
    expect(sobreNegro('#ff4a2e')).toBe('#ff4a2e')
  })
})

/**
 * La lupa de las medidas de color sobre arte.
 *
 * Las usan las dos medidas que componen colores sobre una imagen —el banner de la
 * marquesina y el velo de la cifra del top—, y una fórmula escrita dos veces es una
 * fórmula que se separa: la del velo de la marquesina se compone sobre el campo, y
 * la de la cifra, sobre una portada cualquiera.
 */
const TABLA = fileURLToPath(new URL('./styles/tokens.css', import.meta.url))

type Canal = readonly [number, number, number]

/** Los tokens, tal cual están escritos. */
async function tokens(): Promise<string> {
  return Bun.file(TABLA).text()
}

function valor(css: string, nombre: string): string {
  return new RegExp(`--${nombre}:\\s*([^;]+);`).exec(css)?.[1]?.trim() ?? ''
}

/**
 * El valor de un token, siguiendo un `var(--otro)` si es que lo es.
 *
 * La tinta crema de la marquesina **es** `--color-on-overlay`: se declara una vez
 * y el par de la marquesina la nombra, así que la medida tiene que seguir el
 * nombre hasta el color o mediría una cadena.
 */
function resuelto(css: string, nombre: string): string {
  const propio = valor(css, nombre)
  const referencia = /^var\(--([a-z-]+)\)$/.exec(propio)

  return referencia?.[1] === undefined ? propio : valor(css, referencia[1])
}

/** Los canales de un color, escrito en `#rrggbb` o en `rgb(r g b …)`. */
function canales(texto: string): Canal {
  const hexadecimal = /#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(texto)

  if (hexadecimal?.[1] !== undefined) {
    const digitos = hexadecimal[1]
    const completo = digitos.length === 3 ? [...digitos].map((d) => d + d).join('') : digitos

    return [
      Number.parseInt(completo.slice(0, 2), 16),
      Number.parseInt(completo.slice(2, 4), 16),
      Number.parseInt(completo.slice(4, 6), 16),
    ]
  }

  const coincidencia = /rgb\(\s*(\d+)\s+(\d+)\s+(\d+)/.exec(texto)
  expect(coincidencia, `no hay ningún color en «${texto}»`).not.toBeNull()

  return [
    Number(coincidencia?.[1] ?? 0),
    Number(coincidencia?.[2] ?? 0),
    Number(coincidencia?.[3] ?? 0),
  ]
}

/** El tanto por ciento de un token como `0.6`, y no como `60`. */
function tanto(css: string, nombre: string): number {
  const texto = valor(css, nombre)
  const numero = Number.parseFloat(texto)

  expect(Number.isFinite(numero), `--${nombre} no es un número: «${texto}»`).toBe(true)

  return numero / 100
}

/** El canal sRGB cuya luminancia relativa es exactamente `l`: la vuelta de la fórmula. */
function canalDeLuminancia(l: number): number {
  return 1.055 * l ** (1 / 2.4) - 0.055
}

/** Un color compuesto sobre otro, canal a canal, como lo hace el navegador. */
function compuesto(fondo: Canal, encima: Canal, alfa: number): Canal {
  return [
    encima[0] * alfa + fondo[0] * (1 - alfa),
    encima[1] * alfa + fondo[1] * (1 - alfa),
    encima[2] * alfa + fondo[2] * (1 - alfa),
  ]
}

function hexDe(color: Canal): string {
  const canal = (valor: number): string =>
    Math.min(255, Math.max(0, Math.round(valor)))
      .toString(16)
      .padStart(2, '0')

  return `#${canal(color[0])}${canal(color[1])}${canal(color[2])}`
}

/**
 * La tinta de la marquesina sobre el banner, medida.
 *
 * La marquesina elige su tinta —crema o negra— según el tono del banner, y el velo
 * va al contrario: es lo que aplana la imagen hasta que el texto se lee sobre
 * cualquier banner, del color que sea. Con el umbral y el mínimo puestos a ojo, la
 * garantía sería una frase en un comentario; aquí es un número que falla.
 *
 * El peor caso de cada dirección es **el campo en el propio umbral**: el más claro
 * que todavía lleva tinta crema y el más oscuro que lleva tinta negra. Por eso el
 * umbral y el mínimo del velo están atados: subir el umbral deja la tinta crema
 * sobre un campo más claro, y bajar el mínimo deja menos velo para taparlo.
 *
 * La tinta de cada texto llega con su propia opacidad —el motivo es más tenue que
 * el titular—, así que lo que se mide es el color **compuesto**: la tinta sobre el
 * campo ya velado, que es el que se ve. Medir la tinta como si fuera opaca daría un
 * número que no es el de la pantalla, y es el error que la prueba de la barra de
 * progreso ya comete a propósito para explicar por qué no.
 */
describe('la tinta de la marquesina sobre el banner', () => {
  /**
   * Los pares, con el lado del umbral que le toca a cada uno.
   *
   * El campo es un gris neutro en el umbral: la medida no depende del color del
   * banner, sólo de su luminancia, así que el peor caso se puede poner con un gris.
   */
  async function pares(): Promise<
    {
      readonly nombre: string
      readonly tinta: Canal
      readonly velo: Canal
      readonly alfaDelVelo: number
    }[]
  > {
    const css = await tokens()
    const alfa = tanto(css, 'velo-campo-minimo')

    return [
      {
        nombre: 'tinta crema sobre un campo oscuro',
        tinta: canales(resuelto(css, 'marquesina-tinta-clara')),
        velo: canales(valor(css, 'velo-campo-oscuro')),
        alfaDelVelo: alfa,
      },
      {
        nombre: 'tinta negra sobre un campo claro',
        tinta: canales(resuelto(css, 'marquesina-tinta-oscura')),
        velo: canales(valor(css, 'velo-campo-claro')),
        alfaDelVelo: alfa,
      },
    ]
  }

  /** Las tintas que van sobre el campo, con la opacidad con la que se pintan. */
  const TINTAS: readonly (readonly [string, string])[] = [
    ['titular y rótulo', '100'],
    ['línea de datos', 'marquesina-tinta-dato'],
    ['sinopsis', 'marquesina-tinta-prosa'],
    ['marca de refresco', 'marquesina-tinta-marca'],
    ['motivo', 'marquesina-tinta-motivo'],
  ]

  test('cada tinta pasa el 4.5:1 del spec en el peor caso de su dirección', async () => {
    const campos = await pares()
    const css = await tokens()
    const gris = canalDeLuminancia(UMBRAL_DE_TINTA) * 255

    for (const campo of campos) {
      // El campo velado: lo que se ve detrás del texto.
      const fondo = compuesto([gris, gris, gris], campo.velo, campo.alfaDelVelo)

      for (const [nombre, token] of TINTAS) {
        const opacidadDelTexto = token === '100' ? 1 : tanto(css, token)
        const texto = compuesto(fondo, campo.tinta, opacidadDelTexto)
        const ratio = contrast(hexDe(texto), hexDe(fondo))

        expect(ratio, `${campo.nombre}: ${nombre}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  /**
   * Y el mínimo del velo es el que se usa.
   *
   * Un token declarado y no usado no garantiza nada: la prueba de arriba mediría un
   * número que la hoja no aplica. Los dos velos llevan el mínimo por el tanto, y por
   * eso se comprueba que lo citan.
   */
  test('los dos velos usan el mínimo declarado', async () => {
    const css = await tokens()

    for (const nombre of ['velo-campo-oscuro', 'velo-campo-claro']) {
      expect(valor(css, nombre), `--${nombre}`).toContain('var(--velo-campo-minimo)')
    }
  })

  /**
   * El mínimo llega hasta el final de la columna de texto.
   *
   * El velo se retira hacia la derecha —donde está el cartel y donde la imagen se
   * enseña entera—, y hasta dónde llega el velo fuerte es lo que decide si el
   * titular se lee. La columna es la primera del reparto —`1fr` contra `0.58fr`—, y
   * el velo tiene que seguir en su mínimo hasta ahí: acortarlo deja el texto sobre
   * la imagen cruda, que es justo el banner que se come la letra.
   */
  test('el velo aguanta el mínimo hasta el final de la columna', async () => {
    const css = await tokens()
    const minimo = tanto(css, 'velo-campo-minimo')

    /** La primera columna del reparto, en tanto por uno del ancho. */
    const columnas =
      /--marquesina-cols:\s*minmax\(0,\s*([\d.]+)fr\)\s*minmax\(0,\s*([\d.]+)fr\)/.exec(css)
    const primera = Number(columnas?.[1] ?? 0)
    const segunda = Number(columnas?.[2] ?? 0)

    expect(primera, 'falta el reparto de columnas de la marquesina').toBeGreaterThan(0)
    const corte = primera / (primera + segunda)

    for (const nombre of ['velo-campo-oscuro', 'velo-campo-claro']) {
      // Sólo la capa horizontal, que es la que sostiene la columna de texto. Se
      // resuelve el `var()` del mínimo antes de leer los tantos: lo que se mide es
      // la opacidad que acaba en la hoja, no el nombre del token.
      const capas = valor(css, nombre)
        .replaceAll('var(--velo-campo-minimo)', `${minimo * 100}%`)
        .split('linear-gradient(')
        .filter((capa) => capa.trimStart().startsWith('to right'))

      expect(capas.length, `--${nombre} no tiene capa horizontal`).toBe(1)

      const paradas = [...(capas[0] ?? '').matchAll(/([\d.]+)%\s*\)\s*([\d.]+)%/g)].map(
        (parada) => ({
          alfa: Number(parada[1]) / 100,
          posicion: Number(parada[2]) / 100,
        }),
      )

      expect(paradas.length, `--${nombre} no tiene paradas que leer`).toBeGreaterThan(1)

      const hastaDondeLlega = Math.max(
        ...paradas.filter((parada) => parada.alfa >= minimo).map((parada) => parada.posicion),
      )

      expect(
        hastaDondeLlega,
        `el velo fuerte de --${nombre} se queda corto`,
      ).toBeGreaterThanOrEqual(corte)
    }
  })
})

/**
 * La cifra del top sobre la portada, medida.
 *
 * La cifra del puesto va sobre el arte de la pieza, y desde que AniList manda en el
 * top ese arte es **una portada de verdad**: un cielo, una nieve o el amarillo de un
 * héroe. El crema del número desaparecía sobre los claros —en la captura del top, el
 * «5» de Boku no Hero y el «8» de ONE PIECE no se leían— y el color de lo que hay
 * debajo no se elige, así que se oscurece con un velo. Su mínimo es un número que
 * falla si alguien lo baja.
 *
 * El peor arte posible es el blanco: es el que deja el velo con menos que tapar. Y el
 * velo dura lo que la cifra —`--velo-puesto-alto` se mide en cifras, no en tantos de
 * la pieza—, así que la parte fuerte tiene que llegar hasta donde llega su caja: si
 * se queda corta, la mitad de abajo del número vuelve a caer sobre el arte crudo.
 */
describe('la cifra del top sobre la portada', () => {
  /** El blanco puro: lo más claro que puede quedar debajo de la cifra. */
  const BLANCO: Canal = [255, 255, 255]

  test('el mínimo del velo deja la cifra por encima del 4.5:1 en el peor arte', async () => {
    const css = await tokens()
    const minimo = tanto(css, 'velo-puesto-minimo')
    const cifra = canales(resuelto(css, 'color-on-overlay'))
    // El color del velo es el de los otros velos del arte: el negro de la casa.
    const velo = canales(valor(css, 'velo-puesto'))

    // Lo que se ve detrás de la cifra: el velo a su mínimo, sobre el arte más claro.
    const fondo = compuesto(BLANCO, velo, minimo)
    const ratio = contrast(hexDe(cifra), hexDe(fondo))

    expect(ratio, `la cifra del top sobre arte claro: ${hexDe(fondo)}`).toBeGreaterThanOrEqual(4.5)
  })

  test('el velo fuerte llega hasta debajo de la cifra', async () => {
    const css = await tokens()
    const minimo = tanto(css, 'velo-puesto-minimo')
    const multiplicador = Number(
      /--velo-puesto-alto:\s*calc\(var\(--pieza-posicion\)\s*\*\s*([\d.]+)\)/.exec(css)?.[1] ?? 0,
    )

    expect(multiplicador, 'falta --velo-puesto-alto, o no se mide en cifras').toBeGreaterThan(1)

    // La cifra mide una `--pieza-posicion` de alto —el `line-height` es 1— y el velo,
    // `multiplicador` veces eso: hasta dónde tiene que aguantar el mínimo.
    const hastaLaCifra = 1 / multiplicador

    const paradas = [
      ...valor(css, 'velo-puesto')
        .replaceAll('var(--velo-puesto-minimo)', `${minimo * 100}%`)
        .matchAll(/([\d.]+)%\s*\)\s*([\d.]+)%/g),
    ].map((parada) => ({ alfa: Number(parada[1]) / 100, posicion: Number(parada[2]) / 100 }))

    expect(paradas.length, '--velo-puesto no tiene paradas que leer').toBeGreaterThan(1)

    const hastaDondeLlega = Math.max(
      ...paradas.filter((parada) => parada.alfa >= minimo).map((parada) => parada.posicion),
    )

    expect(hastaDondeLlega, 'el velo del puesto se queda corto').toBeGreaterThanOrEqual(
      hastaLaCifra,
    )
  })
})

/**
 * Lo que se puede comprobar sin navegador.
 *
 * Un recorrido de teclado de verdad necesita un navegador y es del e2e (T43).
 * Lo que sí se puede comprobar aquí es que las piezas están: que hay un anillo de
 * foco declarado, que el movimiento reducido se respeta y que ningún elemento
 * interactivo se queda sin nombre accesible.
 */

const SHELL = fileURLToPath(new URL('./styles/shell.css', import.meta.url))

describe('foco visible', () => {
  test('hay una regla de `:focus-visible` con un anillo del tema', async () => {
    const css = await Bun.file(SHELL).text()

    expect(css).toContain(':focus-visible')
    expect(css).toContain('outline: var(--focus-ring-width) solid var(--color-accent)')
    expect(css).toContain('outline-offset: var(--focus-ring-offset)')
  })

  test('el anillo usa tokens y no números sueltos', async () => {
    const tokens = await Bun.file(TOKENS).text()

    expect(tokens).toContain('--focus-ring-width:')
    expect(tokens).toContain('--focus-ring-offset:')
  })

  test('se dibuja con `:focus-visible`, no con `:focus`', async () => {
    const css = await Bun.file(SHELL).text()

    // `:focus` a secas dibujaría el anillo también al hacer clic con el ratón.
    expect(css).not.toMatch(/(^|[^-\w]):focus\s*\{/)
  })
})

describe('movimiento reducido', () => {
  test('las transiciones se apagan', async () => {
    const tokens = await Bun.file(TOKENS).text()

    expect(tokens).toContain('@media (prefers-reduced-motion: reduce)')
    expect(tokens).toContain('--transition-fast: 0ms')
    expect(tokens).toContain('--transition-normal: 0ms')
  })

  test('el esqueleto deja de latir', async () => {
    const css = await Bun.file(SHELL).text()
    const bloque = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))

    expect(bloque).toContain('.skeleton')
    expect(bloque).toContain('animation: none')
  })

  /**
   * La potencia que falta, apagada.
   *
   * La entrada de la home y la cinta de la marquesina son lo único que se mueve
   * sin que nadie lo pida; el resto de la vitrina espera al puntero. Se mira el
   * bloque entero y no sólo una regla porque una animación nueva que se quede
   * fuera no rompe ninguna otra prueba: sólo mueve la página de quien pidió que no
   * se moviera. La supresión tiene la **misma especificidad** que la regla que
   * apaga, así que también importa que vaya después; por eso el bloque se busca
   * desde la última aparición del `@media`.
   */
  test('la entrada y la cinta dejan de moverse', async () => {
    const css = await Bun.file(SHELL).text()
    const bloques = css.split('@media (prefers-reduced-motion: reduce)')
    const ultimo = bloques[bloques.length - 1] ?? ''

    expect(bloques.length).toBeGreaterThan(1)
    expect(ultimo).toContain('.cinta__carro')
    expect(ultimo).toContain('animation: none')

    // Y la entrada de la home sigue apagándose en algún bloque: es lo que entra
    // solo al abrir la pantalla.
    expect(bloques.join('')).toContain('.home > *')
    expect(bloques.join('')).toContain('.skeleton')
  })

  test('el desplazamiento de la entrada sale de un token, no de un número suelto', async () => {
    const tokens = await Bun.file(TOKENS).text()

    expect(tokens).toContain('--entrada-duracion:')
    expect(tokens).toContain('--entrada-paso:')
    // A cero con movimiento reducido: quien la use entra de golpe, no se queda
    // invisible esperando una animación que no corre.
    expect(tokens).toContain('--entrada-duracion: 0ms')
    expect(tokens).toContain('--entrada-paso: 0ms')
  })
})

describe('nombres accesibles', () => {
  /**
   * Recorre los componentes buscando elementos interactivos sin nombre.
   *
   * Es una comprobación por texto y tiene los límites de una comprobación por
   * texto: mira que un botón tenga contenido o `aria-label`, no que ese contenido
   * signifique algo. Lo que sí caza es el caso real —un botón con un icono y nada
   * más— y ése es el que se cuela.
   */
  /**
   * Las etiquetas de apertura, hasta su `>` de verdad.
   *
   * Una expresión regular no sirve: `onClick={() => act('x')}` lleva un `>` dentro
   * de las llaves, y la coincidencia se corta ahí. La primera versión de esta
   * comprobación lo hacía así y **dejaba pasar un botón sin nombre**; por eso ahora
   * se recorren los caracteres contando llaves.
   */
  function etiquetasDe(texto: string, etiqueta: string): string[] {
    const salida: string[] = []
    let indice = texto.indexOf(`<${etiqueta}`)

    while (indice !== -1) {
      let profundidad = 0
      let fin = indice

      for (let cursor = indice; cursor < texto.length; cursor++) {
        const caracter = texto[cursor]

        if (caracter === '{') profundidad += 1
        else if (caracter === '}') profundidad -= 1
        else if (caracter === '>' && profundidad === 0) {
          fin = cursor
          break
        }
      }

      salida.push(texto.slice(indice, fin + 1))
      indice = texto.indexOf(`<${etiqueta}`, fin + 1)
    }

    return salida
  }

  async function interactivos(): Promise<
    { readonly archivo: string; readonly etiqueta: string; readonly cuerpo: string }[]
  > {
    const glob = new Bun.Glob('**/*.tsx')
    const encontrados: { archivo: string; etiqueta: string; cuerpo: string }[] = []

    for await (const relativo of glob.scan({ cwd: ROOT_DIR })) {
      if (relativo.includes('.test.')) continue

      const texto = await Bun.file(`${ROOT_DIR}${relativo}`).text()

      for (const etiqueta of ['button', 'Link']) {
        for (const cuerpo of etiquetasDe(texto, etiqueta)) {
          encontrados.push({ archivo: relativo, etiqueta, cuerpo })
        }
      }
    }

    return encontrados
  }

  test('todo botón o enlace tiene texto, `aria-label` o `title`', async () => {
    const elementos = await interactivos()

    expect(elementos.length).toBeGreaterThan(10)

    for (const { archivo, etiqueta, cuerpo } of elementos) {
      const tieneNombre =
        /aria-label=|aria-labelledby=|title=/.test(cuerpo) || !cuerpo.trimEnd().endsWith('/>')

      expect(tieneNombre, `${archivo}: ${etiqueta} sin nombre accesible`).toBe(true)
    }
  })

  test('hay regiones `aria-live` en la búsqueda y en el reproductor', async () => {
    const buscador = await Bun.file(`${ROOT_DIR}features/search/SearchPage.tsx`).text()
    const reproductor = await Bun.file(`${ROOT_DIR}features/player/Player.tsx`).text()

    expect(buscador).toContain('aria-live="polite"')
    expect(reproductor).toContain('aria-live="polite"')
  })
})
