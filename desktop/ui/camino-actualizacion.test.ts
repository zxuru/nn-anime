import { describe, expect, test } from 'bun:test'
import { entradaPortable } from './camino-actualizacion'

const portable = {
  platforms: {
    'windows-x86_64': { url: 'https://x/portable', signature: 'firma-portable' },
    'windows-x86_64-portable': { url: 'https://x/portable', signature: 'firma-portable' },
  },
}

const sinPortable = {
  platforms: {
    'windows-x86_64': { url: 'https://x/otro', signature: 'firma-otra' },
  },
}

describe('la entrada portable de la actualización', () => {
  test('se lee la URL y la firma del ejecutable portable', () => {
    expect(entradaPortable(portable)).toEqual({
      url: 'https://x/portable',
      signature: 'firma-portable',
    })
  })

  test('una release sin la entrada portable no inventa una descarga', () => {
    expect(entradaPortable(sinPortable)).toBeNull()
  })

  test('una entrada portable a medias no cuenta como entrada', () => {
    expect(entradaPortable({ platforms: { 'windows-x86_64-portable': { url: 1 } } })).toBeNull()
    expect(entradaPortable({ platforms: [] })).toBeNull()
    expect(entradaPortable({})).toBeNull()
  })
})
