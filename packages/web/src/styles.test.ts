import { describe, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { join, sep } from 'node:path'
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
    // `sep` y no `/`: en Windows `fileURLToPath` devuelve `…\src\`.
    expect(ROOT.endsWith(`src${sep}`)).toBe(true)
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

  /**
   * Las medidas, salvo las de los `@media`.
   *
   * Un punto de corte **no puede** venir de un token: `var()` no existe dentro de
   * un `@media`. Así que el preludio de las at-rules se quita antes de mirar, y lo
   * que tiene que salir de un token son las declaraciones —que es donde el token
   * sirve—. El ancho de las consultas se comprueba aparte, contra `tokens.css`.
   */
  test('la hoja de estructura no usa medidas literales en las declaraciones', async () => {
    const css = await read(SHELL)

    // Cualquier `12px`, `1.5rem`, `-0.01em` o `60ch` que no venga de un token, ya
    // sin los preludios: `@media (max-width: 600px)`, `@keyframes latido`…
    const sinPreludios = css.replace(/@[a-z-]+[^{;]*/g, '')
    const literals = [...sinPreludios.matchAll(/(?<![\w(])(-?[\d.]+)(px|rem|em|ch)\b/g)].map(
      (match) => match[0],
    )

    expect(literals, `medidas sueltas: ${literals.join(', ')}`).toEqual([])
  })

  /**
   * Y los anchos de las consultas, de los tokens.
   *
   * Es la mitad que no se puede delegar: el número va escrito en el `@media` y
   * repetido en `tokens.css` —el componente también lo lee con `matchMedia`—, así
   * que lo que impide que se separen es esta comprobación.
   */
  test('los anchos de los `@media` salen de los tokens de punto de corte', async () => {
    const declarados = new Set(
      [...(await read(TOKENS)).matchAll(/--bp-[a-z]+:\s*(\d+px)/g)].map((match) => match[1]),
    )

    expect(declarados.size, 'faltan tokens --bp-* en tokens.css').toBeGreaterThan(0)

    const usados = [
      ...(await read(SHELL)).matchAll(/@media[^{]*\((?:max|min)-width:\s*(\d+px)\)/g),
    ].map((match) => match[1])

    expect(usados.length, 'no hay ninguna consulta de ancho que comprobar').toBeGreaterThan(0)

    for (const ancho of usados) {
      expect(declarados, `el ancho ${ancho} de un @media no está en tokens.css`).toContain(ancho)
    }
  })

  /**
   * El botón de reproducir no cambia de ancho al cambiar de estado.
   *
   * Es lo que se mide: «Reproducir» y «Pausa» no ocupan lo mismo, y el botón
   * medía lo que medía su rótulo, así que al pausar encogía y los mandos de al
   * lado se corrían. Antes se resolvía con los dos rótulos superpuestos dentro
   * del botón; ahora el mando lleva un dibujo y mide lo que fija el token, no lo
   * que diga su nombre. El caso se conserva porque el fallo —una fila de mandos
   * que se mueve al cambiar de estado— sigue siendo el mismo.
   */
  test('el mando mide lo que el token, no lo que dice su nombre', async () => {
    const css = await read(SHELL)

    const mando = /\.player__control\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(mando).toContain('min-width: var(--control-size)')
    expect(mando).toContain('min-height: var(--control-size)')

    // Y el truco viejo no vuelve por su cuenta: dos rótulos superpuestos en el
    // mismo botón son dos nombres accesibles a la vez.
    expect(css).not.toContain('.player__label--alterno')
  })

  /**
   * El renglón de un relacionado no se parte.
   *
   * El año y la insignia son unidades cortas —«Año 2025», «Temporada 2»— y la
   * barra lateral es estrecha. En un contenedor que fluye en línea, el año rompe
   * por el espacio y el recuadro de la insignia se abre en dos renglones: es lo
   * que se vio en la captura de una ficha. El DOM no lo delata —el mismo marcado
   * se pinta entero o partido según estas declaraciones—, así que se mide aquí.
   */
  test('el año y la insignia de un relacionado no se parten', async () => {
    const css = await read(SHELL)

    /** El cuerpo de una regla, por su selector exacto. */
    const regla = (selector: string): string => {
      const desde = css.indexOf(`${selector} {`)
      if (desde === -1) return ''

      return css.slice(desde, css.indexOf('}', desde))
    }

    // El título arriba y los datos debajo: dos renglones y no uno compartido.
    const cuerpo = regla('.related__body')
    expect(cuerpo, 'falta .related__body en shell.css').toContain('display: flex')
    expect(cuerpo).toContain('flex-direction: column')

    // Los datos, en fila y con vuelta: dos insignias caben, o baja la que no.
    expect(regla('.related__chips')).toContain('flex-wrap: wrap')

    // Y ninguno de los dos se corta por la mitad.
    expect(regla('.related__meta')).toContain('white-space: nowrap')
    expect(regla('.related .badge')).toContain('white-space: nowrap')
    // Los márgenes del `card` no valen aquí: el hueco lo pone el `gap` de la fila.
    expect(regla('.related .badge')).toContain('margin: 0')
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

  /**
   * El puntero no mueve la vitrina.
   *
   * Pasar el ratón por encima de una pieza enciende su borde, aviva el campo y
   * destapa el asomo, pero **nada cambia de tamaño ni de sitio**. La primera
   * versión de la vitrina crecía al pasar el ratón —de una fila a dos, de dos a
   * tres— y todo lo que venía debajo bajaba 145 px, ida y vuelta: el contenido se
   * movía solo bajo el puntero, y eso marea. Se mide aquí porque en el CSS no se
   * ve: el fallo no rompe ninguna otra prueba y sólo aparece con el ratón encima.
   */
  test('ninguna regla de hover de la composición cambia geometría', async () => {
    const css = await read(SHELL)

    // Las propiedades que reflotan, mueven o redimensionan. Un color, un fondo,
    // un filtro, una opacidad o el pausado de una animación no están aquí.
    const geometria = [
      'grid-row',
      'grid-column',
      'grid-template',
      'transform',
      'translate',
      'rotate',
      'scale',
      'width',
      'height',
      'inline-size',
      'block-size',
      'padding',
      'margin',
      'inset',
      'top',
      'left',
      'right',
      'bottom',
      'font-size',
      'flex',
    ]

    const deLaVitrina = /\.(pz|cinta|marquesina|seccion|nota|genero|mosaico)\b/
    const reglas = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    let comprobadas = 0

    for (const regla of reglas) {
      const selector = (regla[1] ?? '').trim()
      const cuerpo = regla[2] ?? ''
      if (!selector.includes(':hover') || !deLaVitrina.test(selector)) continue

      comprobadas += 1

      for (const propiedad of geometria) {
        expect(cuerpo, `${selector} cambia ${propiedad} con el puntero encima`).not.toMatch(
          new RegExp(`(^|[;\\s])${propiedad}\\s*:`),
        )
      }
    }

    expect(comprobadas, 'no se encontró ninguna regla de hover que comprobar').toBeGreaterThan(2)
  })

  /** Y el movimiento —lo que además de cambiar de sitio, se ve moverse— tampoco. */
  test('ninguna regla de hover mueve nada con `transform` ni cambia de fila', async () => {
    const css = await read(SHELL)
    const reglas = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]

    for (const regla of reglas) {
      const selector = (regla[1] ?? '').trim()
      if (!selector.includes(':hover')) continue

      expect(regla[2] ?? '', `${selector} se mueve con el puntero encima`).not.toMatch(
        /(^|[;\s])(transform|translate|rotate|scale|grid-row|grid-column)\s*:/,
      )
    }
  })

  /**
   * La rejilla apretada: cada pieza es un cartel de una columna.
   *
   * El alto de la pieza sale de su ancho —la proporción de una portada—, así que el
   * mosaico se llena solo: seis carteles por fila en la rejilla ancha y cuatro,
   * tres o dos según el ancho, sin que ninguna fila declare tamaños. Con el módulo
   * de filas y un peso por fila, una pieza de dos columnas medía 491x152 px —más
   * ancha que alta— y dejaba tres títulos por fila con un hueco al lado.
   */
  test('la pieza del mosaico es un cartel y ninguna fila declara tamaños', async () => {
    const css = await read(SHELL)
    const cuerpo = /\.pz\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''

    expect(cuerpo, 'falta la proporción de la pieza en .pz').toContain(
      'aspect-ratio: var(--pieza-proporcion)',
    )

    // Y el token es la proporción de una portada, sin unidades: un `aspect-ratio`
    // con `px` no significa nada.
    expect(await read(TOKENS)).toContain('--pieza-proporcion: 2 / 3')

    // Los pesos por fila no vuelven: el tamaño ya no es una decisión de la fila.
    // `pz--mando` no cuenta: es el botón del top, no un tamaño.
    expect(css).not.toMatch(/\.pz--(s|w|b|m)\b/)
  })

  /**
   * El asomo se enseña donde cabe.
   *
   * La caja del asomo mide entre 7 y 9,5 rem —112 a 152 px— y el cartel de 2:3 de
   * una columna unos 350: cabe, y de eso depende que se lea entero dentro de la
   * pieza. La excepción es la banda del régimen de una columna, que mide 6 rem como
   * mucho: ahí sigue apagado.
   */
  test('el asomo sólo se apaga en la banda del móvil', async () => {
    const css = await read(SHELL)
    const apagados = [...css.matchAll(/[^{}]*\.pz__asomo[^{}]*\{[^}]*display:\s*none[^}]*\}/g)]

    expect(apagados).toHaveLength(1)
    expect(css.indexOf(apagados[0]?.[0] ?? '')).toBeGreaterThan(
      css.indexOf('@media (max-width: 560px)'),
    )
  })

  /**
   * Los recursos de arte de la pieza están en la hoja.
   *
   * Van en la clase del campo, y el nombre se arma en el componente con un mapa:
   * la comprobación general de clases leídas del marcado no los ve, así que se
   * miran aquí. Uno que falte no rompe nada —el recurso simplemente no se
   * dibuja—, y es justo el fallo que no se nota hasta que alguien mira la
   * pantalla.
   */
  test('los recursos de arte de la pieza están definidos', async () => {
    const css = await read(SHELL)

    for (const recurso of ['trama', 'mitad', 'circulo', 'caja']) {
      expect(css, `falta el recurso ${recurso}`).toContain(`.pz__campo--${recurso}`)
    }

    // Y los dos que son texto, que se pintan dentro del campo.
    expect(css).toContain('.pz__letra')
    expect(css).toContain('.pz__cifra')
  })

  /**
   * Los seis campos de arte se reparten por posición.
   *
   * Es lo que se perdió al retirar los bloques de la home vieja: el reparto colgaba
   * de `.row__list`, que se fue con ellos, y desde entonces todo hueco sin portada
   * —y toda pieza cuya portada no llega, que sin red es lo normal— salía del mismo
   * gris. Se comprueban las seis posiciones y los seis campos: con cinco de los
   * seis, dos piezas contiguas vuelven a repetir degradado.
   */
  test('los seis campos de arte se reparten por posición', async () => {
    const css = await read(SHELL)
    const tokens = await read(TOKENS)

    for (const campo of ['a', 'b', 'c', 'd', 'e', 'f']) {
      expect(tokens, `falta el campo --cover-${campo} en tokens.css`).toContain(`--cover-${campo}:`)
      expect(css, `el campo --cover-${campo} no se reparte`).toContain(
        `--campo: var(--cover-${campo})`,
      )
    }

    const posiciones = [...css.matchAll(/\.mosaico > \.pz:nth-child\((6n \+ \d)\)/g)].map(
      (coincidencia) => coincidencia[1] ?? '',
    )

    expect(posiciones.sort()).toEqual(['6n + 1', '6n + 2', '6n + 3', '6n + 4', '6n + 5', '6n + 6'])
  })

  /**
   * El arte de la pieza se coloca contra la pieza, no contra su pie.
   *
   * `position: absolute` se resuelve contra el ancestro posicionado más cercano, y
   * con el enlace en el flujo ése era el enlace: medía lo que su texto, así que la
   * portada de una pieza 2x2 —la del top, la de continuar viendo— salía como una
   * tira pegada abajo y el resto del hueco quedaba en negro. El resultado no se
   * puede medir sin un navegador; se mide la regla que lo decide, que es una.
   */
  test('el enlace de la pieza cubre el hueco entero', async () => {
    const css = await read(SHELL)
    const enlace = /\.pz__enlace\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''

    expect(enlace, 'falta .pz__enlace en shell.css').not.toBe('')
    expect(enlace).toContain('position: absolute')
    expect(enlace).toContain('inset: 0')
    // Y no vuelve el `block-size: 100%`, que no resolvía nada: contra una fila de
    // altura automática, un porcentaje se lee como `auto` y el arte vuelve a la
    // tira de abajo.
    expect(enlace).not.toContain('block-size: 100%')
  })

  /**
   * La tipografía llega de verdad.
   *
   * Una familia nombrada en `--font-sans` que no resuelve a ningún archivo no da
   * ningún error: la página se pinta con la letra del sistema y parece que todo
   * está bien. Es lo que pasaba con Fraunces y Manrope, que se nombraban y no se
   * cargaban en ningún sitio, y nadie lo notaba porque el diseño no se rompe.
   *
   * Lo que se mide es el camino entero: cada `src` de un `@font-face` de la hoja
   * existe en el disco y es un woff2 de verdad —los cuatro primeros bytes—, y la
   * familia que empieza las pilas de texto y de titulares es la que declara el
   * `@font-face`. Cambiar el nombre en un sitio y no en el otro —el error que
   * dejaría la aplicación sin su letra— falla aquí.
   */
  test('la letra que nombran los tokens es la que se carga', async () => {
    const css = await read(TOKENS)
    const caras = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((cara) => cara[1] ?? '')

    expect(caras.length, 'no hay ningún @font-face en tokens.css').toBeGreaterThan(0)

    const familias: string[] = []
    const fuentes: string[] = []

    for (const cara of caras) {
      const familia = /font-family:\s*"([^"]+)"/.exec(cara)?.[1]
      if (familia !== undefined) familias.push(familia)

      expect(cara, 'una cara sin `font-display` deja el titular invisible').toContain(
        'font-display: swap',
      )

      for (const fuente of cara.matchAll(/url\("([^"]+)"\)/g)) fuentes.push(fuente[1] ?? '')
    }

    expect(fuentes.length).toBeGreaterThan(0)

    for (const fuente of fuentes) {
      // Relativa a la hoja, que es como la resuelve el empaquetador.
      const ruta = fileURLToPath(
        new URL(`./styles/${fuente.replace(/^\.\//, '')}`, import.meta.url),
      )
      const archivo = Bun.file(ruta)

      expect(await archivo.exists(), `la cara apunta a ${fuente}, que no existe`).toBe(true)

      const bytes = new Uint8Array(await archivo.arrayBuffer())
      const firma = new TextDecoder().decode(bytes.subarray(0, 4))

      // `wOF2` es la firma del contenedor: un archivo truncado o un HTML de error
      // con extensión `.woff2` se colaría sin esta comprobación.
      expect(firma, `${fuente} no es un woff2`).toBe('wOF2')
    }

    for (const pila of ['--font-sans', '--font-display']) {
      // Si la pila no está en la hoja, la cadena vacía no figura entre las familias
      // declaradas y la comprobación de abajo falla nombrando el token que falta.
      const familia = new RegExp(`${pila}:\\s*"([^"]+)"`).exec(css)?.[1] ?? ''

      expect(familias, `${pila} nombra una familia que no declara ningún @font-face`).toContain(
        familia,
      )
    }
  })

  test('respeta la preferencia de movimiento reducido', async () => {
    expect(await read(TOKENS)).toContain('prefers-reduced-motion')
  })

  test('tiene tema claro además del oscuro', async () => {
    expect(await read(TOKENS)).toMatch(/data-theme=["']light["']/)
  })
})
