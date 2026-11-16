import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { PlayerErrorNotice } from './PlayerErrorNotice'

/**
 * El aviso de fallo del reproductor, montado sin navegador.
 *
 * El mensaje sale del catálogo con el motivo dentro; el botón sólo aparece cuando
 * hay algo que reintentar. Un botón que no hace nada es peor que no tenerlo, así
 * que las dos mitades se miden por separado.
 */
describe('el aviso de fallo del reproductor', () => {
  test('dice qué pasó, con el motivo del fallo', () => {
    const html = renderToString(
      <PlayerErrorNotice
        error="hls.js se detuvo: fragLoadError (HTTP 403)"
        retryable
        onRetry={() => {}}
      />,
    )

    expect(html).toContain('No se pudo reproducir')
    expect(html).toContain('fragLoadError (HTTP 403)')
  })

  test('el reintento sólo se ofrece si hay algo que reintentar', () => {
    const conReintento = renderToString(
      <PlayerErrorNotice error="red caída" retryable onRetry={() => {}} />,
    )
    const sinReintento = renderToString(
      <PlayerErrorNotice
        error="este navegador no puede reproducir HLS"
        retryable={false}
        onRetry={() => {}}
      />,
    )

    expect(conReintento).toContain('Reintentar')
    expect(sinReintento).not.toContain('Reintentar')
    expect(sinReintento).toContain('este navegador no puede reproducir HLS')
  })
})
