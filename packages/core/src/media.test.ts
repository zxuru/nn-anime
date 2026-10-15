import { describe, expect, test } from 'bun:test'
import { DEFAULT_MEDIA, esDeMedia, mediaOf, pasaElFiltro } from './media'

describe('qué sirve un proveedor', () => {
  test('un plugin que no lo declara es de anime', () => {
    // Es el defecto que hace que los plugins ya publicados sigan cargando y no
    // aparezcan en la pestaña de películas, que no es la suya.
    expect(mediaOf({})).toBe('anime')
    expect(DEFAULT_MEDIA).toBe('anime')
  })

  test('lo declarado manda sobre el defecto', () => {
    expect(mediaOf({ media: 'movies' })).toBe('movies')
    expect(mediaOf({ media: 'both' })).toBe('both')
    expect(mediaOf({ media: 'anime' })).toBe('anime')
  })
})

describe('a qué mitad pertenece un título', () => {
  test('un proveedor de películas sirve su mitad, con cualquier `kind`', () => {
    // La serie de una fuente que no es de anime es contenido de esa pestaña: el
    // reparto por `kind` sólo existe dentro de una fuente que sirve las dos cosas.
    expect(esDeMedia('movies', 'movies', 'tv')).toBe(true)
    expect(esDeMedia('movies', 'movies', 'movie')).toBe(true)
    expect(esDeMedia('anime', 'movies', 'movie')).toBe(false)
  })

  test('un proveedor de anime no entra en la otra mitad, ni con una película', () => {
    // Una película de un proveedor de anime —«Kimetsu no Yaiba Movie»— es anime:
    // lo que decide es la fuente, no el `kind`.
    expect(esDeMedia('anime', 'anime', 'movie')).toBe(true)
    expect(esDeMedia('movies', 'anime', 'movie')).toBe(false)
  })

  test('una fuente de las dos cosas reparte por el `kind`', () => {
    expect(esDeMedia('movies', 'both', 'movie')).toBe(true)
    expect(esDeMedia('movies', 'both', 'tv')).toBe(false)
    expect(esDeMedia('anime', 'both', 'tv')).toBe(true)
    expect(esDeMedia('anime', 'both', undefined)).toBe(true)
  })

  test('un `kind` que no se declaró cuenta como anime', () => {
    expect(esDeMedia('anime', 'both', undefined)).toBe(true)
    expect(esDeMedia('movies', 'both', undefined)).toBe(false)
  })
})

describe('el filtro que llega por la dirección', () => {
  test('sin filtro pasa todo, y también con `both`', () => {
    expect(pasaElFiltro(undefined, 'anime', 'tv')).toBe(true)
    expect(pasaElFiltro(undefined, 'movies', 'tv')).toBe(true)
    expect(pasaElFiltro('both', 'movies', 'tv')).toBe(true)
  })

  test('con filtro, decide la misma regla que la pestaña', () => {
    expect(pasaElFiltro('movies', 'both', 'movie')).toBe(true)
    expect(pasaElFiltro('movies', 'both', 'tv')).toBe(false)
    expect(pasaElFiltro('movies', 'anime', 'movie')).toBe(false)
    expect(pasaElFiltro('anime', 'movies', 'tv')).toBe(false)
  })
})
