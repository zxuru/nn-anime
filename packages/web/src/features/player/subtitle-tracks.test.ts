import { describe, expect, test } from 'bun:test'
import {
  defaultTrackIndex,
  isProxyPath,
  toSafeTracks,
  tracksFromSource,
  webTracks,
} from './subtitle-tracks'

describe('qué pistas ofrece la web', () => {
  test('un `ass` se omite: el navegador no lo entiende', () => {
    const pistas = webTracks([
      { url: '/api/subtitles/a', lang: 'es', format: 'srt' },
      { url: '/api/subtitles/b', lang: 'en', format: 'ass' },
    ])

    expect(pistas).toHaveLength(1)
    expect(pistas[0]?.lang).toBe('es')
  })

  test('una dirección que no es del proxy se omite', () => {
    const pistas = webTracks([
      { url: 'https://otro.example/es.vtt', lang: 'es' },
      { url: '/api/subtitles/a', lang: 'es' },
      { url: '/stream/abc', lang: 'es' },
    ])

    expect(pistas.map((pista) => pista.url)).toEqual(['/api/subtitles/a', '/stream/abc'])
  })

  test('la etiqueta cae al idioma si el proveedor no da ninguna', () => {
    const pistas = webTracks([{ url: '/api/subtitles/a', lang: 'es' }])

    expect(pistas[0]?.label).toBe('es')
  })

  test('sin candidatas no hay pistas', () => {
    expect(webTracks([])).toEqual([])
    expect(tracksFromSource({})).toEqual([])
  })

  test('reconoce las rutas del proxy', () => {
    expect(isProxyPath('/api/subtitles/a')).toBe(true)
    expect(isProxyPath('/stream/abc')).toBe(true)
    expect(isProxyPath('https://otro.example/a.vtt')).toBe(false)
    expect(isProxyPath('javascript:alert(1)')).toBe(false)
  })
})

describe('pista por defecto', () => {
  test('es la primera: el proveedor las ordena por preferencia', () => {
    expect(defaultTrackIndex([{ url: '/a', lang: 'es', label: 'es' }])).toBe(0)
  })

  test('sin pistas, ninguna', () => {
    expect(defaultTrackIndex([])).toBe(-1)
  })
})

describe('lo que se le pasa al reproductor', () => {
  test('se queda con la ruta, el idioma y la etiqueta', () => {
    expect(toSafeTracks([{ url: '/api/subtitles/a', lang: 'es', label: 'Español' }])).toEqual([
      { url: '/api/subtitles/a', lang: 'es', label: 'Español' },
    ])
  })
})
