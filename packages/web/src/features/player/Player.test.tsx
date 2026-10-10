import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { Player } from './Player'

const ROOT = fileURLToPath(new URL('.', import.meta.url))

function render(node: ReactNode): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory('/watch/fixture/abc')}>{node}</HistoryProvider>,
  )
}

describe('el reproductor', () => {
  test('usa un `<video>` de verdad, no un `div` con imagen', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    expect(html).toContain('<video')
    // React escribe el atributo con su nombre de propiedad; el navegador lo
    // entiende igual, y así lo comprueba la prueba.
    expect(html.toLowerCase()).toContain('playsinline')
  })

  test('los controles son botones con su texto', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    for (const texto of [
      'Reproducir',
      'Atrás 10 s',
      'Adelante 10 s',
      'Silenciar',
      'Pantalla completa',
    ]) {
      expect(html, texto).toContain(texto)
    }
    expect(html).toContain('type="button"')
  })

  test('el estado vive en una región `aria-live` educada', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('En pausa')
  })

  test('la atribución de hls.js aparece sólo cuando se usa HLS', () => {
    expect(render(<Player url="/stream/abc" kind="hls" />)).toContain('hls.js')
    expect(render(<Player url="/stream/abc" kind="file" />)).not.toContain('hls.js')
  })

  test('los atajos se anuncian, para que se puedan descubrir', () => {
    expect(render(<Player url="/stream/abc" kind="file" />)).toContain('Espacio o Enter')
  })

  test('la URL que recibe es la del proxy, no una del upstream', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    expect(html).not.toContain('http://')
    expect(html).not.toContain('https://')
  })

  test('la biblioteca se carga de forma diferida, no en el paquete inicial', async () => {
    const fuente = await readFile(`${ROOT}usePlayer.ts`, 'utf8')

    expect(fuente).toContain("await import('hls.js')")
    expect(fuente).not.toContain("from 'hls.js'")
  })
})
