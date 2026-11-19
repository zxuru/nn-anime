/**
 * El filtro de formato de las rutas de lectura.
 *
 * Se prueba aparte porque las lecturas lo comparten: si la regla viviera repetida
 * en cada una, una lista que filtrara distinto se leería como un fallo de la
 * aplicación y no habría dónde mirarlo. Aquí se mide lo que se acepta por la
 * dirección —con los parámetros retirados incluidos— y qué títulos entran.
 */

import { describe, expect, test } from 'bun:test'
import type { SearchResult } from '@rona/core'
import { type ConTipo, enFiltro, type FiltroPedido, filtroFrom } from './media'

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

  test('el formato del vocabulario se acepta', () => {
    expect(filtro({ format: 'series' })).toEqual({ format: 'series' })
    expect(filtro({ format: 'movie' })).toEqual({ format: 'movie' })
  })

  test('`family` y `media` se aceptan y se ignoran', () => {
    // T372 retiró el eje de familias. Un enlace guardado no puede dar 400: la
    // pantalla es la misma y el formato que lo acompañe se respeta.
    expect(filtro({ family: 'live' })).toEqual({})
    expect(filtro({ family: 'documental' })).toEqual({})
    expect(filtro({ media: 'movies' })).toEqual({})
    expect(filtro({ family: 'animation', media: 'both', format: 'movie' })).toEqual({
      format: 'movie',
    })
  })

  test('un formato inventado se rechaza nombrándolo y con las opciones', () => {
    // Rechazar y no ignorar: devolver todo en silencio haría que el filtro
    // pareciera roto desde la interfaz, que es donde se ve el síntoma.
    const formato = filtroFrom({ format: 'miniserie' })
    expect(formato.ok).toBe(false)
    if (formato.ok) throw new Error('tenía que rechazarse')
    expect(formato.error).toContain('miniserie')
    expect(formato.error).toContain('movie')
  })
})

describe('los títulos que entran en el filtro', () => {
  function titulo(
    providerId: string,
    value: string,
    kind?: ConTipo['kind'],
    formato?: ConTipo['format'],
  ): SearchResult {
    return {
      ref: { providerId, value },
      title: value,
      ...(kind === undefined ? {} : { kind }),
      ...(formato === undefined ? {} : { format: formato }),
    }
  }

  test('sin filtro entran todos', () => {
    const items = [titulo('uno', 'a', 'tv'), titulo('dos', 'b', 'movie')]

    expect(enFiltro(items, {})).toHaveLength(2)
  })

  test('el formato declarado por el título decide', () => {
    const pelicula = titulo('uno', 'peli', 'tv', 'movie')
    const serie = titulo('uno', 'serie', 'movie', 'series')

    expect(enFiltro([pelicula, serie], { format: 'movie' })).toEqual([pelicula])
    expect(enFiltro([pelicula, serie], { format: 'series' })).toEqual([serie])
  })

  test('sin formato declarado, el `kind` decide', () => {
    const pelicula = titulo('uno', 'peli', 'movie')
    const serie = titulo('uno', 'serie', 'tv')

    expect(enFiltro([pelicula, serie], { format: 'movie' })).toEqual([pelicula])
    expect(enFiltro([pelicula, serie], { format: 'series' })).toEqual([serie])
  })

  test('el manga nunca entra: no es una lista de vídeo', () => {
    const manga: SearchResult = {
      ref: { providerId: 'uno', value: 'manga' },
      title: 'manga',
      mediaType: 'manga',
    }

    expect(enFiltro([manga], {})).toEqual([])
    expect(enFiltro([manga], { format: 'series' })).toEqual([])
  })
})
