import { describe, expect, test } from 'bun:test'
import type { DownloadItem } from '@rona/core/api'
import { guardarProgreso } from '../player/storage'
import {
  claveDeLaDescarga,
  etiquetaDeAudio,
  etiquetaDeSubtitulos,
  mandosDelReproductor,
  opcionesDeVisionado,
  posicionDeLaDescarga,
} from './visionado'

/** Una descarga completa con lo mínimo que mira el visionado. */
function descarga(cambios: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id: 7,
    providerId: 'fixture',
    animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
    episodeRef: { providerId: 'fixture', value: 'aurora-nocturna#3' },
    title: 'Aurora Nocturna',
    episodeLabel: 'Episodio 3',
    mode: 'sub',
    kind: 'file',
    status: 'complete',
    bytes: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...cambios,
  }
}

/** El almacén del navegador, sin navegador. */
function almacenDePrueba(inicial: Readonly<Record<string, string>> = {}) {
  const datos = new Map(Object.entries(inicial))

  return {
    getItem: (clave: string): string | null => datos.get(clave) ?? null,
    setItem: (clave: string, valor: string): void => {
      datos.set(clave, valor)
    },
    removeItem: (clave: string): void => {
      datos.delete(clave)
    },
  }
}

describe('las etiquetas del episodio descargado', () => {
  test('el modo se traduce con el mismo texto que el reproductor', () => {
    expect(etiquetaDeAudio('sub')).toBe('Subtitulado')
    expect(etiquetaDeAudio('dub')).toBe('Doblado')
  })

  test('los subtítulos se cuentan sólo cuando hay pistas', () => {
    expect(etiquetaDeSubtitulos(descarga())).toBeUndefined()
    expect(etiquetaDeSubtitulos(descarga({ subtitles: [] }))).toBeUndefined()
    expect(
      etiquetaDeSubtitulos(
        descarga({
          subtitles: [
            {
              indice: 0,
              lang: 'es',
              label: 'Español',
              format: 'vtt',
              url: '/api/downloads/7/subtitles/0',
              default: true,
            },
          ],
        }),
      ),
    ).toBe('Con subtítulos (1)')
  })
})

describe('la posición local de una descarga', () => {
  test('se guarda por episodio y se reanuda con el retroceso de siempre', () => {
    const item = descarga()
    const almacen = almacenDePrueba()

    guardarProgreso(almacen, claveDeLaDescarga(item), { positionS: 120, durationS: 1440 })

    expect(claveDeLaDescarga(item)).toContain('aurora-nocturna#3')
    // Tres segundos de contexto, como el reproductor del proveedor.
    expect(posicionDeLaDescarga(item, almacen)).toBe(117)
  })

  test('un episodio sin progreso empieza por el principio', () => {
    expect(posicionDeLaDescarga(descarga(), almacenDePrueba())).toBe(0)
  })

  test('una posición de otro episodio no se hereda', () => {
    const almacen = almacenDePrueba()
    guardarProgreso(
      almacen,
      claveDeLaDescarga(descarga({ episodeRef: { providerId: 'fixture', value: 'otro' } })),
      {
        positionS: 120,
        durationS: 1440,
      },
    )

    expect(posicionDeLaDescarga(descarga(), almacen)).toBe(0)
  })

  test('unos segundos sueltos no cuentan como reanudables', () => {
    const almacen = almacenDePrueba()
    guardarProgreso(almacen, claveDeLaDescarga(descarga()), { positionS: 5, durationS: 1440 })

    expect(posicionDeLaDescarga(descarga(), almacen)).toBe(0)
  })
})

describe('el alta del visionado', () => {
  test('lleva el modo con el que se bajó el episodio y desde dónde se sigue', () => {
    const item = descarga({ mode: 'dub' })

    expect(opcionesDeVisionado(item, 117)).toEqual({
      animeRef: item.animeRef,
      episodeRef: item.episodeRef,
      mode: 'dub',
      startAtS: 117,
    })
  })

  test('sin reanudación no manda un cero que no dice nada', () => {
    expect(opcionesDeVisionado(descarga(), 0)).not.toHaveProperty('startAtS')
  })
})

describe('los mandos del reproductor', () => {
  /**
   * El registro tiene que llegar a los dos sitios: al servidor —para el historial
   * y «continuar viendo»— y al almacén local —para reanudar sin red—. Se mide con
   * espías porque es exactamente lo que hace la pantalla: no se puede montar el
   * `<video>` sin un DOM.
   */
  test('cada aviso alimenta el servidor y la posición local', () => {
    const llamadas: string[] = []
    const eventos = {
      onPlay: () => llamadas.push('play'),
      onPause: () => llamadas.push('pause'),
      onProgress: (positionS: number, durationS: number) =>
        llamadas.push(`progress:${positionS}:${durationS}`),
    }

    const mandos = mandosDelReproductor({
      eventos,
      guardar: () => llamadas.push('guardar'),
      guardarAvance: (positionS, durationS) => llamadas.push(`avance:${positionS}:${durationS}`),
      terminar: () => llamadas.push('terminar'),
    })

    mandos.onPlay()
    mandos.onProgress(12, 1440)
    mandos.onPause()
    mandos.onEnded()

    expect(llamadas).toEqual([
      'play',
      'avance:12:1440',
      'progress:12:1440',
      'guardar',
      'pause',
      'terminar',
    ])
  })
})
