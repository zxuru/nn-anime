import { describe, expect, test } from 'bun:test'
import type { ProviderRef } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { BotonDeDescarga, DownloadButton } from './DownloadButton'

const REF: ProviderRef = { providerId: 'fixture', value: 'aurora-nocturna#1' }

function render(node: ReactNode): string {
  return renderToString(node)
}

describe('el botón de descargar', () => {
  /**
   * Sin preguntar a la fuente.
   *
   * El estado inicial del componente es «listo»: no hay una petición a
   * `/api/providers` esperando una capacidad. Si volviera la comprobación, este
   * render —que no ejecuta efectos— se quedaría en «comprobando» y no habría
   * botón.
   */
  test('está desde el primer render, declare lo que declare la fuente', () => {
    const html = render(<DownloadButton providerId="fixture" animeRef={REF} episodeRef={REF} />)

    expect(html).toContain('Descargar')
    expect(html).toContain('type="button"')
    expect(html).not.toContain('disabled')
  })

  /**
   * El motivo es un tooltip, no un párrafo.
   *
   * Anclado al encabezado del reproductor, un texto de error al lado empujaba la
   * sala y rompía la medida de «cabe en una ventana». El `title` lo muestra el
   * navegador al pasar por encima; el `solo-lectores` mantiene el aviso para
   * quien no ve el tooltip.
   */
  test('el fallo va en el `title` y en la región que se anuncia', () => {
    const html = render(
      <BotonDeDescarga
        estado="error"
        mensaje="el proveedor no dio stream"
        onDescargar={() => {}}
      />,
    )

    expect(html).toContain('title="el proveedor no dio stream"')
    expect(html).toContain('solo-lectores')
    expect(html).toContain('role="alert"')
    expect(html).not.toContain('downloads__error')
  })

  test('un fallo no cierra el botón: volver a pulsar es el reintento', () => {
    const html = render(<BotonDeDescarga estado="error" mensaje="sin red" onDescargar={() => {}} />)

    expect(html).not.toContain('disabled')
    expect(html).toContain('Descargar')
  })

  test('mientras guarda y una vez en cola no se pide dos veces', () => {
    const guardando = render(<BotonDeDescarga estado="guardando" onDescargar={() => {}} />)
    const hecha = render(<BotonDeDescarga estado="hecho" onDescargar={() => {}} />)

    expect(guardando).toContain('disabled')
    expect(guardando).toContain('Enviando…')
    expect(hecha).toContain('disabled')
    expect(hecha).toContain('En cola')
  })
})
