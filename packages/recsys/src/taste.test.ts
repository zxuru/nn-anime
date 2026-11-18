import { describe, expect, test } from 'bun:test'
import type { Candidate } from '@rona/core'
import { buildIdfIndex } from './affinity'
import {
  audioMatch,
  catalogMatch,
  declaredGenreOf,
  declaredScore,
  declaredShare,
  declaredVector,
  formatMatch,
  hasTasteSignals,
  LONG_SERIES_MIN_EPISODES,
  likedTitleOf,
  passesTaste,
  SHORT_SERIES_MAX_EPISODES,
  TASTE_MIN_DECLARED_SHARE,
  type TasteSignals,
  tastePreferenceScore,
  toneMatch,
  toneOf,
} from './taste'

function candidato(
  titulo: string,
  tags: readonly string[],
  extra: Partial<Candidate> = {},
): Candidate {
  return {
    ref: { providerId: 'fixture', value: titulo },
    title: titulo,
    tags: [...tags],
    studios: [],
    ...extra,
  }
}

function gusto(extra: Partial<TasteSignals> = {}): TasteSignals {
  return {
    genres: [{ name: 'Acción', weight: 1 }],
    excludedGenres: [],
    liked: [],
    behaviorEvents: 0,
    ...extra,
  }
}

const CORPUS = [
  candidato('Mecha uno', ['Acción', 'Mecha'], { popularity: 0.4 }),
  candidato('Mecha dos', ['Acción'], { popularity: 0.3 }),
  candidato('Romance', ['Romance'], { popularity: 0.5 }),
  candidato('Terror', ['Terror', 'Acción'], { popularity: 0.2 }),
]

const IDF = buildIdfIndex(CORPUS)

describe('la cuota de lo declarado', () => {
  test('sin comportamiento manda la encuesta entera', () => {
    expect(declaredShare(0)).toBe(1)
  })

  test('cada visionado quita su parte, de forma lineal', () => {
    expect(declaredShare(5)).toBeCloseTo(0.75, 6)
    expect(declaredShare(10)).toBeCloseTo(0.5, 6)
  })

  test('nunca se queda en cero: la declaración no se borra', () => {
    expect(declaredShare(20)).toBe(TASTE_MIN_DECLARED_SHARE)
    expect(declaredShare(5_000)).toBe(TASTE_MIN_DECLARED_SHARE)
  })

  test('un dato imposible se trata como cero y no como cuota negativa', () => {
    expect(declaredShare(-3)).toBe(1)
    expect(declaredShare(Number.NaN)).toBe(1)
    // Un `replacementAt` imposible se acota a uno: diez visionados ya lo agotan.
    expect(declaredShare(10, 0)).toBe(TASTE_MIN_DECLARED_SHARE)
  })
})

describe('los géneros excluidos', () => {
  test('excluyen aunque el título también tenga un género preferido', () => {
    const conExclusion = gusto({ excludedGenres: ['terror'] })

    expect(passesTaste(CORPUS[3] as Candidate, conExclusion)).toBe(false)
    expect(passesTaste(CORPUS[0] as Candidate, conExclusion)).toBe(true)
  })

  test('la comparación no depende de mayúsculas ni tildes', () => {
    expect(passesTaste(CORPUS[3] as Candidate, gusto({ excludedGenres: ['TERROR'] }))).toBe(false)
    expect(
      passesTaste(candidato('Uno', ['Psicológico']), gusto({ excludedGenres: ['psicologico'] })),
    ).toBe(false)
  })

  test('sin exclusiones todo pasa', () => {
    expect(passesTaste(CORPUS[3] as Candidate, undefined)).toBe(true)
    expect(passesTaste(CORPUS[3] as Candidate, gusto())).toBe(true)
  })
})

describe('el vector declarado', () => {
  test('los títulos marcados acercan las obras que comparten sus géneros', () => {
    const conTitulo = gusto({ genres: [], liked: [candidato('Frieren', ['Fantasía', 'Aventura'])] })
    const parecido = candidato('Viaje', ['Fantasía', 'Aventura'])
    const lejano = candidato('Oficina', ['Comedia'])

    const vector = declaredVector(conTitulo, [...CORPUS, parecido, lejano], IDF)

    const cercano = declaredScore(parecido, conTitulo, [...CORPUS, parecido, lejano], IDF, 1)
    const otro = declaredScore(lejano, conTitulo, [...CORPUS, parecido, lejano], IDF, 1)

    expect(vector.norm).toBe(1)
    expect(cercano).toBeGreaterThan(otro)
  })

  test('un género elegido puntúa a quien lo lleva y no a quien no', () => {
    const puntuacion = (candidate: Candidate): number =>
      declaredScore(candidate, gusto(), CORPUS, IDF, 1)

    expect(puntuacion(CORPUS[0] as Candidate)).toBeGreaterThan(puntuacion(CORPUS[2] as Candidate))
  })

  test('sin gustos no hay vector y la puntuación es cero', () => {
    expect(declaredVector(undefined, CORPUS, IDF).norm).toBe(0)
    expect(declaredScore(CORPUS[0] as Candidate, undefined, CORPUS, IDF, 1)).toBe(0)
  })
})

describe('el formato y el tono', () => {
  test('película se prefiere con película y una serie no lo es', () => {
    const pelicula = candidato('Película', [], { format: 'movie' })
    const serie = candidato('Serie', [], { format: 'series', episodeCount: 24 })

    expect(formatMatch(pelicula, gusto({ format: 'movies' }))).toBe(1)
    expect(formatMatch(serie, gusto({ format: 'movies' }))).toBe(0)
    expect(formatMatch(pelicula, gusto({ format: 'short-series' }))).toBe(0)
  })

  test('con episodios, larga y corta se distinguen de verdad', () => {
    const larga = candidato('Larga', [], {
      format: 'series',
      episodeCount: LONG_SERIES_MIN_EPISODES,
    })
    const corta = candidato('Corta', [], {
      format: 'series',
      episodeCount: SHORT_SERIES_MAX_EPISODES,
    })
    const media = candidato('Media', [], { format: 'series', episodeCount: 18 })

    expect(formatMatch(larga, gusto({ format: 'long-series' }))).toBe(1)
    expect(formatMatch(larga, gusto({ format: 'short-series' }))).toBe(0)
    expect(formatMatch(corta, gusto({ format: 'short-series' }))).toBe(1)
    expect(formatMatch(corta, gusto({ format: 'long-series' }))).toBe(0)
    expect(formatMatch(media, gusto({ format: 'long-series' }))).toBe(0)
    expect(formatMatch(media, gusto({ format: 'short-series' }))).toBe(0)
  })

  test('sin número de episodios, la respuesta es la mitad y no una suposición', () => {
    const sinDato = candidato('Sin dato', [], { format: 'series' })

    expect(formatMatch(sinDato, gusto({ format: 'long-series' }))).toBe(0.5)
    expect(formatMatch(sinDato, gusto({ format: 'short-series' }))).toBe(0.5)
  })

  test('sin formato elegido no hay opinión', () => {
    expect(formatMatch(CORPUS[0] as Candidate, gusto())).toBeUndefined()
  })

  test('el tono se deduce de los géneros y se compara con el elegido', () => {
    expect(toneOf(['Terror', 'Misterio'])).toBe('dark')
    expect(toneOf(['Comedia', 'Recuentos de la vida'])).toBe('light')
    expect(toneOf(['Drama', 'Romance'])).toBe('emotional')
    expect(toneOf(['Mecha'])).toBeUndefined()

    expect(toneMatch(candidato('Uno', ['Terror']), gusto({ tone: 'dark' }))).toBe(1)
    expect(toneMatch(candidato('Uno', ['Comedia']), gusto({ tone: 'dark' }))).toBe(0)
    // Un título sin tono deducible no se penaliza entero: simplemente no confirma.
    expect(toneMatch(candidato('Uno', ['Mecha']), gusto({ tone: 'dark' }))).toBe(0.5)
  })

  test('la preferencia combina formato y tono y no depende del género', () => {
    const peliculaOscura = candidato('Una', ['Terror'], { format: 'movie' })
    const serieOscura = candidato('Otra', ['Terror'], {
      format: 'series',
      episodeCount: 24,
    })
    const preferencia = gusto({ genres: [], format: 'movies', tone: 'dark' })

    expect(tastePreferenceScore(peliculaOscura, preferencia)).toBe(1)
    expect(tastePreferenceScore(serieOscura, preferencia)).toBe(0.5)
    expect(tastePreferenceScore(CORPUS[0] as Candidate, gusto())).toBe(0)
  })

  test('el catálogo prefiere lo que sigue emitiéndose o lo que ya cerró', () => {
    const enEmision = candidato('En emisión', [], { status: 'airing' })
    const terminado = candidato('Terminado', [], { status: 'finished' })
    const sinDato = candidato('Sin dato', [])

    expect(catalogMatch(enEmision, gusto({ catalog: 'airing' }))).toBe(1)
    expect(catalogMatch(terminado, gusto({ catalog: 'airing' }))).toBe(0)
    expect(catalogMatch(terminado, gusto({ catalog: 'classic' }))).toBe(1)
    expect(catalogMatch(enEmision, gusto({ catalog: 'classic' }))).toBe(0)
    expect(catalogMatch(sinDato, gusto({ catalog: 'classic' }))).toBe(0.5)
    expect(catalogMatch(sinDato, gusto({ catalog: 'either' }))).toBe(1)
    expect(catalogMatch(terminado, gusto())).toBeUndefined()
  })

  test('el idioma mira lo que declara la fuente, no el título', () => {
    const fuentes = new Map([
      ['con-dub', { sub: true, dub: true }],
      ['solo-sub', { sub: true, dub: false }],
    ])
    const conDoblaje = candidato('Uno', [], { ref: { providerId: 'con-dub', value: 'uno' } })
    const sinDoblaje = candidato('Dos', [], { ref: { providerId: 'solo-sub', value: 'dos' } })
    const ajeno = candidato('Tres', [], { ref: { providerId: 'otro', value: 'tres' } })
    const dub = gusto({ genres: [], audio: 'dub', audioByProvider: fuentes })

    expect(audioMatch(conDoblaje, dub)).toBe(1)
    expect(audioMatch(sinDoblaje, dub)).toBe(0)
    // Una fuente que no está en la tabla no consta: no se castiga.
    expect(audioMatch(ajeno, dub)).toBe(0.5)
    expect(audioMatch(conDoblaje, gusto({ genres: [], audio: 'either' }))).toBeUndefined()
  })
})

describe('las señales declaradas', () => {
  test('hay gustos si hay cualquier respuesta, aunque no haya géneros', () => {
    expect(hasTasteSignals(undefined)).toBe(false)
    expect(hasTasteSignals(gusto({ genres: [] }))).toBe(false)
    expect(hasTasteSignals(gusto({ genres: [], format: 'movies' }))).toBe(true)
    expect(hasTasteSignals(gusto({ genres: [], excludedGenres: ['Terror'] }))).toBe(true)
    expect(hasTasteSignals(gusto({ genres: [], audio: 'dub' }))).toBe(true)
    expect(hasTasteSignals(gusto({ genres: [], catalog: 'classic' }))).toBe(true)
  })

  test('el género se explica con el nombre del catálogo', () => {
    expect(declaredGenreOf(gusto(), CORPUS[0] as Candidate)).toBe('Acción')
    expect(declaredGenreOf(gusto(), CORPUS[2] as Candidate)).toBeUndefined()
  })

  test('el título parecido gana el que más géneros comparte', () => {
    const perfil = gusto({
      genres: [],
      liked: [
        candidato('Mecha viejo', ['Acción', 'Mecha']),
        candidato('Romance viejo', ['Romance']),
      ],
    })

    expect(likedTitleOf(perfil, CORPUS[0] as Candidate)?.title).toBe('Mecha viejo')
    expect(likedTitleOf(perfil, CORPUS[2] as Candidate)?.title).toBe('Romance viejo')
    expect(likedTitleOf(perfil, candidato('Otro', ['Oficina']))).toBeUndefined()
  })
})
