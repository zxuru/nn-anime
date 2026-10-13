/**
 * La capacidad de red, vista desde el contrato.
 *
 * Lo que se comprueba aquí es la **inyección**: que un plugin reciba la capacidad
 * del motor en cada llamada y que, sin nada registrado, no reciba nada —y por
 * tanto falle cerrado si la usa— en vez de salir por el `fetch` global sin que
 * nadie lo note.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { PluginFetch, PluginFetchCall } from '@nn-anime/core'
import { search } from './call'
import { pluginFetchFor, setPluginFetchFactory } from './network'
import type { CallOptions, Provider } from './types'

const REF = { providerId: 'fixture', value: 'titulo-1' }

/** Un proveedor que apunta las opciones que recibe. */
function providerQueApunta(recibidas: CallOptions[]): Provider {
  return {
    id: 'fixture',
    name: 'Fixture',
    apiVersion: '1',
    capabilities: { search: true, sub: true, dub: false, trending: false, feed: false },
    search: async (_query, options) => {
      recibidas.push(options)

      return []
    },
    getAnime: async () => ({ ref: REF, title: 'Un título', genres: [], studios: [] }),
    getEpisodes: async () => [],
    resolveStream: async () => [],
  }
}

const capacidad: PluginFetch = async () => ({
  status: 200,
  url: 'https://sitio.example/',
  headers: {},
  setCookie: [],
  body: 'ok',
})

// El registro es estado de módulo y lo comparte todo el proceso: otro archivo que
// construya un contenedor lo deja puesto, así que cada prueba fija su precondición
// en vez de suponer que nadie lo tocó.
beforeEach(() => {
  setPluginFetchFactory(undefined)
})

afterEach(() => {
  setPluginFetchFactory(undefined)
})

describe('la capacidad que ve un plugin', () => {
  test('sin nada registrado, el contrato no la trae', async () => {
    const recibidas: CallOptions[] = []
    await search(providerQueApunta(recibidas), 'algo', {
      signal: new AbortController().signal,
      timeoutMs: 8000,
    })

    expect(recibidas).toHaveLength(1)
    expect(recibidas[0]?.fetch).toBeUndefined()
  })

  test('registrada, llega en cada llamada con el plazo y la señal de quien pidió', async () => {
    const llamadas: PluginFetchCall[] = []
    setPluginFetchFactory((call) => {
      llamadas.push(call)

      return capacidad
    })

    const recibidas: CallOptions[] = []
    const signal = new AbortController().signal
    await search(providerQueApunta(recibidas), 'algo', { signal, timeoutMs: 1234 })

    expect(recibidas[0]?.fetch).toBe(capacidad)
    // La fábrica se construye con la llamada y no con el proceso: es lo que hace
    // que el plazo y la cancelación sean del usuario que pidió.
    expect(llamadas[0]?.timeoutMs).toBe(1234)
    expect(llamadas[0]?.signal).toBe(signal)
  })

  test('si el llamante ya traía una, se respeta la suya', async () => {
    setPluginFetchFactory(() => capacidad)
    const suya: PluginFetch = async () => ({
      status: 200,
      url: 'https://otro.example/',
      headers: {},
      setCookie: [],
      body: 'suya',
    })

    const recibidas: CallOptions[] = []
    await search(providerQueApunta(recibidas), 'algo', {
      signal: new AbortController().signal,
      timeoutMs: 8000,
      fetch: suya,
    })

    expect(recibidas[0]?.fetch).toBe(suya)
  })

  test('quitarla la deja sin poner otra vez', () => {
    setPluginFetchFactory(() => capacidad)
    expect(pluginFetchFor({ signal: new AbortController().signal, timeoutMs: 1 })).toBe(capacidad)

    setPluginFetchFactory(undefined)
    expect(pluginFetchFor({ signal: new AbortController().signal, timeoutMs: 1 })).toBeUndefined()
  })
})
