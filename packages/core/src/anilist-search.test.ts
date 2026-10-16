/**
 * La búsqueda de una sola casilla: el análisis del texto y los valores de la consulta.
 *
 * La tabla de casos es la del contrato, y las tres que importan están marcadas:
 * **lo que no se pide no se manda** —y se mide con `Object.hasOwn`, porque `toEqual`
 * con `undefined` pasaría igual y no mediría nada—, **un género desconocido no viaja**
 * y **la comparación es exacta**, sin prefijos.
 */

import { describe, expect, test } from 'bun:test'
import {
  ANILIST_SORT_POPULAR,
  ANILIST_SORT_SEARCH,
  buildAniListVariables,
  DEFAULT_PER_PAGE,
  displayTitleOf,
  genreKey,
  MAX_PER_PAGE,
  parseAniListInput,
} from './anilist-search'

/** La lista que devolvería `GenreCollection`, recortada a lo que usan los casos. */
const GENEROS = [
  'Action',
  'Comedy',
  'Drama',
  'Fantasy',
  'Mahou Shoujo',
  'Music',
  'Romance',
  'Sci-Fi',
  'Slice of Life',
]

/** Los valores de una página, con los defectos. */
function valores(input: string, page?: number, perPage?: number) {
  return buildAniListVariables(parseAniListInput(input, GENEROS), {
    ...(page === undefined ? {} : { page }),
    ...(perPage === undefined ? {} : { perPage }),
  })
}

describe('el texto de la casilla se separa en título y géneros', () => {
  test('un título solo', () => {
    expect(parseAniListInput('naruto', GENEROS)).toEqual({
      search: 'naruto',
      genres: [],
      unknownGenres: [],
    })
  })

  test('título y un género', () => {
    expect(parseAniListInput('shingeki no kyojin #action', GENEROS)).toEqual({
      search: 'shingeki no kyojin',
      genres: ['Action'],
      unknownGenres: [],
    })
  })

  test('título y dos géneros, en el orden en que se escribieron', () => {
    expect(parseAniListInput('attack on titan #drama #fantasy', GENEROS)).toEqual({
      search: 'attack on titan',
      genres: ['Drama', 'Fantasy'],
      unknownGenres: [],
    })
  })

  test('sólo géneros', () => {
    expect(parseAniListInput('#comedy #slice-of-life', GENEROS)).toEqual({
      search: null,
      genres: ['Comedy', 'Slice of Life'],
      unknownGenres: [],
    })
  })

  test('vacío es una petición válida, no un error', () => {
    expect(parseAniListInput('   ', GENEROS)).toEqual({
      search: null,
      genres: [],
      unknownGenres: [],
    })
  })

  test('los géneros se escriben como se quiera: mayúsculas, guiones y guiones bajos', () => {
    expect(parseAniListInput('   #ACTION   ', GENEROS).genres).toEqual(['Action'])
    expect(parseAniListInput('#slice-of-life', GENEROS).genres).toEqual(['Slice of Life'])
    expect(parseAniListInput('#slice_of_life', GENEROS).genres).toEqual(['Slice of Life'])
    expect(parseAniListInput('#mahou-shoujo', GENEROS).genres).toEqual(['Mahou Shoujo'])
    expect(parseAniListInput('#sci_fi', GENEROS).genres).toEqual(['Sci-Fi'])
  })

  test('un género de dos palabras se escribe con guion: el espacio separa tokens', () => {
    // Es la gramática de la casilla y conviene que se vea en una prueba: `#slice of life`
    // no es el género `Slice of Life` —el espacio termina el token—, sino el género
    // «slice», que no existe, y un título «of life».
    expect(parseAniListInput('#slice of life', GENEROS)).toEqual({
      search: 'of life',
      genres: [],
      unknownGenres: ['slice'],
    })
  })

  test('el mismo género repetido es uno solo', () => {
    expect(parseAniListInput('#action #Action #ACTION', GENEROS).genres).toEqual(['Action'])
  })

  test('los géneros se quitan del medio y el título se junta en orden', () => {
    expect(parseAniListInput('a #drama b', GENEROS)).toEqual({
      search: 'a b',
      genres: ['Drama'],
      unknownGenres: [],
    })
  })

  test('el título conserva su escritura y sus signos', () => {
    const conSignos = parseAniListInput('Fate/stay night #action', GENEROS)

    expect(conSignos.search).toBe('Fate/stay night')
    expect(parseAniListInput('Naruto  #ACTION  ', GENEROS).search).toBe('Naruto')
  })

  test('una `e` compuesta y una descompuesta dan el mismo título', () => {
    // El texto se compone en NFC al analizarlo, así que dos teclados que escriben la
    // misma palabra de dos formas producen la misma petición —y la misma clave de caché—.
    expect(parseAniListInput('Naruto e\u0301xito', GENEROS).search).toBe('Naruto éxito')
    expect(parseAniListInput('éxito', GENEROS)).toEqual(parseAniListInput('e\u0301xito', GENEROS))
  })

  test('un género que no es suyo se informa y no entra', () => {
    expect(parseAniListInput('#shonnen naruto', GENEROS)).toEqual({
      search: 'naruto',
      genres: [],
      unknownGenres: ['shonnen'],
    })
  })

  test('un `#` suelto se informa como se escribió', () => {
    expect(parseAniListInput('#', GENEROS)).toEqual({
      search: null,
      genres: [],
      unknownGenres: ['#'],
    })
    expect(parseAniListInput('#-', GENEROS).unknownGenres).toEqual(['#-'])
  })

  test('un `#` de más no se corrige solo', () => {
    expect(parseAniListInput('##action', GENEROS)).toEqual({
      search: null,
      genres: [],
      unknownGenres: ['#action'],
    })
  })

  test('no hay coincidencia parcial: `#act` no es `Action`', () => {
    expect(parseAniListInput('#act', GENEROS).genres).toEqual([])
    expect(parseAniListInput('#action-comedy', GENEROS).unknownGenres).toEqual(['action comedy'])
  })

  test('los acentos no traducen un género: `#música` no es `Music`', () => {
    // Traducir sería una tabla que se queda vieja, y el repositorio ya pagó una vez por
    // inventarse una. Lo que sí hace la clave es ignorar los acentos al comparar.
    expect(parseAniListInput('#música', GENEROS)).toEqual({
      search: null,
      genres: [],
      unknownGenres: ['música'],
    })
  })

  test('el género desconocido repetido se informa una vez', () => {
    expect(parseAniListInput('#shonnen #SHONNEN', GENEROS).unknownGenres).toEqual(['shonnen'])
  })

  test('sin lista de géneros, todos son desconocidos: hay que esperarla', () => {
    // Es la medición de la regla de orden: pedir antes de tener la lista diría que un
    // género válido no lo es, y el usuario lo leería como un error suyo.
    expect(parseAniListInput('#action', []).unknownGenres).toEqual(['action'])
  })

  test('no muta lo que recibe ni depende de nada más', () => {
    const lista = Object.freeze([...GENEROS])
    const antes = parseAniListInput('naruto #action', lista)
    const despues = parseAniListInput('naruto #action', lista)

    expect(despues).toEqual(antes)
    expect(lista).toEqual(GENEROS)
  })
})

describe('la clave de un género', () => {
  test('ignora acentos, mayúsculas, guiones y guiones bajos', () => {
    expect(genreKey('Sci-Fi')).toBe('sci fi')
    expect(genreKey('sci_fi')).toBe('sci fi')
    expect(genreKey('  SLICE   OF  LIFE ')).toBe('slice of life')
    expect(genreKey('Música')).toBe('musica')
  })

  test('conserva las letras que no son latinas', () => {
    // Una clave que sólo dejara `a-z` convertiría cualquier otro alfabeto en la cadena
    // vacía, y la cadena vacía casa con todo lo que tampoco tenga letras.
    expect(genreKey('音楽')).toBe('音楽')
  })
})

describe('los valores de la consulta', () => {
  test('con título: el orden es el de la búsqueda', () => {
    const variables = valores('naruto')

    expect(variables).toEqual({
      search: 'naruto',
      page: 1,
      perPage: DEFAULT_PER_PAGE,
      sort: [ANILIST_SORT_SEARCH],
    })
  })

  test('sin título: el orden es el de lo más popular', () => {
    expect(valores('#comedy')).toEqual({
      genres: ['Comedy'],
      page: 1,
      perPage: DEFAULT_PER_PAGE,
      sort: [ANILIST_SORT_POPULAR],
    })
  })

  test('vacío: lo más popular, y sin ninguna clave de filtro', () => {
    const variables = valores('')

    expect(variables).toEqual({ page: 1, perPage: DEFAULT_PER_PAGE, sort: [ANILIST_SORT_POPULAR] })
    // `toEqual` no distingue `{search: undefined}` de `{}`: lo que se mide es que la
    // clave **no esté**, que es lo que la API lee como «sin filtro».
    expect(Object.hasOwn(variables, 'search')).toBe(false)
    expect(Object.hasOwn(variables, 'genres')).toBe(false)
  })

  test('no se manda una cadena vacía ni una lista vacía', () => {
    const soloGeneros = valores('#action')
    const soloTitulo = valores('naruto')

    expect(Object.hasOwn(soloGeneros, 'search')).toBe(false)
    expect(Object.hasOwn(soloTitulo, 'genres')).toBe(false)
    expect(Object.values(valores('  ')).includes('')).toBe(false)
    expect(soloTitulo.search).not.toBe('')
  })

  test('un género desconocido no llega a los valores', () => {
    const variables = valores('#shonnen naruto')

    expect(Object.hasOwn(variables, 'genres')).toBe(false)
    expect(JSON.stringify(variables)).not.toContain('shonnen')
  })

  test('la página y el tope se acotan, no se rechazan', () => {
    expect(valores('naruto', 3, 10)).toMatchObject({ page: 3, perPage: 10 })
    expect(valores('naruto', 0, 999)).toMatchObject({ page: 1, perPage: MAX_PER_PAGE })
    expect(valores('naruto', -5, 0)).toMatchObject({ page: 1, perPage: 1 })
  })

  test('cada página lleva sus propios valores, sin arrastrar los de la anterior', () => {
    const primera = valores('naruto')
    const segunda = valores('naruto', 2)

    expect(segunda.page).toBe(2)
    expect(Object.values(segunda)).not.toContain(undefined)
    expect(primera.page).toBe(1)
  })
})

describe('el título que se enseña', () => {
  test('el inglés manda, y el romaji va debajo si no es el mismo', () => {
    expect(
      displayTitleOf({ romaji: 'Sousou no Frieren', english: 'Frieren', native: null }, 1),
    ).toEqual({ title: 'Frieren', secondary: 'Sousou no Frieren' })
  })

  test('sin inglés se enseña el romaji y no hay segunda línea', () => {
    expect(displayTitleOf({ romaji: 'Sousou no Frieren', english: null, native: null }, 1)).toEqual(
      {
        title: 'Sousou no Frieren',
      },
    )
  })

  test('si el inglés y el romaji son el mismo texto, no se repite', () => {
    expect(displayTitleOf({ romaji: 'Bleach', english: 'Bleach', native: null }, 1)).toEqual({
      title: 'Bleach',
    })
  })

  test('sin ninguno de los tres queda el id, que es lo único que identifica la obra', () => {
    expect(displayTitleOf({ romaji: null, english: null, native: null }, 16498)).toEqual({
      title: '#16498',
    })
    expect(displayTitleOf({ romaji: '  ', english: '', native: null }, 7)).toEqual({ title: '#7' })
  })

  test('el nativo es el último recurso antes del id', () => {
    expect(displayTitleOf({ romaji: null, english: null, native: '鬼滅の刃' }, 1)).toEqual({
      title: '鬼滅の刃',
    })
  })
})
