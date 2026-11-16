import { describe, expect, test } from 'bun:test'
import { camino, entradaPortable } from './camino-actualizacion'

const portable = {
  platforms: {
    'windows-x86_64': { url: 'https://x/instalador', signature: 'firma-nsis' },
    'windows-x86_64-portable': { url: 'https://x/portable', signature: 'firma-portable' },
  },
}

const soloNsis = {
  platforms: {
    'windows-x86_64': { url: 'https://x/instalador', signature: 'firma-nsis' },
  },
}

describe('el camino de la actualización', () => {
  test('las dos formas de entrega se auto-reemplazan', () => {
    // Si alguien volviera a mandar la copia instalada al NSIS, esta prueba falla.
    expect(camino(true, portable)).toBe('portable')
    expect(camino(false, portable)).toBe('portable')
  })

  test('la copia instalada cae al NSIS si la release no trae el portable', () => {
    expect(camino(true, soloNsis)).toBe('nsis')
  })

  test('la copia portable no inventa un instalador que no puede ejecutar', () => {
    expect(camino(false, soloNsis)).toBe('ninguno')
  })

  test('una entrada portable a medias no cuenta como entrada', () => {
    expect(entradaPortable({ platforms: { 'windows-x86_64-portable': { url: 1 } } })).toBeNull()
    expect(entradaPortable({ platforms: [] })).toBeNull()
    expect(entradaPortable({})).toBeNull()
  })
})
