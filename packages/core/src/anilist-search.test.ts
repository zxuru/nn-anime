/**
 * La regla que decide quién contesta una búsqueda.
 *
 * Es la mitad que sobrevive de la búsqueda de una sola casilla: con un `#` en el texto,
 * la búsqueda la contesta el catálogo y a las fuentes no se les pregunta. La prueba fija
 * los dos extremos —un `#` pegado a una palabra no cuenta, y un `#` suelto tampoco—,
 * porque de esa frontera depende que la pantalla y la petición digan lo mismo.
 */

import { describe, expect, test } from 'bun:test'
import { hasGenreToken } from './anilist-search'

describe('el texto pide un género cuando algún término empieza por `#`', () => {
  test('con un género delante, en medio o con espacios alrededor', () => {
    expect(hasGenreToken('#aventura')).toBe(true)
    expect(hasGenreToken('naruto #action')).toBe(true)
    expect(hasGenreToken('  #slice-of-life  ')).toBe(true)
    expect(hasGenreToken('#acción')).toBe(true)
  })

  test('un `#` suelto no pide ningún género', () => {
    expect(hasGenreToken('#')).toBe(false)
    expect(hasGenreToken('naruto #')).toBe(false)
    expect(hasGenreToken('')).toBe(false)
  })

  test('un `#` dentro de una palabra no es un término', () => {
    // Lo que separa es el espacio, así que `C#` es un título y no un género.
    expect(hasGenreToken('C# tutorial')).toBe(false)
  })

  test('no se comprueba que el género exista: eso necesita la lista de AniList', () => {
    // `#-` pide algo —y por eso el catálogo contesta—; que ese algo no sea un género es
    // otra pregunta, y la contesta el servidor con la lista delante.
    expect(hasGenreToken('#-')).toBe(true)
  })

  test('un título sin `#` lo contestan las fuentes', () => {
    expect(hasGenreToken('shingeki no kyojin')).toBe(false)
    expect(hasGenreToken('Fate/stay night')).toBe(false)
  })
})
