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

    const resultado = await attachHls(
      video as unknown as HTMLVideoElement,
      '/stream/abc',
      undefined,
      () => false,
    )

    // React en modo estricto monta, desmonta y vuelve a montar: la primera vuelta
    // llega tarde y, si tocara el elemento, su `destroy()` arrancaría el medio que
    // la segunda acababa de montar. El video se quedaba en negro con la lista
    // cargada y sin pedir un solo segmento.
    expect(video.src).toBe('')
    expect('destroy' in resultado).toBe(true)
  })

  test('si el efecto sigue vivo, el medio se monta', async () => {
    const video = videoFalso()

    await attachHls(video as unknown as HTMLVideoElement, '/stream/abc', undefined, () => true)

    // Sin MediaSource —que es el caso de este runner— la biblioteca no se declara
    // soportada y el camino es el del `<video>` directo. Es suficiente para saber
    // que la comprobación de vida no se lo come todo.
    expect(video.src).toBe('/stream/abc')
  })
})
