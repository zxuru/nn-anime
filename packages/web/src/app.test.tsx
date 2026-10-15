import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { App } from './app'
import { createMemoryHistory, HistoryProvider } from './router'

/**
 * Renderizado en servidor, sin DOM.
 *
 * Sirve para fijar qué pinta la aplicación en cada ruta sin necesidad de una
 * biblioteca de DOM, que no está en la tabla de Tech Stack. Lo que se comprueba
 * es el marcado de salida, no el comportamiento reactivo.
 */
function render(path: string): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory(path)}>
      <App />
    </HistoryProvider>,
  )
}

describe('App: pantallas', () => {
  test('la raíz es la pantalla de inicio, con su panel', () => {
    // La home arranca con el panel cargando: el primer render no depende de una
    // petición, que en servidor no hay.
    const html = render('/')

    expect(html).toContain('Inicio')
    expect(html).toContain('Recomendado para ti')
    expect(html).not.toContain('Aquí irán')
  })

  test('la búsqueda tiene su propia pantalla, con su campo y su estado vacío', () => {
    const html = render('/search')

    expect(html).toContain('Buscar por título')
    expect(html).toContain('type="search"')
    expect(html).toContain('Escribe un título')
  })

  test('los ajustes tienen su propia pantalla, y arranca cargando', () => {
    const html = render('/settings')

    expect(html).toContain('Ajustes')
    expect(html).toContain('Cargando los ajustes')
    expect(html).not.toContain('los proveedores, las rutas de datos')
  })

  test('el detalle arranca con su esqueleto, sin esperar a la red', () => {
    // El primer render no puede depender de una petición: en servidor no hay
    // `useEffect`, y en el navegador la ficha llega después. Que la referencia
    // llegue a la petición se comprueba en las pruebas de la pantalla.
    const html = render('/anime/fuente/titulo-1')

    expect(html).toContain('Cargando la ficha')
    expect(html).toContain('aria-busy="true"')
  })

  test('el reproductor tiene su propia pantalla, y arranca cargando', () => {
    // La pantalla resuelve el stream en un efecto, así que en servidor se ve su
    // estado de carga. Que el `<video>` aparece con una fuente se prueba en las
    // pruebas del reproductor.
    const html = render('/watch/fuente/titulo-1')

    expect(html).toContain('Cargando el video')
    expect(html).not.toContain('Aquí irá')
  })
})

describe('App: cabecera', () => {
  test('muestra el nombre de la aplicación desde el catálogo', () => {
    expect(render('/')).toContain('nn-anime')
  })

  test('los tres enlaces de navegación son enlaces reales', () => {
    const html = render('/')

    expect(html).toContain('href="/"')
    expect(html).toContain('href="/search"')
    expect(html).toContain('href="/settings"')
  })
})

/**
 * El conmutador de tipo, dentro de la cabecera y sólo donde significa algo.
 *
 * Cambió de sitio: vivía en una franja propia encima de la marquesina y ahora va
 * en la cabecera, al final. Lo que se mide es la decisión de dónde sale —la mitad
 * que se mira parte en dos la vitrina y la búsqueda, y en una ficha, en el
 * reproductor o en los ajustes no hay nada que partir— y que sale **dentro** de la
 * cabecera, que es el cambio. Que cada mitad sea un enlace con su `aria-current` se
 * mide en la prueba del conmutador.
 */
describe('App: el conmutador de tipo en la cabecera', () => {
  /**
   * El marcado de la cabecera, que es donde se decide si el mando está.
   *
   * Falla si no encuentra la cabecera: una cabecera vacía daría por bueno el
   * «no sale» de las pantallas donde no toca sin haber mirado nada.
   */
  function cabecera(path: string): string {
    const trozo = /<header class="shell__header">([\s\S]*?)<\/header>/.exec(render(path))
    if (trozo === null) throw new Error(`la cabecera no está en el marcado de ${path}`)

    return trozo[1] ?? ''
  }

  test('sale en la vitrina y en la búsqueda', () => {
    for (const ruta of ['/', '/search']) {
      expect(cabecera(ruta), `el conmutador falta en la cabecera de ${ruta}`).toContain(
        'aria-label="Tipo de contenido"',
      )
    }
  })

  test('no sale donde no hay dos mitades que elegir', () => {
    for (const ruta of ['/anime/fuente/titulo-1', '/watch/fuente/titulo-1', '/settings']) {
      expect(cabecera(ruta), `el conmutador no pinta nada en ${ruta}`).not.toContain(
        'Tipo de contenido',
      )
    }
  })
})

describe('App: ruta desconocida', () => {
  test('dice que la ruta no existe', () => {
    expect(render('/no-existe')).toContain('Esa ruta no existe')
  })

  test('nombra la ruta pedida, que es la que leyó el enrutador', () => {
    // Este es el caso que el código anterior no cumplía: leía la ruta de
    // `window.location` en lugar del historial, así que en cualquier contexto
    // sin `window` el mensaje salía con la ruta vacía.
    expect(render('/no-existe')).toContain('/no-existe')
  })

  test('nombra una ruta anidada entera', () => {
    expect(render('/muy/raro/esto')).toContain('/muy/raro/esto')
  })
})

/**
 * App: la caja de cada pantalla.
 *
 * La caja es la que decide si la pantalla llega a los bordes de la ventana o se
 * queda en la columna de lectura de 1200 px. Es una decisión de composición, y
 * por eso se mide en el marcado: la vitrina va a sangre —su marquesina cruza la
 * pantalla— y el reproductor va sin tope —el video se mide contra la ventana—.
 */
describe('App: la caja de la pantalla', () => {
  /** La clase del `<main>`, que es donde la decisión se ve. */
  function caja(path: string): string {
    const trozo = /<main class="([^"]*)"/.exec(render(path))
    if (trozo === null) throw new Error(`no hay <main> en el marcado de ${path}`)

    return trozo[1] ?? ''
  }

  test('la vitrina va a sangre', () => {
    expect(caja('/')).toContain('shell__main--ancha')
  })

  test('el reproductor va sin tope y con relleno', () => {
    const clase = caja('/watch/fuente/titulo-1')

    expect(clase).toContain('shell__main--sin-tope')
    // A sangre no: el relleno es el margen del video, y sin él quedaría pegado
    // al borde de la ventana.
    expect(clase).not.toContain('shell__main--ancha')
  })

  test('la ficha y la búsqueda se quedan en la columna de siempre', () => {
    for (const ruta of ['/anime/fuente/titulo-1', '/search', '/settings']) {
      expect(caja(ruta), `la caja de ${ruta} cambió de ancho`).toBe('shell__main')
    }
  })
})
