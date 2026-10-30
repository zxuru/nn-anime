/**
 * El contrato de `IconLabel`, medido en el marcado.
 *
 * Lo que no se ve sin navegador es justo lo que se comprueba aquí: que el dibujo
 * sea decorativo —un icono con nombre propio haría que el lector dijera dos veces
 * el mando—, que la etiqueta corta sólo exista cuando hay dos versiones y que el
 * mando solo-icono conserve su nombre en el documento. El tamaño y el grosor se
 * miran en el `<svg>` porque son la mitad del juego: uno solo para toda la casa.
 */

import { describe, expect, test } from 'bun:test'
import { Home } from 'lucide-react'
import { renderToString } from 'react-dom/server'
import { IconLabel } from './IconLabel'

function render(props: { label: string; short?: string; iconOnlyOnMobile?: boolean }): string {
  return renderToString(<IconLabel icon={Home} {...props} />)
}

describe('el icono con su etiqueta', () => {
  test('sin versión corta, la etiqueta completa es la única', () => {
    const html = render({ label: 'Inicio' })

    expect(html).toContain('class="icon-label"')
    expect(html).toContain('>Inicio<')
    // Sin `short` no hay nada que intercambiar en móvil: la etiqueta se queda.
    expect(html).not.toContain('icon-label--con-corto')
    expect(html).not.toContain('icon-label__corto')
  })

  test('con versión corta, lleva las dos y la clase que las intercambia', () => {
    const html = render({ label: 'Reproducir el episodio 1', short: 'Ep. 1' })

    expect(html).toContain('icon-label--con-corto')
    expect(html).toContain('>Reproducir el episodio 1<')
    expect(html).toContain('>Ep. 1<')
  })

  test('el dibujo es decorativo, con el tamaño y el grosor de la casa', () => {
    const html = render({ label: 'Inicio' })

    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('focusable="false"')
    expect(html).toContain('width="18"')
    expect(html).toContain('height="18"')
    expect(html).toContain('stroke-width="2"')
  })

  test('el título deja leer la etiqueta completa', () => {
    expect(render({ label: 'Reproducir el episodio 1', short: 'Ep. 1' })).toContain(
      'title="Reproducir el episodio 1"',
    )
  })

  test('el mando solo-icono conserva su texto y añade la clase del recorte', () => {
    const html = render({ label: 'Películas', iconOnlyOnMobile: true })

    expect(html).toContain('icon-label--solo-movil')
    // El texto sigue en el documento: es lo que da el nombre accesible cuando la
    // hoja lo recorta en el móvil.
    expect(html).toContain('>Películas<')
  })

  test('un tamaño explícito se respeta', () => {
    expect(renderToString(<IconLabel icon={Home} label="Inicio" size={22} />)).toContain(
      'width="22"',
    )
  })
})
