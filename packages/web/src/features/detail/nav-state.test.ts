import { describe, expect, test } from 'bun:test'
import { navStateDeTarjeta, readDetailNavState } from './nav-state'

/**
 * El adelanto de la ficha: lo que la tarjeta sabe y lo que se acepta de vuelta.
 *
 * La parte que importa es la validación: este estado acaba en un `<h1>` y en la
 * `src` de una imagen, y una entrada del historial puede traer cualquier cosa.
 * Lo que no se acepta se descarta en silencio y la ficha espera al servidor.
 */

describe('navStateDeTarjeta', () => {
  test('con título y referencia compone título y portada del proxy', () => {
    const estado = navStateDeTarjeta({
      title: 'Aurora Nocturna',
      providerId: 'fixture',
      ref: 'aurora-nocturna',
    })

    expect(estado).toEqual({
      title: 'Aurora Nocturna',
      poster: '/api/cover/fixture/aurora-nocturna',
    })
  })

  test('la portada de AniList gana sobre la del proveedor', () => {
    const estado = navStateDeTarjeta({
      title: 'Aurora Nocturna',
      providerId: 'fixture',
      ref: 'aurora-nocturna',
      poster: '/api/anilist/image/cover/555',
    })

    expect(estado?.poster).toBe('/api/anilist/image/cover/555')
  })

  test('una portada que no es una ruta ni una URL http se descarta', () => {
    const estado = navStateDeTarjeta({
      title: 'Aurora',
      providerId: 'fixture',
      ref: 'aurora',
      poster: 'javascript:alert(1)',
    })

    // Se cae a la portada del proveedor, que sí es una ruta conocida.
    expect(estado?.poster).toBe('/api/cover/fixture/aurora')
  })

  test('sin referencia no inventa portada', () => {
    expect(navStateDeTarjeta({ title: 'Aurora' })?.poster).toBeUndefined()
  })

  test('recorta el título y rechaza el vacío', () => {
    expect(navStateDeTarjeta({ title: '  Aurora  ' })?.title).toBe('Aurora')
    expect(navStateDeTarjeta({ title: '   ' })).toBeUndefined()
  })

  test('rechaza un título con etiquetas: no es un título, es basura', () => {
    expect(navStateDeTarjeta({ title: '<script>' })).toBeUndefined()
  })

  test('el año y los episodios se validan', () => {
    const estado = navStateDeTarjeta({ title: 'A', year: 2019, episodes: 12 })

    expect(estado?.year).toBe(2019)
    expect(estado?.episodes).toBe(12)

    expect(navStateDeTarjeta({ title: 'A', year: 12 })?.year).toBeUndefined()
    expect(navStateDeTarjeta({ title: 'A', episodes: 0 })?.episodes).toBeUndefined()
    expect(navStateDeTarjeta({ title: 'A', episodes: 2.5 })?.episodes).toBeUndefined()
  })

  test('los géneros se filtran y se acotan', () => {
    const estado = navStateDeTarjeta({
      title: 'A',
      genres: ['Misterio', '', 'Fantasía'],
    })

    expect(estado?.genres).toEqual(['Misterio', 'Fantasía'])

    const muchos = Array.from({ length: 40 }, (_, indice) => `g${indice}`)
    expect(navStateDeTarjeta({ title: 'A', genres: muchos })?.genres).toHaveLength(20)
  })
})

describe('readDetailNavState', () => {
  test('lo que escribe la tarjeta se puede leer de vuelta', () => {
    const estado = navStateDeTarjeta({
      title: 'Aurora Nocturna',
      providerId: 'fixture',
      ref: 'aurora-nocturna',
      year: 2019,
      genres: ['Misterio'],
      episodes: 12,
    })

    expect(readDetailNavState(estado)).toEqual(estado)
  })

  test('lo que no es un objeto no da adelanto', () => {
    for (const crudo of [undefined, null, 'Aurora', 42, [], true]) {
      expect(readDetailNavState(crudo)).toBeUndefined()
    }
  })

  test('sin título válido no hay adelanto', () => {
    expect(readDetailNavState({ poster: '/api/cover/f/a' })).toBeUndefined()
    expect(readDetailNavState({ title: '' })).toBeUndefined()
    expect(readDetailNavState({ title: 42 })).toBeUndefined()
  })

  test('descarta los campos que no validan y conserva el resto', () => {
    const estado = readDetailNavState({
      title: 'Aurora',
      poster: 'data:text/html,<script>',
      year: '2019',
      episodes: -3,
      genres: ['Misterio', 42],
      otraCosa: 'se ignora',
    })

    expect(estado).toEqual({ title: 'Aurora', genres: ['Misterio'] })
  })
})
