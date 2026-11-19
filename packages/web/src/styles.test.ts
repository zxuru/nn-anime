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
const ESTILOS = fileURLToPath(new URL('./styles/', import.meta.url))

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
  return `${await readIfExists(TOKENS)}\n${await estructura()}`
}

/**
 * La estructura entera, en orden de cascada.
 *
 * `shell.css` es la entrada y no lleva reglas: importa una hoja por
 * responsabilidad. Leer sólo la entrada dejaría fuera todas las reglas, así que se
 * recorre el mismo camino que el empaquetador —la entrada, y cada `@import` en su
 * orden—. El orden importa aquí dentro: varias pruebas dependen de él, como el
 * último bloque de movimiento reducido o el `@media` que apaga el asomo.
 */
async function estructura(): Promise<string> {
  const entrada = await read(SHELL)
  const hojas = [...entrada.matchAll(/@import\s+"([^"]+\.css)"/g)].map(
    (coincidencia) => coincidencia[1] ?? '',
  )

  expect(hojas.length, 'la entrada de los estilos no importa ninguna hoja').toBeGreaterThan(0)

  const partes: string[] = []
  for (const hoja of hojas) partes.push(await read(`${ESTILOS}${hoja.replace(/^\.\//, '')}`))

  return partes.join('\n')
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

  /**
   * Una clase que el marcado no tiene no vuelve a la hoja.
   *
   * `.buscador*`, `.home__refresco`, `.section__meta`, `.poster__cover` y
   * `.row__list` sobrevivieron a la home y a la ficha que las usaban: una regla que
   * no alcanza a ningún elemento no da error, ocupa la hoja y vuelve a parecer
   * viva en la siguiente revisión. Se comprueba aquí porque el camino general —de
   * la clase usada a la definida— no ve la dirección contraria. Los comentarios se
   * quitan antes de mirar: la historia de una clase retirada se puede contar sin que
   * la regla exista.
   */
  test('una clase que el marcado ya no tiene no vuelve a la hoja', async () => {
    const css = (await estructura()).replace(/\/\*[\s\S]*?\*\//g, '')

    for (const muerta of [
      'buscador',
      'home__refresco',
      'section__meta',
      'poster__cover',
      'row__list',
      // El panel del motor se retiró con sus dos hijos (T240): sus reglas seguían
      // aquí sin que ningún componente las alcanzara.
      'panel',
      'reason',
      'score',
    ]) {
      expect(css, `.${muerta} volvió a la hoja y ningún componente la usa`).not.toContain(
        `.${muerta}`,
      )
    }

    // Y sus tokens, que sólo existían para esas reglas.
    expect(await read(TOKENS)).not.toContain('--buscador-')
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
    const css = await estructura()

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\brgb\(/)
  })

  /**
   * El esqueleto de una pantalla que carga.
   *
   * Los cuatro usos —detalle, perfil, historial y búsqueda— son
   * `<span class="skeleton">` vacíos. Un span es inline: sin `display: block` no
   * tiene caja propia, `min-height` no se aplica y el esqueleto no se ve aunque
   * esté en el marcado. Eso es lo que hacía parecer que la pantalla se quedaba sin
   * datos. La prueba sujeta las dos declaraciones que lo convierten en caja.
   */
  test('el esqueleto de carga es una caja, no un span vacío', async () => {
    const css = await estructura()
    const inicio = css.indexOf('.skeleton {')

    expect(inicio).toBeGreaterThan(-1)

    const bloque = css.slice(inicio, css.indexOf('}', inicio))

    expect(bloque).toContain('display: block')
    expect(bloque).toContain('inline-size: 100%')
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
    const css = await estructura()

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
      ...(await estructura()).matchAll(/@media[^{]*\((?:max|min)-width:\s*(\d+px)\)/g),
    ].map((match) => match[1])

    expect(usados.length, 'no hay ninguna consulta de ancho que comprobar').toBeGreaterThan(0)

    for (const ancho of usados) {
      expect(declarados, `el ancho ${ancho} de un @media no está en tokens.css`).toContain(ancho)
    }
  })

  /**
   * La nota de un tramo no vive al margen donde no cabe.
   *
   * La canaleta es de dos columnas; por debajo de 1400 una sola mide ~84 px a 1280
   * y el titular —hasta 1,75 rem— no cabe dentro: se cortaba bajo el primer cartel
   * y «Recomendado para ti» se leía «Recomen». Lo que se sujeta es el
   * emparejamiento, que es lo que se rompió: en la misma consulta en la que el
   * mosaico aprieta a cuatro columnas, la nota vuelve a ser cabecera del tramo. La
   * prueba no mide el ancho de la columna —eso pide navegador—, mide que no se
   * vuelva a estrechar sin devolver la nota a su sitio.
   */
  test('la nota deja de ir al margen cuando el mosaico se aprieta', async () => {
    const css = await estructura()
    const bloque = /@media \(max-width: 1400px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''

    expect(bloque, 'falta el bloque de 1400').toContain('.mosaico')
    expect(bloque, 'la nota sigue al margen con el mosaico apretado').toContain('.seccion {')
    expect(bloque).toContain('display: block')
    expect(bloque).toContain('position: static')

    // Y la canaleta estrecha no vuelve por su cuenta en ninguna otra consulta.
    expect(css).not.toContain('--vitrina-canaleta: 1')
  })

  /**
   * La navegación se muda a una barra fija en la pantalla estrecha.
   *
   * El salto no se puede medir sin navegador, pero sí lo que lo decide: que la
   * cabecera de destinos se esconda, que la barra sea fija y que el contenido
   * aparte su alto. Sin la reserva, el último renglón de cada pantalla quedaba
   * debajo de la barra y ninguna prueba de componente se enteraba. Y la etiqueta
   * corta sólo sustituye a la larga cuando hay dos versiones: sin `short`, la
   * completa se queda, porque es el nombre del mando.
   */
  test('la navegación se muda a una barra fija en la pantalla estrecha', async () => {
    const css = await estructura()
    const bloque = /@media \(max-width: 640px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''

    expect(bloque, 'falta el bloque de 640').not.toBe('')
    expect(bloque).toMatch(/\.shell__nav\s*\{[^}]*display:\s*none/)
    expect(bloque).toMatch(/\.barra\s*\{[^}]*position:\s*fixed/)
    expect(bloque).toContain('env(safe-area-inset-bottom)')
    expect(bloque).toContain('var(--barra-alto)')
    expect(bloque).toContain('.icon-label--con-corto .icon-label__largo')
    expect(bloque).toMatch(/\.shell__main\s*\{[^}]*padding-block-end/)
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
    const css = await estructura()

    const mando = /\.player__control\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(mando).toContain('min-width: var(--control-size)')
    expect(mando).toContain('min-height: var(--control-size)')

    // Y el truco viejo no vuelve por su cuenta: dos rótulos superpuestos en el
    // mismo botón son dos nombres accesibles a la vez.
    expect(css).not.toContain('.player__label--alterno')
  })

  /**
   * La imagen del reproductor no lleva contorno.
   *
   * El borde de 2 px se leía como una línea blanca pegada a todo el contenido
   * —en el tema oscuro `--color-border` es casi blanco— y separaba la imagen del
   * fondo de la página como si fuera una caja. El lienzo del modo compatible
   * comparte caja con el video, así que si él conservara el borde el contorno
   * volvería al encenderlo.
   */
  test('la imagen del reproductor no lleva contorno', async () => {
    const css = await estructura()

    for (const selector of ['.player__video', '.player__canvas']) {
      const cuerpo = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''

      expect(cuerpo, `falta ${selector} en la estructura`).not.toBe('')
      expect(cuerpo, `${selector} lleva borde`).not.toContain('border:')
    }
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
    const css = await estructura()

    /** El cuerpo de una regla, por su selector exacto. */
    const regla = (selector: string): string => {
      const desde = css.indexOf(`${selector} {`)
      if (desde === -1) return ''

      return css.slice(desde, css.indexOf('}', desde))
    }

    // El título arriba y los datos debajo: dos renglones y no uno compartido.
    const cuerpo = regla('.related__body')
    expect(cuerpo, 'falta .related__body en la estructura').toContain('display: flex')
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
   * El velo del banner acaba en el fondo de la página.
   *
   * Es lo que sostiene el titular, y no una cuestión de gusto: debajo hay una
   * fotografía cualquiera, así que el texto se lee porque la última parada del
   * velo es **opaca** y del color del tema. Medido sobre el banner real de una
   * ficha emparejada —la captura del recuadro del titular, con la letra
   * escondida— el peor píxel queda en 4.61:1 en el tema oscuro y 6.48:1 en el
   * claro. Eso no se puede medir sin navegador, pero lo que lo decide, sí.
   */
  test('el velo de la banda acaba en el fondo del tema', async () => {
    const css = await estructura()
    const desde = css.indexOf('.detail__banner-fondo::after {')

    expect(desde, 'falta el velo de la banda en la estructura').toBeGreaterThan(-1)

    const velo = css.slice(desde, css.indexOf('}', desde))

    // La última parada, opaca y del fondo de la página: es lo que deja el
    // titular sobre un color conocido y no sobre lo que la imagen tenga ahí.
    expect(velo).toContain('var(--color-bg) 100%')
    expect(velo).not.toContain('transparent 100%')
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

    const capasDelContenido = [...(await estructura()).matchAll(/z-index:\s*(\d+)/g)].map((match) =>
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
    const css = await estructura()

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
    const css = await estructura()
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
    const css = await estructura()
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
    const css = await estructura()
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
    const css = await estructura()

    for (const recurso of ['trama', 'mitad', 'circulo', 'caja']) {
      expect(css, `falta el recurso ${recurso}`).toContain(`.pz__campo--${recurso}`)
    }

    // Y los dos que son texto, que se pintan dentro del campo.
    expect(css).toContain('.pz__letra')
    expect(css).toContain('.pz__cifra')
  })

  /**
   * El velo de la cifra del top lo llevan **sólo** las piezas numeradas.
   *
   * La cifra va sobre el arte y el crema no se lee sobre una portada clara, así que
   * el puesto lleva un velo corto en su esquina. Colgado de `.pz` a secas, ese velo
   * oscurecería la esquina de todas las piezas de la home —buscar, novedades,
   * favoritos— sin que ninguna otra prueba se enterara: es un recorte de arte, y el
   * arte no se mide sin navegador. Aquí se mide de quién cuelga.
   */
  test('el velo del puesto cuelga de la pieza numerada', async () => {
    const css = await estructura()
    // Sin comentarios: el selector de una regla se lee desde el cierre de la
    // anterior, y el comentario que la explica viaja con él.
    const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const reglas = [...sinComentarios.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((regla) =>
      (regla[2] ?? '').includes('var(--velo-puesto)'),
    )

    expect(reglas, 'no hay ninguna regla que pinte el velo del puesto').toHaveLength(1)
    expect((reglas[0]?.[1] ?? '').trim()).toBe('.pz--puesto .pz__velo::before')
    expect(reglas[0]?.[2], 'el velo del puesto no dura lo que la cifra').toContain(
      'block-size: var(--velo-puesto-alto)',
    )
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
    const css = await estructura()
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
    const css = await estructura()
    const enlace = /\.pz__enlace\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''

    expect(enlace, 'falta .pz__enlace en la estructura').not.toBe('')
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
   * familia que empieza las pilas de texto, de titulares y de datos es la que declara
   * el `@font-face`. Cambiar el nombre en un sitio y no en el otro —el error que
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

    for (const pila of ['--font-sans', '--font-display', '--font-mono']) {
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

/**
 * La cabecera y el filtro de formato.
 *
 * Lo que se pide aquí es de **medida** y no de gusto: el filtro es el único eje
 * del producto y su estado tiene que seguir a la vista, medir lo que un mando y
 * no desbordar la cabecera cuando se pega debajo.
 */
describe('la cabecera y el filtro de formato', () => {
  /** El cuerpo de una regla, por su selector exacto. */
  async function reglaDe(selector: string): Promise<string> {
    const css = await estructura()
    const desde = css.indexOf(`${selector} {`)
    if (desde === -1) return ''

    return css.slice(desde, css.indexOf('}', desde))
  }

  test('la cabecera no crece: su alto sale del token', async () => {
    expect(await reglaDe('.shell__header')).toContain('min-height: var(--header-height)')
    expect(await reglaDe('.shell__header')).toContain('padding: var(--space-1) var(--space-6)')
  })

  test('el filtro se pega bajo la cabecera y se lee sobre el contenido', async () => {
    const filtro = await reglaDe('.formato')

    expect(filtro).toContain('position: sticky')
    expect(filtro).toContain('top: var(--header-height)')
    expect(filtro).toContain('background: var(--color-bg)')
    expect(filtro).toContain('border-block-end: var(--border-width) solid var(--color-rule)')
  })

  test('cada opción mide el mando entero y el carril usa su relleno', async () => {
    // 44 px es el objetivo táctil que promete PRODUCT.md; antes medía 40.
    expect(await reglaDe('.formato__opcion')).toContain('min-block-size: var(--control-size)')
    expect(await reglaDe('.formato__opciones')).toContain('padding: var(--formato-relleno)')
  })

  test('la opción activa se distingue por fondo y contraste', async () => {
    const activa = await reglaDe('.formato__opcion[aria-current="page"]')

    expect(activa).toContain('background: var(--color-accent)')
    expect(activa).toContain('color: var(--color-accent-contrast)')
  })

  test('el rótulo se ve en escritorio y se deja al lector en pantalla estrecha', async () => {
    const css = await estructura()

    expect(await reglaDe('.formato__rotulo')).toContain('text-transform: uppercase')
    expect(css).toContain('@media (max-width: 40rem)')
    expect(css).toContain('.formato__rotulo')
  })

  /**
   * El Perfil cierra la cabecera, empujado por un solo `auto`.
   *
   * Si la guía recuperara el suyo, el hueco se repartiría entre dos márgenes y el
   * Perfil dejaría de estar pegado al borde. Por debajo de `--bp-nav` el grupo se
   * apaga con el resto de la navegación y la barra inferior es la que lo lleva.
   */
  test('el Perfil cierra la cabecera, empujado por un solo margen', async () => {
    expect(await reglaDe('.shell__nav--separado')).toContain('margin-inline-start: auto')
    expect(await reglaDe('.shell__guia')).toContain('margin-inline-start: 0')
  })
})

/**
 * La ficha a sangre.
 *
 * La banda era una tarjeta dentro de la caja de la pantalla: de ahí el marco que
 * se le veía y el aire que la separaba de la cabecera. Lo que se mide aquí no se
 * ve en el DOM —el mismo marcado se pinta pegado o flotando según estas
 * declaraciones— y sin la medida en las dos cajas de dentro el titular queda
 * desalineado de las columnas: en una ventana de 2560 px, el nombre a 32 px del
 * borde y la sinopsis a 680.
 */
describe('la ficha a sangre', () => {
  /** El cuerpo de una regla, por su selector exacto. */
  async function regla(selector: string): Promise<string> {
    const css = await estructura()
    const desde = css.indexOf(`${selector} {`)
    if (desde === -1) return ''

    return css.slice(desde, css.indexOf('}', desde))
  }

  test('la caja de la pantalla no tiene tope de ancho ni relleno', async () => {
    const caja = await regla('.shell__main--ficha')

    expect(caja, 'falta .shell__main--ficha en la estructura').not.toBe('')
    // A sangre: la banda tiene que llegar a los dos bordes de la ventana.
    expect(caja).toContain('max-inline-size: none')
    // Y sin relleno: el aire es lo que separaba la banda de la cabecera.
    expect(caja).toContain('padding: 0')
  })

  test('la banda pierde el marco y conserva su alto', async () => {
    const banda = await regla('.detail__banner')

    expect(banda).not.toContain('border:')
    expect(banda).not.toContain('border-radius')
    // Y sigue siendo una cabecera: su alto no depende de la imagen.
    expect(banda).toContain('min-block-size: var(--detail-banner-alto)')
    // Sin relleno en línea: el que alinea el titular lo pone la caja de dentro.
    expect(banda).toContain('padding-block: var(--space-6)')
  })

  test('la medida del sitio vive en las dos cajas de dentro', async () => {
    for (const selector of ['.detail__banner-caja', '.detail__cuerpo']) {
      const caja = await regla(selector)

      expect(caja, `falta ${selector} en la estructura`).not.toBe('')
      expect(caja).toContain('max-inline-size: var(--content-max)')
      expect(caja).toContain('margin-inline: auto')
    }

    // El mismo relleno en línea en las dos: es lo que alinea el titular con las
    // columnas. La de la banda sólo tiene ése; el cuerpo reparte también el aire
    // de arriba, que es el hueco con la banda.
    expect(await regla('.detail__banner-caja')).toContain('padding-inline: var(--space-6)')
    expect(await regla('.detail__cuerpo')).toContain('padding: var(--space-7) var(--space-6)')

    // La rejilla de dos columnas ya no está en `.detail`, que es la caja a lo
    // ancho: si volviera, la banda se partiría en dos columnas de 17rem y 1fr.
    expect(await regla('.detail')).not.toContain('grid-template-columns')
    expect(await regla('.detail__cuerpo')).toContain(
      'grid-template-columns: minmax(var(--grid-min), var(--aside-width)) 1fr',
    )
  })
})

/**
 * Movimiento y superficies.
 *
 * El movimiento de la casa no se mide mirando una animación, sino las reglas que
 * la hacen posible: que los tokens existan, que la hoja sea un diálogo nativo y
 * no un `div` con `aria-modal`, que el menú cerrado no sea una parada de foco y
 * que el asomo oculto no esté en el orden de tabulación. Son los fallos que no
 * rompen ninguna prueba de componente y sólo se ven con el teclado delante.
 */
describe('movimiento y superficies', () => {
  test('los tokens de entrada y salida están definidos', async () => {
    const tokens = await read(TOKENS)

    for (const token of [
      '--transition-slow',
      '--ease-exit',
      '--motion-rise',
      '--motion-blur',
      '--motion-scale',
      '--skeleton-pulse',
    ]) {
      expect(tokens, `falta ${token} en tokens.css`).toContain(`${token}:`)
    }
  })

  /**
   * El esqueleto se desliza con su propio ritmo, y se apaga.
   *
   * La animación del esqueleto de la ficha es un degradado que se desplaza, no el
   * pulso de opacidad de la vitrina: se mide que use su token —1,4 s— y que el
   * pulso viejo siga siendo el de `.esq`, que no se cambió.
   */
  test('el esqueleto se desliza con su propio ritmo, y se apaga', async () => {
    const css = await estructura()
    const skeleton = /\.skeleton\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    const esq = /\.esq\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''

    expect(skeleton).toContain('var(--skeleton-shimmer)')
    expect(esq).toContain('var(--skeleton-pulse)')

    // El `animation: none` tiene que ir después de `.esq` o no lo apaga: el
    // bloque de movimiento reducido vive al final del archivo.
    const reducido = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reducido).toContain('.esq')
    expect(reducido).toContain('.skeleton')
    expect(reducido).toContain('.player__tooltip')
  })

  /**
   * El paso de la encuesta entra con la animación de la casa, y se apaga.
   *
   * La animación cuelga del envoltorio que lleva `key={step}`: si el nodo no se
   * sustituye, el navegador no vuelve a correr la entrada y el cambio de pregunta
   * sigue siendo un salto seco. Y el bloque de movimiento reducido tiene que
   * nombrarla, como al resto.
   */
  test('el paso de la encuesta entra y se apaga', async () => {
    const css = await estructura()
    const cuerpo = /\.gustos__paso-cuerpo\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    const encuesta = await read(`${ROOT}features/taste/TasteSurvey.tsx`)

    expect(cuerpo).toContain('var(--entrada-duracion)')
    expect(cuerpo).toContain('var(--entrada-curva)')
    expect(encuesta).toContain('key={step}')
    expect(encuesta).toContain('className="gustos__paso-cuerpo"')

    const reducido = css.slice(
      css.indexOf(
        '@media (prefers-reduced-motion: reduce)',
        css.indexOf('.gustos__progreso-relleno'),
      ),
    )
    expect(reducido.slice(0, reducido.indexOf('\n}'))).toContain('.gustos__paso-cuerpo')
  })

  test('la hoja es un diálogo nativo, no un div con aria-modal', async () => {
    const panel = (await read(`${ROOT}components/PanelPieza.tsx`)).replace(/\/\*[\s\S]*?\*\//g, '')

    expect(panel).toContain('<dialog')
    expect(panel).toContain('showModal()')
    expect(panel).not.toContain('aria-modal')
    expect(panel).not.toContain('role="dialog"')
    // El fondo nativo no bloquea el desplazamiento: el componente lo hace.
    expect(panel).toContain('document.body.style.overflow')
    expect(panel).toContain('cerrar.current?.focus()')
  })

  test('el menú del reproductor se queda montado para poder salir', async () => {
    const player = await read(`${ROOT}features/player/Player.tsx`)
    const css = await estructura()

    expect(player).toContain('data-abierto={menu}')
    expect(player).toContain('inert={!menu}')
    expect(player).toContain('aria-hidden={!menu}')
    expect(css).toContain('.player__menu[data-abierto="true"]')
    expect(css).toMatch(/\.player__menu\s*\{[^}]*visibility: hidden/s)
  })

  test('el asomo oculto no es una parada de tabulación', async () => {
    const css = await estructura()
    const asomo = /\.pz__asomo\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''

    expect(asomo).toContain('visibility: hidden')
    expect(css).toMatch(/\.pz:hover \.pz__asomo[\s\S]*?visibility: visible/)
  })

  test('la cabecera marca el destino y ofrece el salto al contenido', async () => {
    const css = await estructura()

    expect(css).toContain('.shell__nav a[aria-current="page"]')
    expect(css).toContain('.shell__saltar')
    expect(css).toContain('.shell__saltar:focus-visible')
  })

  test('el botón de contorno de la marquesina no depende del tema', async () => {
    const css = await estructura()

    expect(css).toContain('.marquesina .acciones .button:not(')
    expect(css).not.toContain('.marquesina[data-tinta="oscura"] .acciones')
  })

  /**
   * Ningún `var()` de la hoja que no esté definido.
   *
   * `var(--color-muted)` no da error: el navegador descarta la declaración y el
   * texto se queda con el color heredado. Así vivieron tres reglas de Descargas
   * hasta que alguien miró la pantalla. Esta prueba convierte el token
   * inexistente en un fallo.
   */
  test('todo var() de la hoja de estructura está definido', async () => {
    const css = await estructura()
    const tokens = await read(TOKENS)
    const definidos = new Set(
      [...`${tokens}\n${css}`.matchAll(/--([\w-]+)\s*:/g)].map((match) => match[1] ?? ''),
    )

    const usados = [...css.matchAll(/var\(--([\w-]+)/g)].map((match) => match[1] ?? '')

    expect(usados.length).toBeGreaterThan(0)

    for (const nombre of usados) {
      expect(definidos, `--${nombre} se usa en la estructura y no está definido`).toContain(nombre)
    }
  })
})

/**
 * Los mandos que se encienden sobre el fotograma.
 *
 * El puntero y el estado pintan fondo y tinta en la misma regla: escritos por
 * separado, `.button:hover:not(:disabled)` devuelve el fondo a la superficie
 * mientras la tinta se queda la del acento, y el dibujo acaba casi negro sobre
 * casi negro. No rompe ninguna prueba de componente —el marcado es el mismo— y
 * sólo se ve con el ratón encima; por eso se mide aquí, en el selector que decide
 * quién gana la cascada.
 */
describe('el reproductor sobre el fotograma', () => {
  test('el puntero de los mandos de arriba gana al botón general', async () => {
    const css = await estructura()

    for (const mando of ['player__pip', 'player__cast', 'player__airplay']) {
      // Con `.player__acciones .button` delante pesa más que
      // `.button:hover:not(:disabled)`. Sin eso el fondo se quedaba en la
      // superficie y la tinta en la del acento: 1,4:1, medido.
      expect(css, `el hover de ${mando} perdió la caja y el botón`).toContain(
        `.player__acciones .button.${mando}:hover`,
      )
      expect(css, `el hover de ${mando} volvió a la regla floja`).not.toMatch(
        new RegExp(`(^|\\n)\\.${mando}:hover`),
      )
    }
  })

  test('el mando de seguir solo lleva su par de contraste', async () => {
    const css = await estructura()
    const selector = '.player__controls .button.player__autoplay[aria-pressed="true"]'
    const desde = css.indexOf(selector)

    expect(desde, 'falta la regla del mando encendido').toBeGreaterThan(-1)

    const regla = css.slice(desde, css.indexOf('}', desde))

    // La fila pinta de overlay todo mando que no sea el primario; encendido, este
    // lleva el acento y la tinta que lo contrasta, y la fila entera delante para
    // ganar a esa regla.
    expect(regla).toContain('background: var(--color-accent)')
    expect(regla).toContain('color: var(--color-accent-contrast)')
    // Sin casilla propia: el interruptor se fue con la regla del carril y el
    // tirador, que nadie dibuja ya.
    expect(css).not.toContain('.player__switch')
  })

  /**
   * La fila de mandos va siempre en una línea.
   *
   * `nowrap` no es un gusto: la banda de mandos mide lo que un renglón
   * —`--player-band-height`— y es lo que despeja el botón de saltar y la tarjeta
   * del siguiente. Con la fila partida en dos, la banda crece, el botón de saltar
   * se apoya encima de la barra de progreso y la prueba del salto lo mide en rojo:
   * pasó al añadir el mando de la reproducción automática. El hueco es el compacto
   * de 6 px para que la fila siga cabiendo en una columna de 711 —una ventana de
   * 1280—, y en el teléfono lo que cede es el total del reloj, no la fila.
   */
  test('la fila de mandos va en una línea y la banda mide un renglón', async () => {
    const css = await estructura()
    const fila = /\.player__buttons\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''

    expect(fila, 'falta la fila de mandos').not.toBe('')
    expect(fila).toContain('flex-wrap: nowrap')
    expect(fila).toContain('gap: var(--gap-compact)')

    const banda = /--player-band-height: calc\(([^;]*)\);/.exec(await read(TOKENS))?.[1] ?? ''

    expect(banda).toContain('var(--control-size)')
    expect(banda).not.toContain('2 *')
  })
})

/**
 * La deuda visual que la revisión midió.
 *
 * Los cinco fallos de `docs/revision-frontend.md` (10 a 14) se ven en el
 * navegador, pero lo que los decide está escrito: el mosaico abre tantas pistas
 * como piezas lleva, la banda sin banner tiene su alto, la fila de un episodio no
 * lleva la sombra de una tarjeta, la cinta funde sus dos bordes y la barra del
 * móvil no recorta «Biblioteca». Las medidas y las capturas están en
 * `tasks/done/T236.md`; aquí se sujeta la regla que las produjo.
 */
describe('la deuda visual del shell', () => {
  /** El cuerpo de una regla, por su selector exacto. */
  async function reglaDe(selector: string): Promise<string> {
    const css = await estructura()
    const desde = css.indexOf(`${selector} {`)
    if (desde === -1) return ''

    return css.slice(desde, css.indexOf('}', desde))
  }

  /**
   * Quitar del historial no puede depender del puntero.
   *
   * El mando de la hoja se enciende con `:hover` porque es un extra; éste es una
   * acción que tiene que estar a la vista y alcanzarse con el tabulador. Si alguien
   * le copiara la regla del asomo, la tarjeta del teléfono se quedaría sin mando.
   */
  test('el mando de quitar se ve sin pasar el puntero', async () => {
    const css = await estructura()
    const regla = await reglaDe('.pz__quitar')

    expect(regla, 'falta la regla del mando').toContain('position: absolute')
    expect(regla).not.toContain('opacity: 0')
    expect(css).not.toMatch(/\.pz:hover[^{]*\.pz__quitar/)
  })

  test('el mosaico declara las mismas pistas en cada punto de corte', async () => {
    const css = await estructura()
    const mosaico = await reglaDe('.mosaico')

    // Seis pistas fijas en la rejilla ancha, repartiendo el ancho a partes
    // iguales. Antes abría tantas pistas como piezas llevaba el tramo —una fila de
    // cuatro engordaba sus carteles a 264×396 y una de siete los dejaba en
    // 171×256, en la misma pantalla—: el tamaño del cartel no puede depender de
    // cuántos títulos devolvió la fuente.
    expect(mosaico, 'falta la rejilla de seis pistas').toContain(
      'grid-template-columns: repeat(6, minmax(0, 1fr))',
    )
    // Y la fila se alinea al principio: un tramo corto acaba donde acaba.
    expect(mosaico).toContain('justify-content: start')

    // Nadie vuelve a leer el recuento de piezas.
    expect(css).not.toContain('var(--mosaico-piezas)')
    expect(css).not.toContain('--mosaico-pieza-max')

    // El vacío de un tramo no es una pieza: no se le compone la pista de una.
    expect(css).toContain('.mosaico:has(> .tramo-vacio)')

    // Cada punto de corte declara sus pistas: 4, 3, 2 y 5 —el teléfono tumbado—,
    // además del 6 de la rejilla ancha. El de una columna es `minmax(0, 1fr)` a
    // secas, porque una pista no necesita `repeat`.
    const pistas = [...css.matchAll(/\.mosaico\s*\{[^}]*?repeat\((\d), minmax\(0, 1fr\)\)/g)].map(
      (coincidencia) => coincidencia[1] ?? '',
    )

    expect(pistas.sort()).toEqual(['2', '3', '4', '5', '6'])
    expect(css).toContain('.mosaico {\n    grid-template-columns: minmax(0, 1fr);')
  })

  test('la banda de la ficha baja cuando no hay banner', async () => {
    const banda = await reglaDe('.detail__banner--sin-fondo')

    expect(banda, 'falta el alto condicional de la banda').not.toBe('')
    expect(banda).toContain('min-block-size: var(--detail-banner-alto-sin-fondo)')
    expect(await read(TOKENS)).toContain('--detail-banner-alto-sin-fondo: 10rem')
  })

  test('la fila de un episodio no lleva la sombra de una tarjeta', async () => {
    const episodio = await reglaDe('.episode')

    expect(episodio, 'falta la fila del episodio').not.toBe('')
    expect(episodio).not.toContain('box-shadow')
    // El realce de tono sí: el fondo sube al pasar el puntero.
    const realce =
      /\.episode:hover,\s*\.episode:focus-visible\s*\{([^}]*)\}/.exec(await estructura())?.[1] ?? ''
    expect(realce).toContain('background')
  })

  test('la cinta funde sus dos bordes', async () => {
    const pista = await reglaDe('.cinta__pista')

    expect(pista, 'falta la pista de la cinta').not.toBe('')
    expect(pista).toContain('mask-image: linear-gradient')
    expect(pista).toContain('transparent 0')
    expect(pista).toContain('transparent 100%')
    expect(pista).toContain('var(--cinta-fundido)')
    expect(await read(TOKENS)).toContain('--cinta-fundido: 2rem')
  })

  test('la barra del móvil no recorta la etiqueta más larga', async () => {
    const css = await estructura()

    // «Biblioteca» mide 67 px a 11 px de mono; un quinto de 320 son 64 y la
    // etiqueta se salía de su celda. La pista no baja de su contenido.
    expect(css).toContain('repeat(5, minmax(max-content, 1fr))')
  })
})
