import { describe, expect, test } from 'bun:test'
import { ApiError, ApiShapeError } from './client'
import { type ClaseDeFallo, describirFallo, falloSinFuente } from './fallo'

describe('la clase de un fallo', () => {
  test('un 502 del proveedor no se cuenta como fallo del servidor propio', () => {
    // Es la distinción que importa: un 502 lo provoca el sitio de origen, y
    // mandar a mirar los registros de nn-anime por él es mandar al sitio
    // equivocado.
    const fallo = describirFallo(new ApiError(502, 'GET /api/anime/uno/x respondió 502'))

    expect(fallo.clase).toBe('proveedor')
    expect(fallo.estado).toBe(502)
  })

  test('el detalle del servidor viaja aparte del mensaje crudo', () => {
    const fallo = describirFallo(
      new ApiError(502, 'GET /api/anime/uno/x respondió 502', 'el sitio respondió 500'),
    )

    expect(fallo.detalle).toBe('el sitio respondió 500')
    expect(fallo.tecnico).toBe('GET /api/anime/uno/x respondió 502')
  })

  test('cada estado cae en su clase', () => {
    const casos: readonly (readonly [number, ClaseDeFallo])[] = [
      [401, 'sesion'],
      [403, 'sesion'],
      [404, 'noExiste'],
      [410, 'noExiste'],
      [503, 'proveedor'],
      [504, 'proveedor'],
      [500, 'servidor'],
      [409, 'peticion'],
      [413, 'peticion'],
    ]

    for (const [estado, clase] of casos) {
      expect(describirFallo(new ApiError(estado, `GET /x respondió ${estado}`)).clase).toBe(clase)
    }
  })

  test('una respuesta con otra forma es «forma», no un fallo de red', () => {
    expect(describirFallo(new ApiShapeError('/api/anime', 'falta title')).clase).toBe('forma')
  })

  test('un tiempo agotado es «lento»', () => {
    // Lo que rechaza `AbortSignal.timeout`, con el nombre que le pone la
    // plataforma. Un `Error` normal con ese nombre también cuenta.
    const agotado = new Error('la operación tardó demasiado')
    agotado.name = 'TimeoutError'

    expect(describirFallo(agotado).clase).toBe('lento')

    const abortado = new Error('abortada')
    abortado.name = 'AbortError'

    expect(describirFallo(abortado).clase).toBe('lento')
  })

  test('un proveedor sin fuentes es del proveedor, y con su detalle en palabras', () => {
    const fallo = falloSinFuente('el proveedor no dio ninguna fuente para este episodio')

    expect(fallo.clase).toBe('proveedor')
    expect(fallo.detalle).toBe('el proveedor no dio ninguna fuente para este episodio')
  })

  test('un `TypeError` de `fetch` es que no hay conexión', () => {
    // Es lo que lanza `fetch` sin red, y el mensaje cambia entre navegadores.
    expect(describirFallo(new TypeError('Failed to fetch')).clase).toBe('sinConexion')
    // El de Bun, que es quien sirve esta aplicación: medido contra un puerto
    // cerrado, y es el texto que se vería aquí con el servidor apagado.
    expect(
      describirFallo(new TypeError('Unable to connect. Is the computer able to access the url?'))
        .clase,
    ).toBe('sinConexion')
  })

  test('lo que no se reconoce se cuenta como desconocido, sin perder el mensaje', () => {
    const fallo = describirFallo('vaya')

    expect(fallo.clase).toBe('desconocido')
    expect(fallo.tecnico).toBe('vaya')
  })

  test('un `TypeError` que no viene de `fetch` no se disfraza de fallo de red', () => {
    // Un fallo de la aplicación no puede contarse como «sin conexión»: mandaría
    // a mirar el cable cuando el fallo está en el código.
    const fallo = describirFallo(new TypeError('x is not a function'))

    expect(fallo.clase).toBe('desconocido')
    expect(fallo.tecnico).toBe('x is not a function')
  })
})
