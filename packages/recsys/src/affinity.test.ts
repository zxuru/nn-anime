import { describe, expect, test } from 'bun:test'
import type { Candidate } from '@nn-anime/core'
import {
  affinityScore,
  buildAffinity,
  candidateFeatures,
  candidateVector,
  cosine,
  decay,
  EMPTY_VECTOR,
  eventWeight,
  HALF_LIFE_DAYS,
  idf,
  normalize,
  STUDIO_BONUS,
  sharedStudios,
  studioKey,
  tagKey,
  yearKey,
} from './affinity'

const AHORA = new Date('2026-01-31T00:00:00Z')
const DIA = 86_400_000

function candidato(
  titulo: string,
  tags: readonly string[],
  studios: readonly string[] = ['Estudio A'],
  year?: number,
): Candidate {
  return {
    ref: { providerId: 'fixture', value: titulo },
    title: titulo,
    tags: [...tags],
    studios: [...studios],
    ...(year === undefined ? {} : { year }),
  }
}

function evento(
  tags: readonly string[],
  opciones: {
    readonly dias?: number
    readonly completion?: number
    readonly studios?: readonly string[]
  } = {},
) {
  return {
    tags: [...tags],
    studios: [...(opciones.studios ?? ['Estudio A'])],
    at: new Date(AHORA.getTime() - (opciones.dias ?? 0) * DIA),
    completion: opciones.completion ?? 1,
  }
}

describe('decaimiento temporal', () => {
  test('la semivida es la del spec', () => {
    expect(HALF_LIFE_DAYS).toBe(30)
  })

  test('a la semivida queda la mitad; a dos, un cuarto', () => {
    expect(decay(new Date(AHORA.getTime() - 30 * DIA), AHORA)).toBeCloseTo(0.5, 10)
    expect(decay(new Date(AHORA.getTime() - 60 * DIA), AHORA)).toBeCloseTo(0.25, 10)
  })

  test('lo de hoy pesa entero', () => {
    expect(decay(AHORA, AHORA)).toBe(1)
  })

  test('un evento futuro no pesa más que uno de ahora', () => {
    expect(decay(new Date(AHORA.getTime() + 5 * DIA), AHORA)).toBe(1)
  })

  test('la completitud multiplica', () => {
    expect(eventWeight(evento(['x'], { completion: 0.5 }), AHORA)).toBeCloseTo(0.5, 10)
    expect(eventWeight(evento(['x'], { dias: 30, completion: 0.5 }), AHORA)).toBeCloseTo(0.25, 10)
  })

  test('una completitud fuera de rango se recorta', () => {
    expect(eventWeight(evento(['x'], { completion: 5 }), AHORA)).toBe(1)
    expect(eventWeight(evento(['x'], { completion: -1 }), AHORA)).toBe(0)
  })
})

describe('IDF sobre el corpus', () => {
  const corpus = [
    candidato('uno', ['accion', 'raro']),
    candidato('dos', ['accion']),
    candidato('tres', ['accion']),
    candidato('cuatro', ['accion']),
  ]

  test('un tag en el 80 % pesa menos que uno en el 25 %', () => {
    const comun = idf(corpus, tagKey('accion'))
    const raro = idf(corpus, tagKey('raro'))

    expect(raro).toBeGreaterThan(comun)
  })

  test('nunca es cero: una característica común sigue contando algo', () => {
    const corpusIgual = [candidato('a', ['x']), candidato('b', ['x'])]

    expect(idf(corpusIgual, tagKey('x'))).toBeGreaterThan(0)
  })

  test('una característica que no está en el corpus tiene el IDF más alto', () => {
    expect(idf(corpus, tagKey('inventado'))).toBeGreaterThan(idf(corpus, tagKey('raro')))
  })

  test('sin corpus, el IDF es neutro', () => {
    expect(idf([], tagKey('x'))).toBe(1)
  })

  test('el estudio y el año también son características', () => {
    const conEstudio = [candidato('a', ['x'], ['Estudio A']), candidato('b', ['x'], ['Estudio B'])]

    expect(idf(conEstudio, studioKey('Estudio A'))).toBeGreaterThan(0)
    expect(idf(conEstudio, yearKey(2019))).toBe(idf(conEstudio, yearKey(2020)))
  })
})

describe('vector de afinidad', () => {
  test('suma los pesos de los eventos por característica', () => {
    // Sin estudios a propósito: el estudio también es una característica y
    // entraría en la norma. Se aísla lo que se está midiendo.
    const afinidad = buildAffinity(
      [evento(['accion'], { studios: [] }), evento(['accion', 'raro'], { studios: [] })],
      AHORA,
    )

    // Sin corpus no hay IDF: los pesos son los del decaimiento, normalizados.
    expect(afinidad.weights.get(tagKey('accion'))).toBeCloseTo(2 / Math.sqrt(5), 6)
    expect(afinidad.weights.get(tagKey('raro'))).toBeCloseTo(1 / Math.sqrt(5), 6)
    expect(afinidad.norm).toBe(1)
  })

  test('un evento repetido en el mismo visionado no cuenta dos veces por tag', () => {
    const afinidad = buildAffinity([evento(['accion', 'accion'], { studios: [] })], AHORA)

    expect(afinidad.weights.get(tagKey('accion'))).toBeCloseTo(1, 6)
  })

  test('lo viejo pesa menos que lo nuevo', () => {
    const reciente = buildAffinity([evento(['nuevo'], { studios: [] })], AHORA)
    const viejo = buildAffinity([evento(['antiguo'], { dias: 90, studios: [] })], AHORA)

    expect(reciente.weights.get(tagKey('nuevo'))).toBeCloseTo(1, 6)
    expect(viejo.weights.get(tagKey('antiguo'))).toBeCloseTo(1, 6)
    // Normalizados los dos, la diferencia se ve en el IDF: aquí se compara el
    // peso crudo de cada uno con su decaimiento.
    expect(decay(new Date(AHORA.getTime() - 90 * DIA), AHORA)).toBeLessThan(0.2)
  })

  test('con corpus, el tag raro pesa más que el común', () => {
    const corpus = [
      candidato('uno', ['accion', 'raro']),
      candidato('dos', ['accion']),
      candidato('tres', ['accion']),
    ]
    const afinidad = buildAffinity([evento(['accion']), evento(['raro'])], AHORA, { corpus })

    const comun = afinidad.weights.get(tagKey('accion')) ?? 0
    const raro = afinidad.weights.get(tagKey('raro')) ?? 0

    expect(raro).toBeGreaterThan(comun)
  })

  test('sin eventos no hay vector', () => {
    expect(buildAffinity([], AHORA)).toEqual(EMPTY_VECTOR)
  })

  test('un evento con completitud cero no aporta nada', () => {
    expect(buildAffinity([evento(['x'], { completion: 0 })], AHORA)).toEqual(EMPTY_VECTOR)
  })

  test('el año entra como característica', () => {
    const afinidad = buildAffinity(
      [{ tags: ['x'], studios: [], year: 2019, at: AHORA, completion: 1 }],
      AHORA,
    )

    expect(afinidad.weights.has(yearKey(2019))).toBe(true)
  })
})

describe('normalización', () => {
  test('deja el vector con norma uno', () => {
    const normalizado = normalize(
      new Map([
        ['a', 3],
        ['b', 4],
      ]),
    )

    expect(normalizado.norm).toBe(1)
    expect(normalizado.weights.get('a')).toBeCloseTo(0.6, 10)
    expect(normalizado.weights.get('b')).toBeCloseTo(0.8, 10)
  })

  test('un vector de ceros no divide por cero', () => {
    expect(normalize(new Map([['a', 0]]))).toEqual(EMPTY_VECTOR)
    expect(normalize(new Map())).toEqual(EMPTY_VECTOR)
  })
})

describe('coseno', () => {
  test('dos vectores iguales dan uno', () => {
    const uno = buildAffinity([evento(['accion', 'raro'])], AHORA)

    expect(cosine(uno, uno)).toBeCloseTo(1, 10)
  })

  test('vectores sin nada en común dan cero', () => {
    // Con el mismo estudio por defecto sí tendrían algo en común: el estudio.
    const uno = buildAffinity([evento(['accion'], { studios: [] })], AHORA)
    const otro = buildAffinity([evento(['romance'], { studios: [] })], AHORA)

    expect(cosine(uno, otro)).toBe(0)
  })

  test('un vector vacío da cero, no `NaN`', () => {
    expect(cosine(EMPTY_VECTOR, EMPTY_VECTOR)).toBe(0)
    expect(cosine(buildAffinity([evento(['x'])], AHORA), EMPTY_VECTOR)).toBe(0)
    expect(Number.isNaN(cosine(EMPTY_VECTOR, EMPTY_VECTOR))).toBe(false)
  })

  test('la magnitud no importa: cien episodios no cambian la dirección', () => {
    const pocos = buildAffinity([evento(['accion', 'raro'])], AHORA)
    const muchos = buildAffinity(
      [evento(['accion', 'raro']), evento(['accion', 'raro']), evento(['accion', 'raro'])],
      AHORA,
    )

    expect(cosine(pocos, muchos)).toBeCloseTo(1, 10)
  })
})

describe('puntuación de un candidato', () => {
  const corpus = [
    candidato('uno', ['accion']),
    candidato('dos', ['romance']),
    candidato('tres', ['accion']),
  ]

  test('el candidato que comparte tags puntúa más que el que no', () => {
    const afinidad = buildAffinity([evento(['accion'], { studios: [] })], AHORA, { corpus })

    const parecido = affinityScore(afinidad, candidato('cuatro', ['accion'], []), corpus)
    const distinto = affinityScore(afinidad, candidato('cinco', ['romance'], []), corpus)

    expect(parecido).toBeGreaterThan(distinto)
  })

  test('el bonus por estudio es el del spec y se suma por cada uno', () => {
    expect(STUDIO_BONUS).toBe(0.1)

    const afinidad = buildAffinity([evento(['x'], { studios: ['Estudio A'] })], AHORA)
    const conDos = candidato('seis', ['nada'], ['Estudio A', 'Estudio B'])

    expect(sharedStudios(afinidad, conDos)).toBe(1)
    expect(sharedStudios(afinidad, candidato('siete', ['nada'], ['Estudio C']))).toBe(0)
  })

  test('un estudio compartido suma exactamente el bonus', () => {
    // El estudio es una característica **y** un bonus, así que para medir el
    // bonus hay que dejar el coseno en un valor conocido: si la afinidad y el
    // candidato tienen ese único estudio, el coseno es 1 y lo que sobra es el
    // bonus. La mutación que lo quitaba sobrevivía sin esta prueba.
    const afinidad = buildAffinity([evento([], { studios: ['Estudio A'] })], AHORA)
    const candidatoUno = candidato('once', [], ['Estudio A'])

    expect(cosine(afinidad, candidateVector(candidatoUno, corpus))).toBeCloseTo(1, 10)
    expect(affinityScore(afinidad, candidatoUno, corpus)).toBeCloseTo(1 + STUDIO_BONUS, 10)
  })

  test('dos estudios compartidos suman el doble de bonus', () => {
    // El corpus tiene que ser el mismo con el que se puntúa: con IDF distinto, la
    // afinidad y el candidato viven en espacios distintos y el coseno baja sin
    // que nada avise. Lo encontró esta prueba.
    const afinidad = buildAffinity([evento([], { studios: ['Estudio A', 'Estudio B'] })], AHORA, {
      corpus,
    })
    const candidatoDoble = candidato('doce', [], ['Estudio A', 'Estudio B'])

    // El coseno sigue siendo 1 —los dos vectores son el mismo conjunto de
    // estudios— y el bonus se suma dos veces.
    expect(affinityScore(afinidad, candidatoDoble, corpus)).toBeCloseTo(1 + STUDIO_BONUS * 2, 10)
  })

  test('sin afinidad, la puntuación es sólo el bonus y no revienta', () => {
    const puntuacion = affinityScore(EMPTY_VECTOR, candidato('ocho', ['x']), corpus)

    expect(puntuacion).toBe(0)
    expect(Number.isNaN(puntuacion)).toBe(false)
  })

  test('el bonus no puede imponerse a un parecido real', () => {
    const afinidad = buildAffinity([evento(['accion'], { studios: [] })], AHORA, { corpus })
    const sinEstudio = affinityScore(afinidad, candidato('nueve', ['accion'], []), corpus)
    const conUnEstudioAjeno = affinityScore(
      afinidad,
      candidato('diez', ['romance'], ['Estudio A']),
      corpus,
    )

    expect(sinEstudio).toBeGreaterThan(conUnEstudioAjeno)
  })
})

describe('características de un candidato', () => {
  test('tags, estudios y año, sin repetir', () => {
    expect(candidateFeatures(candidato('uno', ['a', 'a'], ['E'], 2019))).toEqual([
      tagKey('a'),
      studioKey('E'),
      yearKey(2019),
    ])
  })

  test('sin año no hay característica de año', () => {
    expect(candidateFeatures(candidato('uno', ['a'], ['E']))).toHaveLength(2)
  })

  test('el vector del candidato se normaliza y usa el IDF del corpus', () => {
    const corpus = [
      candidato('uno', ['comun']),
      candidato('dos', ['comun']),
      candidato('tres', ['raro']),
    ]
    // Sin estudios, para que la norma sea sólo del tag que se mide.
    const vector = candidateVector(candidato('cuatro', ['comun'], []), corpus)

    expect(vector.norm).toBe(1)
    expect(vector.weights.get(tagKey('comun'))).toBeCloseTo(1, 6)
  })
})
