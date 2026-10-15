/**
 * La normalización de lo que publica AniList.
 *
 * Se mide con las formas reales de la API: los nulos, las etiquetas de la
 * sinopsis, la portada en dos tamaños, la fecha en Unix. Y con los dos casos que
 * deciden si una obra entra o no: una portada que no es de su CDN y un nombre que
 * no está.
 */

import { describe, expect, test } from 'bun:test'
import {
  isAniListImageUrl,
  isoOf,
  mediaAliasSchema,
  mediaOfAlias,
  mediaSchema,
  relationsSchema,
  toAiringEntry,
  toEntry,
  toRelatedEntries,
} from './entries'

const CRUDA = {
  id: 101922,
  title: {
    romaji: 'Kimetsu no Yaiba',
    english: 'Demon Slayer: Kimetsu no Yaiba',
    native: '鬼滅の刃',
  },
  synonyms: ['Kimetsu no Yaiba TV'],
  format: 'TV',
  status: 'FINISHED',
  isAdult: false,
  startDate: { year: 2019, month: 4, day: 6 },
  episodes: 26,
  duration: 23,
  averageScore: 84,
  description: 'Tanjiro ve su vida <i>destrozada</i><br>por los demonios &amp; compañía.',
  genres: ['Action', 'Adventure'],
  studios: { nodes: [{ name: 'ufotable' }, { name: ' Aniplex ' }] },
  coverImage: {
    extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101922-x.jpg',
    large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx101922-x.jpg',
  },
  bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/101922.jpg',
  siteUrl: 'https://anilist.co/anime/101922',
  nextAiringEpisode: { episode: 27, airingAt: 1_760_000_000 },
}

/** Pasa la obra cruda por el schema, como hace el cliente al validar. */
function normalizar(overrides: Record<string, unknown> = {}) {
  const cruda = mediaSchema.parse({ ...CRUDA, ...overrides })

  return toEntry(cruda)
}

describe('una obra de AniList', () => {
  test('se traduce con sus nombres, su nota y su sinopsis sin etiquetas', () => {
    const entrada = normalizar()
    expect(entrada).toBeDefined()
    expect(entrada?.id).toBe(101922)
    expect(entrada?.names.romaji).toBe('Kimetsu no Yaiba')
    expect(entrada?.names.english).toBe('Demon Slayer: Kimetsu no Yaiba')
    expect(entrada?.names.synonyms).toEqual(['Kimetsu no Yaiba TV'])
    expect(entrada?.status).toBe('finished')
    expect(entrada?.year).toBe(2019)
    expect(entrada?.episodes).toBe(26)
    expect(entrada?.durationMin).toBe(23)
    expect(entrada?.score).toBe(84)
    expect(entrada?.synopsis).toBe('Tanjiro ve su vida destrozada por los demonios & compañía.')
    expect(entrada?.studios).toEqual(['ufotable', 'Aniplex'])
    expect(entrada?.nextEpisode).toEqual({
      number: 27,
      airingAt: isoOf(1_760_000_000),
    })
  })

  test('la marca de adultos de la API llega a la entrada, sin valor por defecto', () => {
    expect(normalizar({ isAdult: true })?.adult).toBe(true)
    expect(normalizar()?.adult).toBe(false)
  })

  test('una obra cruda sin `isAdult` no se valida: se descarta en vez de darse por apta', () => {
    const { isAdult: _sinMarca, ...sinMarca } = CRUDA

    expect(mediaSchema.safeParse(sinMarca).success).toBe(false)
  })

  test('el nativo no se repite como nombre si es el principal', () => {
    const entrada = normalizar({ title: { romaji: null, english: null, native: '鬼滅の刃' } })

    expect(entrada?.names.romaji).toBe('鬼滅の刃')
    expect(entrada?.names.native).toBeUndefined()
  })

  test('sin ningún nombre no hay obra que pintar', () => {
    expect(normalizar({ title: null })).toBeUndefined()
    expect(normalizar({ title: { romaji: '  ', english: null, native: null } })).toBeUndefined()
  })

  test('sin una portada de su CDN tampoco: la ruta no sabría resolverla', () => {
    expect(
      normalizar({
        coverImage: { extraLarge: 'https://ejemplo.invalid/portada.jpg', large: null },
      }),
    ).toBeUndefined()
  })

  test('un banner de otro host se cae y la obra se queda sin banner', () => {
    const entrada = normalizar({ bannerImage: 'https://ejemplo.invalid/banner.jpg' })

    expect(entrada).toBeDefined()
    expect(entrada?.bannerUrl).toBeUndefined()
  })

  test('una ficha que no es de anilist.co deja la obra fuera', () => {
    expect(normalizar({ siteUrl: 'https://ejemplo.invalid/anime/1' })).toBeUndefined()
  })

  test('lo que no viene se omite en vez de inventarse', () => {
    const entrada = normalizar({
      averageScore: null,
      duration: null,
      episodes: null,
      genres: null,
      studios: null,
      nextAiringEpisode: null,
      description: null,
    })

    expect(entrada).toBeDefined()
    expect(entrada?.score).toBeUndefined()
    expect(entrada?.durationMin).toBeUndefined()
    expect(entrada?.episodes).toBeUndefined()
    expect(entrada?.genres).toEqual([])
    expect(entrada?.studios).toEqual([])
    expect(entrada?.synopsis).toBeUndefined()
    expect(entrada?.nextEpisode).toBeUndefined()
  })
})

describe('la fecha de emisión', () => {
  test('el mes y el día no se pierden al validar: una película estrenada los trae', () => {
    // El caso medido en vivo: la API devuelve `{year, month, day}` y zod descarta
    // lo que el schema no declara, así que sin los tres campos la fecha se quedaba
    // en el año y los estrenos no se podían colocar en un día.
    const conDia = mediaSchema.parse({ ...CRUDA, startDate: { year: 2026, month: 10, day: 9 } })

    expect(conDia.startDate).toEqual({ year: 2026, month: 10, day: 9 })
  })
})

describe('un capítulo de la parrilla', () => {
  test('llega con su obra y su fecha en ISO', () => {
    const cita = toAiringEntry({
      episode: 12,
      airingAt: 1_760_000_000,
      media: mediaSchema.parse(CRUDA),
    })

    expect(cita?.episode).toBe(12)
    expect(cita?.airingAt).toBe(isoOf(1_760_000_000))
    expect(cita?.media.id).toBe(101922)
  })

  test('sin obra dentro no hay cita', () => {
    expect(toAiringEntry({ episode: 12, airingAt: 1_760_000_000 })).toBeUndefined()
  })
})

describe('las direcciones de imagen', () => {
  test('sólo la CDN de AniList pasa', () => {
    expect(isAniListImageUrl('https://s4.anilist.co/file/x.jpg')).toBe(true)
    expect(isAniListImageUrl('https://img.anilist.co/x.jpg')).toBe(true)
    expect(isAniListImageUrl('https://ejemplo.invalid/x.jpg')).toBe(false)
    expect(isAniListImageUrl('http://s4.anilist.co/x.jpg')).toBe(false)
    expect(isAniListImageUrl('javascript:alert(1)')).toBe(false)
  })
})

describe('la página de un alias', () => {
  test('AniList la aplana, y las dos formas se leen igual', () => {
    // La forma medida contra la API: sin el envoltorio `Page`.
    const aplanada = mediaAliasSchema.parse({ media: [CRUDA] })
    const envuelta = mediaAliasSchema.parse({ Page: { media: [CRUDA] } })

    expect(mediaOfAlias(aplanada)).toHaveLength(1)
    expect(mediaOfAlias(envuelta)).toHaveLength(1)
    expect(mediaOfAlias({})).toEqual([])
  })
})

/** Un nodo de una arista, con lo que la prueba quiera cambiar. */
function nodo(overrides: Record<string, unknown> = {}) {
  return { ...CRUDA, ...overrides }
}

/** Las aristas tal y como las valida el cliente. */
function aristas(...edges: readonly Record<string, unknown>[]) {
  return relationsSchema.parse({ Media: { relations: { edges } } })
}

describe('las relaciones de una obra', () => {
  test('se queda con la secuela y tira el manga de origen y el crossover', () => {
    // Los tres casos son los que devolvió la API para «Kimetsu no Yaiba»: el
    // manga (`SOURCE`, `format: MANGA`), la película (`SEQUEL`) y los cortos de
    // gag (`CHARACTER`). Sólo el segundo es una entrega que encadenar.
    const relaciones = toRelatedEntries(
      aristas(
        { relationType: 'SOURCE', node: nodo({ id: 87216, format: 'MANGA' }) },
        {
          relationType: 'SEQUEL',
          node: nodo({
            id: 112151,
            format: 'MOVIE',
            title: { romaji: 'Mugen Ressha-hen', english: null, native: null },
          }),
        },
        { relationType: 'CHARACTER', node: nodo({ id: 129627, format: 'ONA' }) },
      ),
    )

    expect(relaciones.map((una) => una.media.id)).toEqual([112151])
    expect(relaciones[0]?.relation).toBe('sequel')
    expect(relaciones[0]?.media.names.romaji).toBe('Mugen Ressha-hen')
  })

  test('una relación que apunta a una novela o a un manga no es una entrega que ver', () => {
    // Es la red que queda **bajo** la lista blanca: el manga de origen se cae por
    // `SOURCE`, pero AniList publica relaciones que sí se leen —`SIDE_STORY`,
    // `SUMMARY`— apuntando a una novela ligera o a un tomo. Sin el filtro de
    // formato, la ficha ofrece una obra que no está en ninguna fuente de anime.
    const relaciones = toRelatedEntries(
      aristas(
        { relationType: 'SIDE_STORY', node: nodo({ id: 700, format: 'NOVEL' }) },
        { relationType: 'SUMMARY', node: nodo({ id: 701, format: 'MANGA' }) },
      ),
    )

    expect(relaciones).toEqual([])
  })

  test('una obra que viene en dos aristas sale una vez, con la primera', () => {
    // AniList publica la misma entrega como precuela de una y secuela de otra.
    // Sin el mapa por id, la ficha pinta dos veces la misma obra.
    const relaciones = toRelatedEntries(
      aristas(
        { relationType: 'PREQUEL', node: nodo({ id: 112151 }) },
        { relationType: 'SEQUEL', node: nodo({ id: 112151 }) },
      ),
    )

    expect(relaciones).toHaveLength(1)
    expect(relaciones[0]?.relation).toBe('prequel')
  })

  test('sin portada de su CDN no hay pieza que pintar, y la relación se cae', () => {
    const relaciones = toRelatedEntries(
      aristas({
        relationType: 'SEQUEL',
        node: nodo({
          id: 112151,
          coverImage: { extraLarge: 'https://ejemplo.invalid/portada.jpg', large: null },
        }),
      }),
    )

    expect(relaciones).toEqual([])
  })

  test('un tipo que no se sabe leer no se enseña', () => {
    // Un tipo nuevo de AniList no puede llegar a la ficha por el hecho de ser
    // nuevo: la lista es cerrada y esto es lo que la cierra.
    const relaciones = toRelatedEntries(
      aristas({ relationType: 'CROSSOVER_NUEVO', node: nodo({ id: 112151 }) }),
    )

    expect(relaciones).toEqual([])
  })

  test('sin relaciones, o con la obra fuera, la lista viene vacía y no revienta', () => {
    expect(toRelatedEntries(relationsSchema.parse({ Media: { relations: null } }))).toEqual([])
    expect(toRelatedEntries(relationsSchema.parse({ Media: {} }))).toEqual([])
    expect(toRelatedEntries(aristas({ relationType: 'SEQUEL' }))).toEqual([])
  })
})
