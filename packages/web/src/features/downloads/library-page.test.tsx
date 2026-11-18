/**
 * La Biblioteca mientras carga.
 *
 * La espera no es una frase: es la estantería con su forma —series a la izquierda,
 * panel de la serie elegida a la derecha— para que la colección no entre de golpe
 * cuando llega la lectura. Se mide sobre el marcado, que es donde vive la forma.
 */

import { describe, expect, test } from 'bun:test'
import type { DownloadItem } from '@rona/core/api'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { LibraryPage, MarcasDelEpisodio } from './LibraryPage'

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

/** Una descarga completa con lo mínimo que miran las marcas de la fila. */
function descarga(cambios: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id: 1,
    providerId: 'fixture',
    animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
    episodeRef: { providerId: 'fixture', value: 'aurora-nocturna#1' },
    title: 'Aurora Nocturna',
    episodeLabel: 'Episodio 1',
    mode: 'sub',
    kind: 'file',
    status: 'complete',
    bytes: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...cambios,
  }
}

describe('las marcas del episodio descargado', () => {
  test('el audio se dice con su etiqueta traducida', () => {
    expect(renderToString(<MarcasDelEpisodio item={descarga({ mode: 'dub' })} />)).toContain(
      'Doblado',
    )

    expect(renderToString(<MarcasDelEpisodio item={descarga({ mode: 'sub' })} />)).toContain(
      'Subtitulado',
    )
  })

  test('las pistas de subtítulos se cuentan, y sin pistas no se inventa nada', () => {
    const html = renderToString(
      <MarcasDelEpisodio
        item={descarga({
          subtitles: [
            {
              indice: 0,
              lang: 'es',
              label: 'Español',
              format: 'vtt',
              url: '/api/downloads/1/subtitles/0',
              default: true,
            },
            {
              indice: 1,
              lang: 'en',
              label: 'Inglés',
              format: 'srt',
              url: '/api/downloads/1/subtitles/1',
              default: false,
            },
          ],
        })}
      />,
    )

    expect(html).toContain('Con subtítulos (2)')

    const sinPistas = renderToString(<MarcasDelEpisodio item={descarga()} />)
    expect(sinPistas).not.toContain('Con subtítulos')
  })
})
