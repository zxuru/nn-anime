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
  test('la raíz es la pantalla de inicio', () => {
    const html = render('/')

    expect(html).toContain('Aquí irán las recomendaciones')
  })

  test('la búsqueda tiene su propia pantalla, con su campo y su estado vacío', () => {
    const html = render('/search')

    expect(html).toContain('Buscar por título')
    expect(html).toContain('type="search"')
    expect(html).toContain('Escribe un título')
  })

  test('los ajustes tienen su propia pantalla', () => {
    expect(render('/settings')).toContain('los proveedores, las rutas de datos')
  })

  test('el detalle arranca con su esqueleto, sin esperar a la red', () => {
    // El primer render no puede depender de una petición: en servidor no hay
    // `useEffect`, y en el navegador la ficha llega después. Que la referencia
    // llegue a la petición se comprueba en las pruebas de la pantalla.
    const html = render('/anime/fuente/titulo-1')

    expect(html).toContain('Cargando la ficha')
    expect(html).toContain('aria-busy="true"')
  })

  test('el reproductor tiene su propia pantalla', () => {
    expect(render('/watch/fuente/titulo-1')).toContain('el reproductor')
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
