import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import type { DownloadItem } from '@rona/core/api'
import { renderToString } from 'react-dom/server'
import { AvisoDeConversion, pistasDeLaDescarga } from './LibraryPlayerPage'

/**
 * El aviso de la descarga que se quedó en segmentos.
 *
 * La página entera pide la descarga en un efecto, y `renderToString` no ejecuta
 * efectos: por eso lo que se mide es la pieza que sí se puede ver en un render.
 */
describe('el aviso de conversión', () => {
  test('dice que no hay MP4 y ofrece convertirlo', () => {
    const html = renderToString(<AvisoDeConversion convirtiendo={false} onConvertir={() => {}} />)

    // El texto tiene que explicar el porqué, no sólo ofrecer el botón.
    expect(html).toContain('no como MP4')
    expect(html).toContain('Convertir a MP4')
    expect(html).not.toContain('disabled')
    expect(html).toContain('aria-busy="false"')
  })

  test('mientras convierte, el botón no se puede volver a pulsar', () => {
    const html = renderToString(<AvisoDeConversion convirtiendo onConvertir={() => {}} />)

    expect(html).toContain('Convirtiendo')
    expect(html).toContain('disabled')
    expect(html).toContain('aria-busy="true"')
    // Y ya no invita a pulsarlo otra vez.
    expect(html).not.toContain('Convertir a MP4')
  })
})

/** Una descarga completa con lo mínimo que mira la pista. */
function descarga(cambios: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id: 7,
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

describe('las pistas de la descarga', () => {
  test('llegan al reproductor con su ruta interna', () => {
    const item = descarga({
      subtitles: [
        {
          indice: 0,
          lang: 'es',
          label: 'Español',
          format: 'vtt',
          url: '/api/downloads/7/subtitles/0',
          default: true,
        },
        {
          indice: 1,
          lang: 'en',
          label: 'Inglés',
          format: 'srt',
          url: '/api/downloads/7/subtitles/1',
          default: false,
        },
      ],
    })

    expect(pistasDeLaDescarga(item)).toEqual([
      { url: '/api/downloads/7/subtitles/0', lang: 'es', label: 'Español' },
      { url: '/api/downloads/7/subtitles/1', lang: 'en', label: 'Inglés' },
    ])
  })

  test('una descarga sin pistas no inventa ninguna', () => {
    expect(pistasDeLaDescarga(descarga())).toEqual([])
  })
})

describe('el visionado del episodio descargado', () => {
  /**
   * La página entera no se puede montar sin un DOM —pide la descarga en un
   * efecto—, así que lo que se comprueba aquí es la conexión: que el
   * reproductor de la biblioteca abra el registro del visionado con el modo del
   * episodio y pase los avisos al `<Player>`. Sin esta llamada, lo descargado no
   * aparece en «continuar viendo» ni en el historial, que es justo el fallo que
   * esta oleada cierra. Las piezas puras se miden en `visionado.test.ts`.
   */
  test('la pantalla registra el visionado y le pasa sus avisos al reproductor', async () => {
    const fuente = await Bun.file(
      fileURLToPath(new URL('./LibraryPlayerPage.tsx', import.meta.url)),
    ).text()

    expect(fuente).toContain('useWatchEvents(opcionesDeVisionado(')
    expect(fuente).toContain('onPlay={mandos.onPlay}')
    expect(fuente).toContain('onProgress={mandos.onProgress}')
    expect(fuente).toContain('startAtS={inicio}')
  })
})
