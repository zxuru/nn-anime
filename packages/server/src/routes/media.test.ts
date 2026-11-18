/**
 * El filtro de familia y formato de las rutas de lectura.
 *
 * Se prueba aparte porque las ocho rutas lo comparten: si la regla viviera
 * repetida en cada una, una tabla con una sola pestaña que filtrara distinto se
 * leería como un fallo de la aplicación y no habría dónde mirarlo. Aquí se mide
 * lo que se acepta por la dirección —con el alias viejo incluido—, a quién se le
 * pregunta y qué títulos entran.
 */

import { describe, expect, test } from 'bun:test'
import type { MediaFamily, SearchResult } from '@rona/core'
import { createFixtureProvider } from '@rona/providers-fixture'
import {
  type ConTipo,
  enFiltro,
  type FiltroPedido,
  familiasPorProveedor,
  filtroFrom,
  puedeServirElFiltro,
} from './media'

/** El filtro de un pedido que tenía que valer; falla si no. */
function filtro(consulta: Parameters<typeof filtroFrom>[0]) {
  const pedido: FiltroPedido = filtroFrom(consulta)
  if (!pedido.ok) throw new Error(`tenía que valer: ${pedido.error}`)

  return pedido.filtro
}

describe('el filtro que llega por la dirección', () => {
  test('sin parámetros no se filtra nada', () => {
    expect(filtro({})).toEqual({})
    expect(filtro({ family: '  ', format: '', media: '' })).toEqual({})
  })

  test('la familia y el formato del vocabulario se aceptan', () => {
    expect(filtro({ family: 'anime' })).toEqual({ families: ['anime'] })
    expect(filtro({ family: 'live' })).toEqual({ families: ['live'] })
    expect(filtro({ format: 'series' })).toEqual({ format: 'series' })
    expect(filtro({ format: 'movie' })).toEqual({ format: 'movie' })
    expect(filtro({ family: 'animation', format: 'movie' })).toEqual({
      families: ['animation'],
      format: 'movie',
    })
  })

  test('un valor inventado se rechaza nombrándolo y con las opciones', () => {
    // Rechazar y no ignorar: devolver todo en silencio haría que el filtro
    // pareciera roto desde la interfaz, que es donde se ve el síntoma.
    const familia = filtroFrom({ family: 'documental' })
    expect(familia.ok).toBe(false)
    if (familia.ok) throw new Error('tenía que rechazarse')
    expect(familia.error).toContain('documental')
    expect(familia.error).toContain('animation')

    const formato = filtroFrom({ format: 'miniserie' })
    expect(formato.ok).toBe(false)
    if (formato.ok) throw new Error('tenía que rechazarse')
    expect(formato.error).toContain('miniserie')
    expect(formato.error).toContain('movie')
  })

  /**
   * El alias de la versión anterior.
   *
   * `movies` no era un formato: era «todo lo que no es anime», o sea dos
   * familias. Traducirlo a una sola dejaría fuera la mitad de lo que ya enseñaba.
   */
  test('`media` se traduce al vocabulario nuevo', () => {
    expect(filtro({ media: 'anime' })).toEqual({ families: ['anime'] })
    expect(filtro({ media: 'movies' })).toEqual({ families: ['animation', 'live'] })
    expect(filtro({ media: 'both' })).toEqual({})
  })

  test('la familia gana al alias cuando llegan las dos', () => {
    expect(filtro({ family: 'anime', media: 'movies' })).toEqual({ families: ['anime'] })
  })
})

describe('las familias de cada proveedor cargado', () => {
  test('las declaradas, y anime para quien no declara nada', () => {
    const mixta = createFixtureProvider({ id: 'mixta', media: 'both' })
    const pelis = createFixtureProvider({ id: 'pelis', media: 'movies' })
    // Un plugin viejo: declara `media` y nada más.
    const clasica = createFixtureProvider({ id: 'clasica', media: 'anime' })
    const nuevas = createFixtureProvider({ id: 'nuevas' })

    const familias = familiasPorProveedor([mixta, pelis, clasica, nuevas])

    expect(familias.get('mixta')).toEqual(['anime', 'animation', 'live'])
    expect(familias.get('pelis')).toEqual(['animation', 'live'])
    expect(familias.get('clasica')).toEqual(['anime'])
    expect(familias.get('nuevas')).toEqual(['anime', 'animation', 'live'])
  })
})

describe('los títulos que entran en el filtro', () => {
  const familias: ReadonlyMap<string, readonly MediaFamily[]> = new Map([
    ['anime', ['anime']],
    ['pelis', ['animation', 'live']],
    ['mixta', ['anime', 'animation', 'live']],
  ])

  function titulo(
    providerId: string,
    value: string,
    kind?: ConTipo['kind'],
    extra: Pick<ConTipo, 'family' | 'format'> = {},
  ): SearchResult {
    return {
      ref: { providerId, value },
      title: value,
      ...(kind === undefined ? {} : { kind }),
      ...extra,
    }
  }

  test('sin filtro entran todos, incluidos los de una fuente que no está', () => {
    const items = [titulo('anime', 'a', 'tv'), titulo('pelis', 'b', 'movie'), titulo('otra', 'c')]

    expect(enFiltro(items, {}, familias)).toHaveLength(3)
  })

  test('la fuente de una sola familia se lleva lo suyo y la mixta se reparte por el `kind`', () => {
    const serieDeAnime = titulo('anime', 'a', 'tv')
    const peliculaDeAnime = titulo('anime', 'b', 'movie')
    const serieDePelis = titulo('pelis', 'c', 'tv')
    const peliculaMixta = titulo('mixta', 'd', 'movie')
    const serieMixta = titulo('mixta', 'e', 'tv')
    const items = [serieDeAnime, peliculaDeAnime, serieDePelis, peliculaMixta, serieMixta]

    // La película de una fuente de anime es anime: lo que decide es la fuente, y
    // sólo dentro de una fuente mixta manda el `kind`.
    expect(enFiltro(items, { families: ['anime'] }, familias)).toEqual([
      serieDeAnime,
      peliculaDeAnime,
      serieMixta,
    ])
    expect(enFiltro(items, { families: ['animation', 'live'] }, familias)).toEqual([
      serieDePelis,
      peliculaMixta,
    ])
  })

  test('lo declarado por título gana a lo que sirve la fuente', () => {
    // La película de anime vive en Anime y se aísla con el filtro de formato: es
    // el caso que el `kind` de una fuente mixta repartía mal.
    const peliculaDeAnime = titulo('mixta', 'peli', 'movie', { family: 'anime', format: 'movie' })
    const serieDeLive = titulo('mixta', 'serie', 'tv', { family: 'live', format: 'series' })

    expect(enFiltro([peliculaDeAnime], { families: ['anime'], format: 'movie' }, familias)).toEqual(
      [peliculaDeAnime],
    )
    expect(enFiltro([peliculaDeAnime], { families: ['live'] }, familias)).toEqual([])
    expect(enFiltro([serieDeLive], { families: ['anime'] }, familias)).toEqual([])
    expect(enFiltro([serieDeLive], { families: ['live'], format: 'series' }, familias)).toEqual([
      serieDeLive,
    ])
  })

  test('una referencia de una fuente que ya no está cuenta como anime', () => {
    const huerfano = titulo('desinstalada', 'x', 'movie')

    expect(enFiltro([huerfano], { families: ['anime'] }, familias)).toEqual([huerfano])
    expect(enFiltro([huerfano], { families: ['animation', 'live'] }, familias)).toEqual([])
  })

  test('a una fuente que no sirve la familia no se le pregunta', () => {
    const soloAnime = createFixtureProvider({ id: 'solo-anime', media: 'anime' })
    const mixta = createFixtureProvider({ id: 'mixta', media: 'both' })

    expect(puedeServirElFiltro({ families: ['live'] }, soloAnime)).toBe(false)
    // La mixta sí: sus títulos se reparten después.
    expect(puedeServirElFiltro({ families: ['live'] }, mixta)).toBe(true)
    expect(puedeServirElFiltro({}, soloAnime)).toBe(true)
  })
})
