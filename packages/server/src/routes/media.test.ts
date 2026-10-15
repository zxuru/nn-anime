/**
 * El filtro de tipo de las rutas de lectura.
 *
 * Se prueba aparte porque las cuatro rutas lo comparten: si la regla viviera
 * repetida en cada una, una tabla con una sola pestaña que filtrara distinto se
 * leería como un fallo de la aplicación y no habría dónde mirarlo.
 */

import { describe, expect, test } from 'bun:test'
import type { ProviderMedia, SearchResult } from '@nn-anime/core'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { type ConTipo, enMedia, mediaFrom, mediaPorProveedor } from './media'

describe('el tipo que llega por la dirección', () => {
  test('sin parámetro no se filtra nada', () => {
    expect(mediaFrom(undefined)).toEqual({ ok: true, media: undefined })
    expect(mediaFrom('')).toEqual({ ok: true, media: undefined })
  })

  test('los tres valores del vocabulario se aceptan', () => {
    for (const media of ['anime', 'movies', 'both'] as const) {
      expect(mediaFrom(media)).toEqual({ ok: true, media })
    }
  })

  test('un valor fuera del vocabulario se rechaza nombrándolo y con las opciones', () => {
    // Rechazar y no ignorar: devolver todo en silencio haría que el filtro
    // pareciera roto desde la interfaz, que es donde se ve el síntoma.
    const salida = mediaFrom('anime-y-peliculas')

    expect(salida.ok).toBe(false)
    if (salida.ok) throw new Error('tenía que rechazarse')
    expect(salida.error).toContain('anime-y-peliculas')
    expect(salida.error).toContain('movies')
  })
})

describe('la media de cada proveedor cargado', () => {
  test('la declarada, y anime para quien no la declara', () => {
    const mixta = createFixtureProvider({ id: 'mixta', media: 'both' })
    const pelis = createFixtureProvider({ id: 'pelis', media: 'movies' })
    const sinDeclarar = createFixtureProvider({ id: 'clasica' })
    const sinMedia = {
      ...sinDeclarar,
      capabilities: { ...sinDeclarar.capabilities, media: undefined },
    }

    const medias = mediaPorProveedor([mixta, pelis, sinMedia])

    expect(medias.get('mixta')).toBe('both')
    expect(medias.get('pelis')).toBe('movies')
    expect(medias.get('clasica')).toBe('anime')
  })
})

describe('los títulos que entran en la mitad pedida', () => {
  const medias: ReadonlyMap<string, ProviderMedia> = new Map([
    ['anime', 'anime'],
    ['pelis', 'movies'],
    ['mixta', 'both'],
  ])

  function titulo(providerId: string, value: string, kind?: ConTipo['kind']): SearchResult {
    return { ref: { providerId, value }, title: value, ...(kind === undefined ? {} : { kind }) }
  }

  test('sin filtro entran todos, incluidos los de una fuente que no está', () => {
    const items = [titulo('anime', 'a', 'tv'), titulo('pelis', 'b', 'movie'), titulo('otra', 'c')]

    expect(enMedia(items, undefined, medias)).toHaveLength(3)
  })

  test('la fuente de un solo tipo se lleva lo suyo y la mixta se reparte por el `kind`', () => {
    const serieDeAnime = titulo('anime', 'a', 'tv')
    const peliculaDeAnime = titulo('anime', 'b', 'movie')
    const serieDePelis = titulo('pelis', 'c', 'tv')
    const peliculaMixta = titulo('mixta', 'd', 'movie')
    const serieMixta = titulo('mixta', 'e', 'tv')
    const items = [serieDeAnime, peliculaDeAnime, serieDePelis, peliculaMixta, serieMixta]

    // La película de una fuente de anime es anime: lo que decide es la fuente, y
    // sólo dentro de una fuente mixta manda el `kind`.
    expect(enMedia(items, 'anime', medias)).toEqual([serieDeAnime, peliculaDeAnime, serieMixta])
    expect(enMedia(items, 'movies', medias)).toEqual([serieDePelis, peliculaMixta])
  })

  test('una referencia de una fuente que ya no está cuenta como anime', () => {
    const huerfano = titulo('desinstalada', 'x', 'movie')

    expect(enMedia([huerfano], 'anime', medias)).toEqual([huerfano])
    expect(enMedia([huerfano], 'movies', medias)).toEqual([])
  })
})
