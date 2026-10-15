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
   * El asomo sólo se enseña donde cabe.
   *
   * La caja del asomo mide entre 7 y 9,5 rem: más que una pieza de una sola fila
   * —112 a 152 px—, y con el recorte de la pieza se leería a medias. Donde no
   * cabe, la pieza no lo enseña.
   */
  test('la pieza de una sola fila no enseña el asomo', async () => {
    const css = await read(SHELL)

    expect(css).toContain('.pz.pz--s .pz__asomo')
    expect(css).toContain('.pz.pz--w .pz__asomo')
    expect(css).toContain('display: none')
  })

  test('respeta la preferencia de movimiento reducido', async () => {
    expect(await read(TOKENS)).toContain('prefers-reduced-motion')
  })

  test('tiene tema claro además del oscuro', async () => {
    expect(await read(TOKENS)).toMatch(/data-theme=["']light["']/)
  })
})
