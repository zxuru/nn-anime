import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { ErrorBoundary, FalloDeRender } from './ErrorBoundary'

/**
 * Lo que se puede medir sin un DOM.
 *
 * React **no** ejecuta las fronteras durante el renderizado de servidor: un
 * componente que lanza con `renderToString` propaga la excepción en vez de
 * pintar el fallback. Por eso lo que se prueba es la frontera entera menos el
 * montaje: el estado que produce el error y el marcado real del fallback.
 */
describe('la red de render', () => {
  test('sin fallo pinta el árbol que le dan', () => {
    const html = renderToString(
      <ErrorBoundary>
        <p>contenido</p>
      </ErrorBoundary>,
    )

    expect(html).toContain('contenido')
  })

  test('un error de render se convierte en el estado de fallo', () => {
    const estado = ErrorBoundary.getDerivedStateFromError(new Error('boom'))

    expect(estado.fallo?.message).toBe('boom')
  })

  /**
   * El camino real del componente: se le pone el estado que React le pondría
   * cuando un hijo lanza y se pinta lo que devuelve su `render`.
   */
  test('un componente que lanza acaba en el fallback, no en una pantalla en blanco', () => {
    const frontera = new ErrorBoundary({ children: <p>contenido</p> })
    frontera.state = ErrorBoundary.getDerivedStateFromError(new Error('boom'))
    const html = renderToString(frontera.render())

    expect(html).not.toContain('contenido')
    expect(html).toContain('Recargar')
    expect(html).toContain('boom')
  })

  test('el fallback deja el detalle plegado', () => {
    const html = renderToString(<FalloDeRender error={new Error('boom')} />)

    expect(html).toMatch(/<details[^>]*>/)
    expect(html).not.toMatch(/<details[^>]*\bopen\b/)
    expect(html).toContain('Detalles técnicos')
  })

  test('el botón de recarga se puede sustituir, que es lo que toca `window` sólo al pulsar', () => {
    let recargas = 0
    const html = renderToString(
      <FalloDeRender
        error={new Error('boom')}
        onReload={() => {
          recargas += 1
        }}
      />,
    )

    // El marcado es el mismo: lo inyectado es el manejador, no el dibujo.
    expect(html).toContain('Recargar')
    expect(recargas).toBe(0)
  })
})
