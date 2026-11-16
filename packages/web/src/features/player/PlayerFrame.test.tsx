import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { PlayerFrame, type PlayerFrameProps } from './PlayerFrame'

/**
 * El marco del reproductor, montado sin navegador.
 *
 * Lo que se mide es lo que el elemento lleva puesto: una pista por subtítulo, con
 * el `default` en la primera y sin direcciones de fuera; el lienzo del modo
 * compatible sólo cuando se pinta; y el cartel de la espera sólo cuando hay algo
 * que esperar.
 */

function render(parcial: Partial<PlayerFrameProps> = {}): string {
  return renderToString(
    <PlayerFrame
      refVideo={() => {}}
      onClick={() => {}}
      onDoubleClick={() => {}}
      poster={undefined}
      etiqueta="Aurora nocturna"
      pistas={[]}
      pintando={false}
      canvasRef={() => {}}
      espera={undefined}
      {...parcial}
    />,
  )
}

describe('el marco del video', () => {
  test('es un `<video>` de verdad, con su nombre accesible', () => {
    const html = render()

    expect(html).toContain('<video')
    expect(html).toContain('aria-label="Aurora nocturna"')
    expect(html.toLowerCase()).toContain('playsinline')
  })

  test('pinta una pista por subtítulo, con su idioma y su etiqueta', () => {
    const html = render({
      pistas: [
        { url: '/api/subtitles/a', lang: 'es', label: 'Español' },
        { url: '/api/subtitles/b', lang: 'en', label: 'Inglés' },
      ],
    })

    expect(html).toContain('src="/api/subtitles/a"')
    expect(html.toLowerCase()).toContain('srclang="es"')
    expect(html).toContain('label="Inglés"')
    // La primera —la que prefiere el proveedor— es la única marcada.
    expect(html.match(/default=""/g)?.length).toBe(1)
  })

  test('una pista con una dirección de fuera no se convierte en atributo', () => {
    const html = render({
      pistas: [{ url: 'https://otro.example/es.vtt', lang: 'es', label: 'Español' }],
    })

    expect(html).not.toContain('otro.example')
  })

  test('el lienzo del modo compatible aparece sólo si se pinta', () => {
    expect(render()).not.toContain('<canvas')
    expect(render({ pintando: true })).toContain('<canvas')
  })

  test('el cartel de la espera aparece sólo si hay algo que esperar', () => {
    expect(render()).not.toContain('player__wait')

    const cargando = render({ espera: 'Cargando el video' })

    expect(cargando).toContain('player__wait')
    expect(cargando).toContain('role="status"')
    expect(cargando).toContain('Cargando el video')
  })

  test('las capas del reproductor van dentro del marco', () => {
    const html = render({ children: <span className="player__overlay" /> })

    expect(html).toContain('player__overlay')
    // Dentro del marco, y no después: el marco es lo que mide el video.
    expect(html.indexOf('player__overlay')).toBeLessThan(html.indexOf('</div>'))
  })
})
