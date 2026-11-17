import { describe, expect, test } from 'bun:test'
import {
  type Clasificable,
  DEFAULT_MEDIA,
  esDeFamilia,
  esDeMedia,
  familiesOf,
  familyOf,
  formatOf,
  mediaOf,
  mediaTypeOf,
  pasaElFiltro,
  pasaElFiltroDeMedia,
  puedeServir,
  puedeServirFamilia,
} from './media'
import type { MediaFamily, MediaFormat } from './models'

const TODAS: readonly MediaFamily[] = ['anime', 'animation', 'live']
const SOLO_ANIME: readonly MediaFamily[] = ['anime']
const NO_ANIME: readonly MediaFamily[] = ['animation', 'live']

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

describe('familiesOf: qué familias sirve un proveedor', () => {
  test('el legado se traduce a las tres filas de la tabla', () => {
    // `movies` significa «todo lo que no es anime», que son dos familias: si
    // mapeara a una sola, la pestaña de animación o la de acción real se quedaría
    // vacía sin que nadie pudiera arreglarlo.
    expect(familiesOf({})).toEqual(['anime'])
    expect(familiesOf({ media: 'anime' })).toEqual(['anime'])
    expect(familiesOf({ media: 'movies' })).toEqual(['animation', 'live'])
    expect(familiesOf({ media: 'both' })).toEqual(['anime', 'animation', 'live'])
  })

  test('`families` gana cuando está declarado', () => {
    // Es lo que permite decir «anime y acción real pero no animación occidental»,
    // que `media` no sabe expresar.
    expect(familiesOf({ media: 'both', families: ['anime', 'live'] })).toEqual(['anime', 'live'])
    expect(familiesOf({ media: 'movies', families: ['anime'] })).toEqual(['anime'])
  })
})

interface CasoFamilia {
  readonly nombre: string
  readonly item: Clasificable
  readonly familias: readonly MediaFamily[]
  readonly esperada: MediaFamily
}

const CASOS_FAMILIA: readonly CasoFamilia[] = [
  {
    nombre: 'lo declarado por título gana sobre todo lo demás',
    // Una película de anime es anime, y una serie de acción real de una fuente
    // mixta es acción real: el formato no decide la familia.
    item: { family: 'anime', format: 'movie', mediaType: 'movie', kind: 'movie' },
    familias: TODAS,
    esperada: 'anime',
  },
  {
    nombre: 'lo declarado gana incluso sobre un `mediaType` que diría otra cosa',
    item: { family: 'live', mediaType: 'anime', kind: 'tv' },
    familias: TODAS,
    esperada: 'live',
  },
  {
    nombre: '`mediaType: anime` es anime aunque sea una película',
    item: { mediaType: 'anime', kind: 'movie' },
    familias: NO_ANIME,
    esperada: 'anime',
  },
  {
    nombre: '`mediaType: movie` cae por el conjunto y el `kind`',
    // Es la compatibilidad: el `mediaType` viejo no dice la familia, sólo el
    // formato; en una fuente mixta antigua un `movie` sigue cayendo en imagen real.
    item: { mediaType: 'movie', kind: 'movie' },
    familias: TODAS,
    esperada: 'live',
  },
  {
    nombre: '`mediaType: series` con `kind: tv` en una fuente mixta es anime',
    item: { mediaType: 'series', kind: 'tv' },
    familias: TODAS,
    esperada: 'anime',
  },
  {
    nombre: 'el manga no tiene familia de vídeo y cae en el defecto del conjunto',
    // `familyOf` no puede devolver «ninguna»; quien lo descarta es `pasaElFiltro`.
    item: { mediaType: 'manga', kind: 'tv' },
    familias: SOLO_ANIME,
    esperada: 'anime',
  },
  {
    nombre: 'un proveedor de una familia sirve su familia, con cualquier `kind`',
    item: { kind: 'movie' },
    familias: SOLO_ANIME,
    esperada: 'anime',
  },
  {
    nombre: 'un proveedor de una familia no se reparte por el `kind`',
    item: { kind: 'tv' },
    familias: ['live'],
    esperada: 'live',
  },
  {
    nombre: 'fuente mixta sin dato: `movie` cae en imagen real',
    item: { kind: 'movie' },
    familias: TODAS,
    esperada: 'live',
  },
  {
    nombre: 'fuente mixta sin dato: `movie` cae en animación si no hay imagen real',
    item: { kind: 'movie' },
    familias: ['anime', 'animation'],
    esperada: 'animation',
  },
  {
    nombre: 'fuente mixta sin dato: un `tv` cae en anime',
    item: { kind: 'tv' },
    familias: TODAS,
    esperada: 'anime',
  },
  {
    nombre: 'fuente mixta sin anime: un `tv` cae en animación',
    item: { kind: 'tv' },
    familias: NO_ANIME,
    esperada: 'animation',
  },
  {
    nombre: 'fuente mixta sin dato ni `kind`: cae en anime',
    item: {},
    familias: TODAS,
    esperada: 'anime',
  },
  {
    nombre: 'una fila huérfana —sin proveedor— es anime',
    item: { kind: 'movie' },
    familias: [],
    esperada: 'anime',
  },
]

describe('familyOf: de qué está hecha la obra', () => {
  for (const caso of CASOS_FAMILIA) {
    test(caso.nombre, () => {
      expect(familyOf(caso.item, caso.familias)).toBe(caso.esperada)
    })
  }

  test('una película de anime no cae del lado de la imagen real', () => {
    // Es el caso que motiva la separación de los dos ejes: `kind: 'movie'` en una
    // fuente mixta caía en «Películas», y una película de anime no es eso.
    const pelicula: Clasificable = { family: 'anime', format: 'movie', kind: 'movie' }

    expect(familyOf(pelicula, TODAS)).toBe('anime')
    expect(familyOf(pelicula, NO_ANIME)).toBe('anime')
  })
})

interface CasoFormato {
  readonly nombre: string
  readonly item: Clasificable
  readonly esperado: MediaFormat
}

const CASOS_FORMATO: readonly CasoFormato[] = [
  {
    nombre: 'lo declarado gana sobre `mediaType` y `kind`',
    item: { format: 'movie', mediaType: 'series', kind: 'tv' },
    esperado: 'movie',
  },
  {
    nombre: '`mediaType: movie` es una película',
    item: { mediaType: 'movie', kind: 'tv' },
    esperado: 'movie',
  },
  {
    nombre: '`mediaType: series` es una serie aunque el `kind` diga película',
    item: { mediaType: 'series', kind: 'movie' },
    esperado: 'series',
  },
  {
    nombre: '`mediaType: anime` es una serie sin dato de formato',
    item: { mediaType: 'anime', kind: 'movie' },
    esperado: 'series',
  },
  {
    nombre: 'el manga no tiene formato de vídeo: se lee como serie',
    item: { mediaType: 'manga' },
    esperado: 'series',
  },
  {
    nombre: '`kind: movie` es una película',
    item: { kind: 'movie' },
    esperado: 'movie',
  },
  {
    nombre: 'un OVA es una serie',
    item: { kind: 'ova' },
    esperado: 'series',
  },
  {
    nombre: 'un especial es una serie',
    item: { kind: 'special' },
    esperado: 'series',
  },
  {
    nombre: 'sin nada, una serie: un título sin formato no es una película',
    item: {},
    esperado: 'series',
  },
]

describe('formatOf: cómo está contada la obra', () => {
  for (const caso of CASOS_FORMATO) {
    test(caso.nombre, () => {
      expect(formatOf(caso.item)).toBe(caso.esperado)
    })
  }
})

describe('esDeFamilia: si una familia entra en lo pedido', () => {
  test('sin filtro entran todas; un conjunto vacío no admite ninguna', () => {
    expect(esDeFamilia(undefined, 'anime')).toBe(true)
    expect(esDeFamilia([], 'anime')).toBe(false)
  })

  test('con filtro, decide la pertenencia', () => {
    expect(esDeFamilia(['anime', 'live'], 'live')).toBe(true)
    expect(esDeFamilia(['live'], 'anime')).toBe(false)
  })
})

describe('puedeServirFamilia: si merece la pena preguntar', () => {
  test('sin filtro se pregunta a todos', () => {
    expect(puedeServirFamilia(undefined, SOLO_ANIME)).toBe(true)
  })

  test('basta con que una familia pedida esté entre las que sirve', () => {
    // Una fuente mixta recibe la petición aunque el filtro pida una: el reparto por
    // título se hace después, y descartarla por proveedor dejaría la pestaña vacía.
    expect(puedeServirFamilia(['anime'], TODAS)).toBe(true)
    expect(puedeServirFamilia(['animation', 'live'], NO_ANIME)).toBe(true)
    expect(puedeServirFamilia(['live'], SOLO_ANIME)).toBe(false)
  })
})

describe('pasaElFiltro: familia y formato juntos', () => {
  test('una película de anime pasa Anime con formato Películas y no cae en live', () => {
    // Es el criterio de la propuesta: el formato aísla dentro de la familia, y la
    // familia no se deduce del formato cuando está declarada.
    const pelicula: Clasificable = { family: 'anime', format: 'movie', kind: 'movie' }

    expect(pasaElFiltro({ families: ['anime'], format: 'movie' }, pelicula, TODAS)).toBe(true)
    expect(pasaElFiltro({ families: ['anime'] }, pelicula, TODAS)).toBe(true)
    expect(pasaElFiltro({ families: ['live'] }, pelicula, TODAS)).toBe(false)
    expect(pasaElFiltro({ families: ['anime'], format: 'series' }, pelicula, TODAS)).toBe(false)
  })

  test('una serie de imagen real de una fuente mixta entra en Acción real y no en Anime', () => {
    const serie: Clasificable = { family: 'live', kind: 'tv' }

    expect(pasaElFiltro({ families: ['live'], format: 'series' }, serie, TODAS)).toBe(true)
    expect(pasaElFiltro({ families: ['anime'] }, serie, TODAS)).toBe(false)
    expect(pasaElFiltro({ families: ['live'], format: 'movie' }, serie, TODAS)).toBe(false)
  })

  test('sin familias ni formato pasa todo, salvo el manga', () => {
    const serie: Clasificable = { kind: 'tv' }

    expect(pasaElFiltro({}, serie, SOLO_ANIME)).toBe(true)
    expect(pasaElFiltro({}, { mediaType: 'manga' }, SOLO_ANIME)).toBe(false)
  })

  test('sin dato por título, la compatibilidad reparte por el conjunto y el `kind`', () => {
    // Es la regla que conserva el comportamiento publicado: un `movie` de una
    // fuente mixta cae en imagen real y un `tv` en anime.
    expect(pasaElFiltro({ families: ['live'] }, { kind: 'movie' }, TODAS)).toBe(true)
    expect(pasaElFiltro({ families: ['anime'] }, { kind: 'movie' }, TODAS)).toBe(false)
    expect(pasaElFiltro({ families: ['anime'] }, { kind: 'tv' }, TODAS)).toBe(true)
  })

  test('sin formato pedido, una película de anime sigue pasando', () => {
    // El formato sólo filtra cuando se pide: «Todo» no deja fuera nada.
    const pelicula: Clasificable = { family: 'anime', format: 'movie' }

    expect(pasaElFiltro({ families: ['anime'] }, pelicula, TODAS)).toBe(true)
    expect(pasaElFiltro({ families: ['anime'], format: 'movie' }, pelicula, TODAS)).toBe(true)
  })
})

describe('la mitad vieja sigue como estaba', () => {
  test('un proveedor de películas sirve su mitad, con cualquier `kind`', () => {
    expect(esDeMedia('movies', 'movies', 'tv')).toBe(true)
    expect(esDeMedia('movies', 'movies', 'movie')).toBe(true)
    expect(esDeMedia('anime', 'movies', 'movie')).toBe(false)
  })

  test('un proveedor de anime no entra en la otra mitad, ni con una película', () => {
    expect(esDeMedia('anime', 'anime', 'movie')).toBe(true)
    expect(esDeMedia('movies', 'anime', 'movie')).toBe(false)
  })

  test('una fuente de las dos cosas reparte por el `kind`', () => {
    expect(esDeMedia('movies', 'both', 'movie')).toBe(true)
    expect(esDeMedia('movies', 'both', 'tv')).toBe(false)
    expect(esDeMedia('anime', 'both', 'tv')).toBe(true)
    expect(esDeMedia('anime', 'both', undefined)).toBe(true)
  })

  test('mediaTypeOf: lo que declara la fuente gana sobre lo que se deduciría', () => {
    expect(mediaTypeOf({ kind: 'tv', mediaType: 'series' }, 'both')).toBe('series')
    expect(mediaTypeOf({ kind: 'movie' }, 'movies')).toBe('movie')
    expect(mediaTypeOf({ kind: 'tv' }, 'both')).toBe('anime')
    expect(mediaTypeOf({ kind: 'movie' }, 'anime')).toBe('anime')
  })

  test('el filtro viejo: sin filtro pasa todo, y también con `both`', () => {
    expect(pasaElFiltroDeMedia(undefined, 'anime', 'tv')).toBe(true)
    expect(pasaElFiltroDeMedia(undefined, 'movies', 'tv')).toBe(true)
    expect(pasaElFiltroDeMedia('both', 'movies', 'tv')).toBe(true)
  })

  test('el filtro viejo decide con la misma regla que la pestaña', () => {
    expect(pasaElFiltroDeMedia('movies', 'both', 'movie')).toBe(true)
    expect(pasaElFiltroDeMedia('movies', 'both', 'tv')).toBe(false)
    expect(pasaElFiltroDeMedia('movies', 'anime', 'movie')).toBe(false)
    expect(pasaElFiltroDeMedia('anime', 'movies', 'tv')).toBe(false)
  })

  test('una serie declarada entra en películas aunque su `kind` sea `tv`', () => {
    expect(pasaElFiltroDeMedia('movies', 'both', 'tv', 'series')).toBe(true)
    expect(pasaElFiltroDeMedia('anime', 'both', 'tv', 'series')).toBe(false)
  })

  test('puedeServir: la fuente mixta recibe las dos peticiones', () => {
    expect(puedeServir(undefined, 'anime')).toBe(true)
    expect(puedeServir('both', 'anime')).toBe(true)
    expect(puedeServir('movies', 'both')).toBe(true)
    expect(puedeServir('anime', 'movies')).toBe(false)
  })
})
