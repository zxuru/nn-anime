import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { ConmutadorTipo } from './ConmutadorTipo'

/**
 * El conmutador de familias, en marcado.
 *
 * Lo que se mide es lo que un botón no daría: que cada familia sea un **enlace** a
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

describe('el conmutador de familia', () => {
  test('son tres enlaces con su nombre de grupo', () => {
    const html = render('/')

    expect(html).toContain('aria-label="Familia de contenido"')
    expect(html).toContain('href="/"')
    expect(html).toContain('href="/?tipo=animation"')
    expect(html).toContain('href="/?tipo=live"')
    expect(html).toContain('Anime')
    expect(html).toContain('Animación')
    expect(html).toContain('Acción real')
    // Cada familia lleva su dibujo: en el móvil el rótulo se recorta y el dibujo
    // es lo que queda a la vista.
    expect(html.match(/<svg/g)).toHaveLength(3)
  })

  test('sin parámetro, la familia marcada es anime', () => {
    const html = render('/')

    // Una sola vez: dos `aria-current` en el mismo grupo dirían que las dos son la
    // pantalla actual.
    expect(html.match(/aria-current="page"/g)?.length).toBe(1)
    // El rótulo va dentro de un `span` desde que la familia lleva dibujo: se busca
    // el texto, no la forma del marcado anterior.
    expect(html.indexOf('aria-current="page"')).toBeLessThan(html.indexOf('>Anime<'))
  })

  test('con `tipo=live`, la marcada es acción real', () => {
    const html = render('/?tipo=live')

    expect(html.match(/aria-current="page"/g)?.length).toBe(1)
    expect(html.indexOf('aria-current="page"')).toBeLessThan(html.indexOf('>Acción real<'))
  })

  test('la dirección vieja `movies` marca acción real', () => {
    const html = render('/?tipo=movies')

    expect(html.match(/aria-current="page"/g)?.length).toBe(1)
    expect(html.indexOf('aria-current="page"')).toBeLessThan(html.indexOf('>Acción real<'))
  })

  test('desde la búsqueda conserva la consulta, el filtro y el formato', () => {
    const html = render('/search?q=aurora&provider=fixture&formato=movie')

    expect(html).toContain(
      'href="/search?q=aurora&amp;provider=fixture&amp;formato=movie&amp;tipo=animation"',
    )
  })

  /**
   * El carril lleva la familia activa en `data-tipo`.
   *
   * Es lo que la hoja de estilos lee para deslizar la píldora: sin el atributo, el
   * tirador se queda siempre en la primera columna y el cambio no se ve. Sale del
   * mismo dato que el `aria-current`, así que se comprueban los dos a la vez.
   */
  test('el carril lleva la familia activa, que es lo que desliza la píldora', () => {
    expect(render('/')).toContain('data-tipo="anime"')
    expect(render('/?tipo=animation')).toContain('data-tipo="animation"')
    expect(render('/?tipo=live')).toContain('data-tipo="live"')
  })
})
