import { describe, expect, test } from 'bun:test'
import { ApiError } from '../../api/client'
import { mensajeDeFallo } from './useMpvHandoff'

describe('lo que se le cuenta a quien pulsó «ver en mpv»', () => {
  test('el mensaje del servidor manda sobre el genérico del cliente', () => {
    const causa = new ApiError(
      503,
      'POST /api/play/mpv respondió 503',
      'no se encontró mpv en el PATH; se puede reproducir en el navegador',
    )

    expect(mensajeDeFallo(causa)).toBe(
      'no se encontró mpv en el PATH; se puede reproducir en el navegador',
    )
  })

  test('sin mensaje del servidor, se usa el del cliente', () => {
    expect(mensajeDeFallo(new ApiError(409, 'POST /api/play/mpv respondió 409'))).toBe(
      'POST /api/play/mpv respondió 409',
    )
  })

  test('una causa que no es un error se cuenta tal cual', () => {
    expect(mensajeDeFallo('vaya')).toBe('vaya')
  })
})
