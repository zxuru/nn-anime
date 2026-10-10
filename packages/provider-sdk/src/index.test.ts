/**
 * Prueba de la superficie pública.
 *
 * El paquete se importa por su barrel, así que un nombre mal escrito en un
 * `export` no rompe ningún otro test —`tsc` sí lo ve, pero sólo si alguien lo
 * usa—. Aquí se comprueba lo que un autor de plugins importa, y la invariante
 * que de verdad puede desincronizarse: que todo método del contrato tenga su
 * schema de respuesta.
 */

import { describe, expect, test } from 'bun:test'
import * as sdk from './index'

describe('superficie pública', () => {
  test('exporta lo que un autor de plugins necesita', () => {
    const names = [
      'PROVIDER_API_VERSION',
      'PROVIDER_METHODS',
      'REQUIRED_PROVIDER_METHODS',
      'assertConforms',
      'classifyThrow',
      'createRegistry',
      'inspectConformance',
      'providerSchema',
      'providerStreamHeadersSchema',
      'search',
      'validateProvider',
    ]

    for (const name of names) expect(Object.hasOwn(sdk, name), name).toBe(true)
  })

  test('un plugin que declara la versión publicada pasa el schema', () => {
    const result = sdk.providerSchema.safeParse({
      id: 'fixture',
      name: 'Fixture',
      apiVersion: sdk.PROVIDER_API_VERSION,
      capabilities: { search: true, sub: true, dub: false, trending: false },
      search: async () => [],
      getAnime: async () => ({}),
      getEpisodes: async () => [],
      resolveStream: async () => [],
    })

    expect(result.success).toBe(true)
  })

  test('todo método del contrato tiene schema de respuesta', () => {
    for (const method of sdk.PROVIDER_METHODS) {
      expect(sdk.RESPONSE_SCHEMAS[method], method).toBeDefined()
    }
  })

  test('los métodos obligatorios están entre los del contrato', () => {
    for (const method of sdk.REQUIRED_PROVIDER_METHODS) {
      expect(sdk.PROVIDER_METHODS, method).toContain(method)
    }
  })
})
