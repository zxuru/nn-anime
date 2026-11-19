import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { PlayerButtons, type PlayerButtonsProps } from './PlayerButtons'

/**
 * La fila de mandos, montada sin navegador.
 *
 * Se mide lo que no se ve: que cada mando diga **un** estado, que los saltos de
 * diez segundos y el volumen desaparezcan cuando no caben —el doble toque y el
 * menú los sustituyen— y que el menú de ajustes siga entrando como hijo, que es
 * lo que permite que su estado viva en el reproductor.
 */

function render(parcial: Partial<PlayerButtonsProps> = {}): string {
  return renderToString(
    <PlayerButtons
      playing={false}
      muted={false}
      volume={1}
      posicion={31}
      duracionS={1440}
      estrecho={false}
      compacto={false}
      completa={false}
      extendida={false}
      act={() => {}}
      onVolumen={() => {}}
      onAlternarExtendida={() => {}}
      {...parcial}
    />,
  )
}

describe('la fila de mandos', () => {
  test('cada mando dice un solo estado, y el que toca', () => {
    const parado = render()
    const reproduciendo = render({ playing: true, muted: true })

    expect(parado).toContain('aria-label="Reproducir"')
    expect(parado).not.toContain('aria-label="Pausar"')
    expect(reproduciendo).toContain('aria-label="Pausar"')
    expect(reproduciendo).toContain('aria-label="Activar sonido"')
  })

  test('cada botón declara el atajo que lo dispara', () => {
    const html = render()

    expect(html).toContain('aria-keyshortcuts="Space Enter K"')
    expect(html).toContain('aria-keyshortcuts="ArrowLeft"')
    expect(html).toContain('aria-keyshortcuts="ArrowRight"')
    expect(html).toContain('aria-keyshortcuts="M"')
    expect(html).toContain('aria-keyshortcuts="T"')
    expect(html).toContain('aria-keyshortcuts="F"')
  })

  test('el volumen va de cero a cien, que es lo que se oye', () => {
    const html = render({ volume: 0.5 })

    expect(html).toContain('aria-label="Volumen"')
    expect(html).toContain('max="100"')
    expect(html).toContain('value="50"')
  })

  test('en un teléfono no hay saltos de diez segundos', () => {
    const html = render({ compacto: true })

    expect(html).not.toContain('Retroceder 10 segundos')
    expect(html).not.toContain('Adelantar 10 segundos')
  })

  /**
   * En un teléfono el reloj dice la posición, no el total.
   *
   * Con el mando de la reproducción automática en la fila, a 320 px el conjunto no
   * cabía y la página desbordaba 16 px. El total sigue en el valor que anuncia la
   * barra de progreso; el reloj de la fila se queda con lo que la barra está
   * enseñando.
   */
  test('en un teléfono el reloj lleva sólo la posición', () => {
    const movil = render({ compacto: true })

    expect(movil).toContain('>0:31<')
    expect(movil).not.toContain('24:00')
    // En escritorio, las dos cifras.
    expect(render()).toMatch(/0:31[\s\S]*24:00/)
  })

  test('en una ventana estrecha el volumen se muda al menú', () => {
    const html = render({ estrecho: true })

    expect(html).not.toContain('class="player__volume"')
    expect(html).not.toContain('aria-label="Volumen"')
  })

  test('los relojes se leen como tiempos, no como números', () => {
    const html = render()

    expect(html).toMatch(/0:31[\s\S]*24:00/)
    expect(html).not.toContain('31 / 1440')
  })

  test('el mando del modo extendido dice a dónde lleva', () => {
    expect(render()).toContain('aria-label="Modo extendido"')
    expect(render({ extendida: true })).toContain('aria-label="Salir del modo extendido"')
  })

  test('el menú de ajustes entra como hijo, en su sitio de la fila', () => {
    const html = render({ children: <div className="player__settings" /> })

    expect(html).toContain('player__settings')
    expect(html.indexOf('player__time')).toBeLessThan(html.indexOf('player__settings'))
    expect(html.indexOf('player__settings')).toBeLessThan(html.indexOf('aria-keyshortcuts="T"'))
  })
})
