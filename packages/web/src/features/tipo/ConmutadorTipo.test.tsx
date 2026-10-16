import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { ConmutadorTipo } from './ConmutadorTipo'

/**
 * El conmutador, en marcado.
 *
 * Lo que se mide es lo que un botón no daría: que cada mitad sea un **enlace** a
 * una dirección de verdad —se puede abrir en otra pestaña y funciona sin
 * JavaScript— y que la que se está mirando se anuncie con `aria-current`, que es lo
 * que un lector de pantalla lee y el color no cuenta.
 */
function render(path: string): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory(path)}>
      <ConmutadorTipo />
    </HistoryProvider>,
  )
}

describe('el conmutador de tipo', () => {
  test('son dos enlaces con su nombre de grupo', () => {
    const html = render('/')

    expect(html).toContain('aria-label="Tipo de contenido"')
    expect(html).toContain('href="/"')
    expect(html).toContain('href="/?tipo=movies"')
    expect(html).toContain('Anime')
    expect(html).toContain('Películas')
  })

  test('sin parámetro, la mitad marcada es anime', () => {
    const html = render('/')

    // Una sola vez: dos `aria-current` en el mismo grupo dirían que las dos son la
    // pantalla actual.
    expect(html.match(/aria-current="page"/g)?.length).toBe(1)
    expect(html.indexOf('aria-current="page"')).toBeLessThan(html.indexOf('Anime</a>'))
  })

  test('con `tipo=movies`, la marcada es películas', () => {
    const html = render('/?tipo=movies')

    expect(html.match(/aria-current="page"/g)?.length).toBe(1)
    expect(html.indexOf('aria-current="page"')).toBeLessThan(html.indexOf('Películas</a>'))
  })

  test('desde la búsqueda conserva la consulta y el filtro de proveedores', () => {
    const html = render('/search?q=aurora&provider=fixture')

    expect(html).toContain('href="/search?q=aurora&amp;provider=fixture&amp;tipo=movies"')
  })

  /**
   * El carril lleva la mitad activa en `data-tipo`.
   *
   * Es lo que la hoja de estilos lee para deslizar la píldora: sin el atributo, el
   * tirador se queda siempre en la primera mitad y el cambio no se ve. Sale del
   * mismo dato que el `aria-current`, así que se comprueban los dos a la vez: uno no
   * puede decir «anime» mientras el otro dice «películas».
   */
  test('el carril lleva la mitad activa, que es lo que desliza la píldora', () => {
    expect(render('/')).toContain('data-tipo="anime"')
    expect(render('/?tipo=movies')).toContain('data-tipo="movies"')
  })
})
