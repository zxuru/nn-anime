import { describe, expect, test } from 'bun:test'
import type { MediaFilter, ProviderMedia } from '@nn-anime/core/media'
import type { AnimeSummary } from '@nn-anime/core/models'
import {
  enElTipo,
  esDelTipo,
  fuenteDeResumen,
  fuenteDeVisionado,
  pathConTipo,
  sinFuenteQueSirva,
  TIPO_POR_DEFECTO,
  tipoFromPath,
} from './tipo'

const MEDIAS: ReadonlyMap<string, ProviderMedia> = new Map([
  ['anime', 'anime'],
  ['pelis', 'movies'],
  ['mixta', 'both'],
])

function resumen(providerId: string, value: string, kind?: AnimeSummary['kind']): AnimeSummary {
  return { ref: { providerId, value }, title: value, ...(kind === undefined ? {} : { kind }) }
}

describe('el tipo que pide una ruta', () => {
  test('sin parámetro se mira anime', () => {
    expect(tipoFromPath('/')).toBe('anime')
    expect(tipoFromPath('/search?q=aurora')).toBe('anime')
    expect(TIPO_POR_DEFECTO).toBe('anime')
  })

  test('`tipo=movies` es la otra mitad', () => {
    expect(tipoFromPath('/?tipo=movies')).toBe('movies')
    expect(tipoFromPath('/search?q=aurora&tipo=movies')).toBe('movies')
  })

  test('un valor que no está en el vocabulario cae en el defecto', () => {
    // La dirección la escribe cualquiera: una pestaña inventada no puede dejar la
    // pantalla en un estado que no existe.
    expect(tipoFromPath('/?tipo=peliculas')).toBe('anime')
  })
})

describe('la misma ruta con el tipo puesto', () => {
  test('el tipo de por defecto se quita de la dirección', () => {
    expect(pathConTipo('/?tipo=movies', 'anime')).toBe('/')
  })

  test('se añade al final, sin tocar lo que ya había', () => {
    expect(pathConTipo('/', 'movies')).toBe('/?tipo=movies')
    expect(pathConTipo('/search?q=aurora&provider=fixture', 'movies')).toBe(
      '/search?q=aurora&provider=fixture&tipo=movies',
    )
  })

  test('no reescribe los espacios de la consulta', () => {
    // `URLSearchParams` los escribiría como `+` y la dirección de arranque del CLI
    // los escribe como `%20`: dos convenciones para la misma búsqueda son dos
    // claves de caché distintas.
    expect(pathConTipo('/search?q=una%20peli', 'movies')).toBe('/search?q=una%20peli&tipo=movies')
  })

  test('volver a ponerlo no lo duplica', () => {
    expect(pathConTipo('/search?tipo=movies&q=a', 'movies')).toBe('/search?q=a&tipo=movies')
  })
})

describe('a qué mitad pertenece un título', () => {
  test('la fuente de un solo tipo se lleva lo suyo', () => {
    expect(esDelTipo('anime', MEDIAS, { providerId: 'anime', kind: 'tv' })).toBe(true)
    expect(esDelTipo('movies', MEDIAS, { providerId: 'anime', kind: 'movie' })).toBe(false)
    expect(esDelTipo('movies', MEDIAS, { providerId: 'pelis', kind: 'tv' })).toBe(true)
  })

  test('la mixta se reparte por el `kind`, y sin `kind` cuenta como anime', () => {
    expect(esDelTipo('movies', MEDIAS, { providerId: 'mixta', kind: 'movie' })).toBe(true)
    expect(esDelTipo('movies', MEDIAS, { providerId: 'mixta', kind: 'tv' })).toBe(false)
    expect(esDelTipo('anime', MEDIAS, { providerId: 'mixta' })).toBe(true)
  })

  test('una fuente que ya no está cuenta como anime', () => {
    expect(esDelTipo('anime', MEDIAS, { providerId: 'desinstalada', kind: 'movie' })).toBe(true)
  })

  test('la lista se filtra entera, con la fuente que diga quien llama', () => {
    const favoritos = [
      resumen('anime', 'serie', 'tv'),
      resumen('pelis', 'peli', 'movie'),
      resumen('mixta', 'otra-peli', 'movie'),
    ]
    // El mismo dato vive en `ref` —con el `kind` al lado— o en `animeRef`, que no lo
    // trae: son dos selectores y cada uno lee lo suyo. Equivocarse aquí no da error
    // de compilación y deja la pestaña de películas vacía con los datos delante, así
    // que los dos mapeos viven en el módulo y la prueba los usa tal cual.
    const continuar = [
      { animeRef: { providerId: 'pelis', value: 'a-medias' } },
      { animeRef: { providerId: 'anime', value: 'otra-a-medias' } },
    ]

    expect(
      enElTipo(favoritos, 'movies', MEDIAS, fuenteDeResumen).map((item) => item.title),
    ).toEqual(['peli', 'otra-peli'])
    expect(
      enElTipo(continuar, 'movies', MEDIAS, fuenteDeVisionado).map((item) => item.animeRef.value),
    ).toEqual(['a-medias'])
  })

  test('el mapeo del resumen se lleva el `kind`, que vive al lado de la referencia', () => {
    // La mutación que importa: leer `kind` dentro del `ref`, donde no está.
    expect(fuenteDeResumen({ ref: { providerId: 'mixta', value: 'x' }, kind: 'movie' })).toEqual({
      providerId: 'mixta',
      kind: 'movie',
    })
    expect(fuenteDeResumen({ ref: { providerId: 'mixta', value: 'x' } })).toEqual({
      providerId: 'mixta',
    })
  })

  test('lo que se está viendo no trae tipo, y no se le inventa', () => {
    expect(fuenteDeVisionado({ animeRef: { providerId: 'mixta', value: 'x' } })).toEqual({
      providerId: 'mixta',
    })
  })
})

describe('avisar de que no hay fuente para esta mitad', () => {
  test('con el mapa vacío no se afirma nada: no se sabe, y es el arranque de todo', () => {
    // El mapa está vacío mientras los proveedores llegan —y si esa lectura falla—:
    // avisar ahí diría «ninguna fuente sirve esta mitad» en el primer render de
    // todas las pantallas.
    expect(sinFuenteQueSirva(new Map(), 'movies')).toBe(false)
    expect(sinFuenteQueSirva(new Map(), 'anime')).toBe(false)
  })

  test('una fuente de anime no sirve la pestaña de películas', () => {
    const soloAnime: ReadonlyMap<string, ProviderMedia> = new Map([['anime', 'anime']])

    expect(sinFuenteQueSirva(soloAnime, 'movies')).toBe(true)
    expect(sinFuenteQueSirva(soloAnime, 'anime')).toBe(false)
  })

  test('una fuente de las dos cosas sirve las dos', () => {
    const mixta: ReadonlyMap<string, ProviderMedia> = new Map([['mixta', 'both']])
    const tipos: readonly MediaFilter[] = ['anime', 'movies']

    for (const tipo of tipos) expect(sinFuenteQueSirva(mixta, tipo)).toBe(false)
  })
})
