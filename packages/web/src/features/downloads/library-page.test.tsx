/**
 * La Biblioteca mientras carga.
 *
 * La espera no es una frase: es la estantería con su forma —series a la izquierda,
 * panel de la serie elegida a la derecha— para que la colección no entre de golpe
 * cuando llega la lectura. Se mide sobre el marcado, que es donde vive la forma.
 */

import { describe, expect, test } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { LibraryPage } from './LibraryPage'

function render(node: ReactNode): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory('/library')}>{node}</HistoryProvider>,
  )
}

describe('la biblioteca mientras carga', () => {
  test('la espera tiene la forma de la estantería', () => {
    const html = render(<LibraryPage />)

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('class="solo-lectores" role="status"')

    // Cuatro series de hueco en la rejilla de la estantería y el panel al lado.
    expect(html.match(/class="library__serie"/g)?.length).toBe(4)
    expect(html).toContain('library__shelf')
    expect(html).toContain('library__detail')
    expect(html).toContain('library__cover-hueco')

    // Y no afirma que no hay descargas antes de haberlas leído.
    expect(html).not.toContain('library__empty')
  })
})
