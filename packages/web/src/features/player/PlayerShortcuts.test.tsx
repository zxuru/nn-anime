import { describe, expect, test } from 'bun:test'
import { createRef } from 'react'
import { renderToString } from 'react-dom/server'
import { PlayerShortcuts } from './PlayerShortcuts'

/**
 * La ayuda del teclado, montada sin navegador.
 *
 * Se mide que siga siendo un `<dialog>` nativo —el `Esc` y el encierro del foco
 * los pone el navegador— y que cada atajo se dibuje como una tecla con su frase.
 * El `open` lo pone `showModal()` desde fuera: aquí se comprueba que el diálogo
 * nace cerrado y que no se abre por su cuenta.
 */

function render(): string {
  return renderToString(
    <PlayerShortcuts dialogRef={createRef<HTMLDialogElement>()} onClose={() => {}} />,
  )
}

describe('la ayuda del teclado', () => {
  test('es un diálogo nativo y nace cerrado', () => {
    const html = render()

    expect(html).toContain('<dialog')
    expect(html).not.toContain('open=""')
    expect(html).toContain('aria-label="Teclado"')
  })

  test('cada atajo es una tecla dibujada con su frase al lado', () => {
    const html = render()

    for (const tecla of ['Espacio', 'Enter', 'K', '←', '→', '↑', '↓', 'M', 'F']) {
      expect(html, tecla).toContain(`>${tecla}</kbd>`)
    }

    for (const hace of [
      'Pausa y reanudar',
      'Retroceder o avanzar 10 s',
      'Bajar o subir el volumen',
      'Silenciar',
      'Pantalla completa',
    ]) {
      expect(html, hace).toContain(hace)
    }
  })

  test('se puede cerrar con un botón, y no sólo con `Esc`', () => {
    expect(render()).toContain('Cerrar la ayuda')
  })
})
