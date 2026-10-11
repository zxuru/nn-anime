import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { ApiError } from '../api/client'
import { describirFallo } from '../api/fallo'
import { ErrorNotice, resumenDeFallo } from './ErrorNotice'

/**
 * El aviso de un fallo, montado.
 *
 * Lo que se comprueba es lo que pedía el fallo original: que la pantalla **diga
 * qué pasó y qué hacer**, no que repita el mensaje del cliente. El mensaje crudo
 * sigue estando —hace falta para un informe— pero plegado.
 */

function render(causa: unknown, onRetry?: () => void): string {
  const fallo = describirFallo(causa)

  return renderToString(<ErrorNotice fallo={fallo} onRetry={onRetry} />)
}

describe('el aviso de un fallo', () => {
  test('un 502 del proveedor no se cuenta con la ruta y el código', () => {
    const html = render(new ApiError(502, 'GET /api/anime/jkanime/mashle-2nd-season respondió 502'))

    expect(html).toContain('El proveedor no responde')
    expect(html).toContain('nn-anime está bien')
    // El mensaje crudo sigue ahí, para copiarlo: lo que no hace es ser el titular.
    expect(html).toContain('GET /api/anime/jkanime/mashle-2nd-season respondió 502')
    expect(html).toContain('Detalles técnicos')
  })

  test('el mensaje del servidor se enseña antes que el crudo', () => {
    const html = render(
      new ApiError(502, 'GET /api/anime/uno/x respondió 502', 'el sitio respondió 500'),
    )

    expect(html).toContain('el sitio respondió 500')
    expect(html.indexOf('el sitio respondió 500')).toBeLessThan(
      html.indexOf('GET /api/anime/uno/x respondió 502'),
    )
  })

  test('sin sesión dice cómo volver a entrar, y no ofrece reintentar', () => {
    const html = render(new ApiError(401, 'GET /api/favorites respondió 401'))

    expect(html).toContain('La sesión de este navegador no vale')
    expect(html).toContain('la dirección de arranque')
    // Reintentar no arregla una cookie que no vale: el botón no se pinta.
    expect(html).not.toContain('Reintentar')
  })

  test('el botón de reintentar sólo sale si hay algo que reintentar', () => {
    // Montado en servidor no se puede pulsar: lo que se mide aquí es que el botón
    // esté cuando hay quien lo atienda, y que no esté cuando no.
    const conReintento = render(new ApiError(503, 'GET /api/anime/uno/x respondió 503'), () => {})

    expect(conReintento).toContain('Reintentar')
    expect(render(new ApiError(503, 'GET /api/anime/uno/x respondió 503'))).not.toContain(
      'Reintentar',
    )
  })

  test('el aviso se anuncia como alerta', () => {
    expect(render(new TypeError('Failed to fetch'))).toContain('role="alert"')
  })

  test('el resumen es una frase, no el mensaje crudo', () => {
    const fallo = describirFallo(new ApiError(502, 'GET /api/anime/uno/x respondió 502'))

    expect(resumenDeFallo(fallo)).toBe('el proveedor no respondió')
    expect(resumenDeFallo(fallo)).not.toContain('GET')
  })
})
