import { describe, expect, test } from 'bun:test'
import { DEFAULT_MEDIA, esDeMedia, mediaOf, mediaTypeOf, pasaElFiltro } from './media'

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

describe('mediaTypeOf: qué es un título', () => {
  test('lo que declara la fuente gana sobre lo que se deduciría', () => {
    // Una fuente mixta puede tener una serie de acción real: sin el campo, su
    // `tv` caería del lado del anime.
    expect(mediaTypeOf({ kind: 'tv', mediaType: 'series' }, 'both')).toBe('series')
    expect(mediaTypeOf({ kind: 'tv', mediaType: 'series' }, 'anime')).toBe('series')
  })

  test('sin el campo, una fuente de películas reparte por el formato', () => {
    expect(mediaTypeOf({ kind: 'movie' }, 'movies')).toBe('movie')
    expect(mediaTypeOf({ kind: 'tv' }, 'movies')).toBe('series')
    expect(mediaTypeOf({}, 'movies')).toBe('series')
  })

  test('una fuente de anime o mixta antigua sigue contando lo suyo como anime', () => {
    // La compatibilidad que no se puede romper: `both` sin `mediaType` no puede
    // distinguir una serie de acción real y no la inventa.
    expect(mediaTypeOf({ kind: 'tv' }, 'both')).toBe('anime')
    expect(mediaTypeOf({ kind: 'movie' }, 'both')).toBe('movie')
    expect(mediaTypeOf({ kind: 'movie' }, 'anime')).toBe('anime')
    expect(mediaTypeOf({}, 'anime')).toBe('anime')
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

  test('una serie declarada entra en películas aunque su `kind` sea `tv`', () => {
    // Es F8: la fuente mixta dice que su `tv` es una serie de acción real.
    expect(pasaElFiltro('movies', 'both', 'tv', 'series')).toBe(true)
    expect(pasaElFiltro('anime', 'both', 'tv', 'series')).toBe(false)
    expect(esDeMedia('movies', 'both', 'tv', 'series')).toBe(true)
  })
})
