import { describe, expect, test } from 'bun:test'
import { attachHls } from './usePlayer'

/**
 * Un `<video>` de mentira, lo justo para lo que `attachHls` mira.
 *
 * No hace falta un DOM: lo que se prueba aquí es **cuándo** se toca el elemento,
 * no cómo se reproduce. El elemento de verdad lo cubre el e2e.
 */
function videoFalso(): { src: string; canPlayType: (tipo: string) => string } {
  return {
    src: '',
    canPlayType: () => 'maybe',
  }
}

describe('el montaje del medio', () => {
  test('si el efecto ya se desmontó, no se toca el elemento', async () => {
    const video = videoFalso()

    const resultado = await attachHls({
      video: video as unknown as HTMLVideoElement,
      url: '/stream/abc',
      sigueVivo: () => false,
    })

    // React en modo estricto monta, desmonta y vuelve a montar: la primera vuelta
    // llega tarde y, si tocara el elemento, su `destroy()` arrancaría el medio que
    // la segunda acababa de montar. El video se quedaba en negro con la lista
    // cargada y sin pedir un solo segmento.
    expect(video.src).toBe('')
    expect('destroy' in resultado).toBe(true)
  })

  test('si el efecto sigue vivo, el medio se monta', async () => {
    const video = videoFalso()

    await attachHls({
      video: video as unknown as HTMLVideoElement,
      url: '/stream/abc',
      sigueVivo: () => true,
    })

    // Sin MediaSource —que es el caso de este runner— la biblioteca no se declara
    // soportada y el camino es el del `<video>` directo. Es suficiente para saber
    // que la comprobación de vida no se lo come todo.
    expect(video.src).toBe('/stream/abc')
  })

  /**
   * El mando de las pistas del manifiesto existe en las dos ramas.
   *
   * Aquí no hay `MediaSource`, así que hls.js nunca llega a montarse y no hay
   * pistas que descubrir; lo que se mide es el contrato: quien llama no tiene que
   * distinguir dos formas de lo mismo, y sin esto el menú de subtítulos tendría
   * que comprobar la forma del resultado antes de cada clic. Encender una pista de
   * verdad lo mide el e2e del reproductor.
   */
  test('el mando de las pistas del manifiesto está en las dos ramas', async () => {
    const resultado = await attachHls({
      video: videoFalso() as unknown as HTMLVideoElement,
      url: '/stream/abc',
    })

    expect('destroy' in resultado).toBe(true)
    if ('destroy' in resultado) expect(typeof resultado.elegirSubtitulo).toBe('function')
  })
})
