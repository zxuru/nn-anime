import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { PlayerSeekBar } from './PlayerSeekBar'

/**
 * La barra de progreso, montada sin navegador.
 *
 * Lo que se mide es lo que se ve y lo que se oye: las tres capas del carril con
 * su ancho, el tiempo en palabras del `aria-valuetext` y el globo del segundo bajo
 * el puntero. Los gestos sobre ella los mide el e2e, que es donde hay ratón.
 */

function render(parcial: Partial<Parameters<typeof PlayerSeekBar>[0]> = {}): string {
  return renderToString(
    <PlayerSeekBar
      posicion={125}
      duracion={500}
      bufferedS={250}
      sobreBarra={undefined}
      onArrastrar={() => {}}
      onSoltar={() => {}}
      onMoverPuntero={() => {}}
      onSalir={() => {}}
      {...parcial}
    />,
  )
}

describe('la barra de progreso', () => {
  test('el búfer y lo reproducido se pintan en su proporción', () => {
    const html = render()

    // 250 de 500 es la mitad del carril, y 125 es la cuarta parte.
    expect(html).toContain('width:50%')
    expect(html).toContain('width:25%')
  })

  test('el tiempo se anuncia en palabras, no en segundos', () => {
    const html = render()

    expect(html).toContain('aria-valuetext="2 minutos 5 segundos de 8 minutos 20 segundos"')
  })

  test('sin duración la barra está apagada y no se sale del carril', () => {
    const html = render({ posicion: 0, duracion: 0, bufferedS: 30 })

    expect(html).toContain('disabled=""')
    // Un total de cero daría `NaN` en el `width`: el carril se queda a cero.
    expect(html).toContain('width:0%')
  })

  test('el globo del segundo bajo el puntero vive donde está el puntero', () => {
    const sinGlobo = render()
    const conGlobo = render({ sobreBarra: 125 })

    expect(sinGlobo).not.toContain('player__tooltip')
    expect(conGlobo).toContain('player__tooltip')
    expect(conGlobo).toContain('width:25%')
    expect(conGlobo).toContain('2:05')
  })
})
