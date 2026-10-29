import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { createMemoryHistory, HistoryProvider } from '../router'
import { PanelPieza } from './PanelPieza'

/** La hoja usa enlaces de la aplicación, y los enlaces viven en el historial. */
function render(panel: Parameters<typeof PanelPieza>[0]): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory('/')}>
      <PanelPieza {...panel} />
    </HistoryProvider>,
  )
}

/**
 * La hoja de una pieza.
 *
 * Lo que se mide aquí es la decisión que el marcado puede sostener sin un DOM:
 * que la superficie sea un `<dialog>` nativo —y no un `div` con `role` y
 * `aria-modal` hechos a mano— y que el botón de cierre siga siendo un control
 * con nombre. El foco, el `Esc` y el bloqueo del fondo son del navegador; el
 * componente los elige al usar `showModal`.
 */
describe('la hoja de la pieza', () => {
  test('es un diálogo nativo con nombre accesible', () => {
    const html = render({
      title: 'Aurora Nocturna',
      ficha: '/anime/f/x',
      onCerrar: () => {},
    })

    expect(html).toContain('<dialog')
    expect(html).toContain('class="hoja"')
    expect(html).toContain('aria-label="Aurora Nocturna"')
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('aria-modal')
    expect(html).not.toContain('hoja__fondo')
  })

  test('lleva el cierre y la ficha, y sólo reproduce si hay episodio', () => {
    const sinEpisodio = render({
      title: 'Aurora Nocturna',
      ficha: '/anime/f/x',
      onCerrar: () => {},
    })

    expect(sinEpisodio).toContain('hoja__cerrar')
    expect(sinEpisodio).toContain('href="/anime/f/x"')
    expect(sinEpisodio).not.toContain('href="/watch/')

    const conEpisodio = render({
      title: 'Aurora Nocturna',
      ficha: '/anime/f/x',
      reproducir: '/watch/f/x',
      onCerrar: () => {},
    })

    expect(conEpisodio).toContain('href="/watch/f/x"')
  })
})
