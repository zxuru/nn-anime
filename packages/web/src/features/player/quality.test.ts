import { describe, expect, test } from 'bun:test'
import type { StreamSourceResponse } from '@rona/core/api'
import { elegirFuente } from './quality'

function fuente(quality: string | undefined, url: string): StreamSourceResponse {
  return {
    url,
    kind: 'file',
    ...(quality === undefined ? {} : { quality }),
  }
}

/**
 * La elección de la fuente.
 *
 * Es la mitad que se puede medir sin navegador: la petición lleva
 * `preferredQuality` y la respuesta trae las fuentes del proveedor. Lo que la
 * pantalla reproduce es la que coincide, y si no hay ninguna, la primera —la
 * misma regla que `chooseSource` en `catalog-store`—.
 */
describe('la calidad preferida al elegir la fuente', () => {
  test('sin preferencia manda la primera del proveedor', () => {
    const fuentes = [fuente('720p', '/a'), fuente('1080p', '/b')]

    expect(elegirFuente(fuentes, undefined)?.url).toBe('/a')
  })

  test('con preferencia se elige la que coincide, aunque no sea la primera', () => {
    const fuentes = [fuente('720p', '/a'), fuente('1080p', '/b')]

    expect(elegirFuente(fuentes, '1080p')?.url).toBe('/b')
  })

  test('si ninguna coincide, se queda la primera', () => {
    const fuentes = [fuente('720p', '/a'), fuente('480p', '/b')]

    expect(elegirFuente(fuentes, '1080p')?.url).toBe('/a')
  })

  test('una fuente sin calidad declarada no coincide con nada', () => {
    const fuentes = [fuente(undefined, '/a'), fuente('720p', '/b')]

    expect(elegirFuente(fuentes, '1080p')?.url).toBe('/a')
  })

  test('sin fuentes no hay nada que reproducir', () => {
    expect(elegirFuente([], '1080p')).toBeUndefined()
  })
})
