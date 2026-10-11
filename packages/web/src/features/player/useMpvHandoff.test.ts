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

  test('sin mensaje del servidor, se cuenta la clase del fallo', () => {
    // «La petición no valía» y no «POST /api/play/mpv respondió 409»: el código
    // no le dice nada a quien pulsó el botón.
    expect(mensajeDeFallo(new ApiError(409, 'POST /api/play/mpv respondió 409'))).toBe(
      'la petición no valía',
    )
    expect(mensajeDeFallo(new TypeError('Failed to fetch'))).toBe('sin conexión con el servidor')
  })

  test('una causa que no se reconoce no se disfraza de nada', () => {
    expect(mensajeDeFallo('vaya')).toBe('algo falló')
  })
})
