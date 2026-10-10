import { describe, expect, test } from 'bun:test'
import type { Candidate } from '@nn-anime/core'
import {
  BARELY_STARTED_RATIO,
  FINISHED_RATIO,
  filterCandidate,
  filterCandidates,
  indexWatchState,
  REDISCOVERY_DAYS,
} from './filters'
import {
  MAX_SEARCH_WEIGHT,
  matchScore,
  SEARCH_HALF_LIFE_DAYS,
  searchReason,
  searchScore,
  searchWeight,
  terms,
} from './search-signal'

const AHORA = new Date('2026-01-31T00:00:00Z')
const DIA = 86_400_000

function candidato(titulo: string, tags: readonly string[] = []): Candidate {
  return {
    ref: { providerId: 'fixture', value: titulo },
    title: titulo,
    tags: [...tags],
    studios: [],
  }
}

function busqueda(query: string, dias: number, hits?: number) {
  return {
    query,
    at: new Date(AHORA.getTime() - dias * DIA),
    ...(hits === undefined ? {} : { hits }),
  }
}

describe('términos de una búsqueda', () => {
  test('se normalizan y se separan', () => {
    expect(terms('  Mecha  ACCIÓN ')).toEqual(['mecha', 'acción'])
  })

  test('los repetidos no cuentan dos veces', () => {
    expect(terms('mecha mecha')).toEqual(['mecha'])
  })

  test('una búsqueda vacía no tiene términos', () => {
    expect(terms('   ')).toEqual([])
  })
})

describe('encaje con el candidato', () => {
  test('el título vale el doble que un tag', () => {
    const enTitulo = matchScore(candidato('Mecha grande'), ['mecha'])
    const enTag = matchScore(candidato('Otra cosa', ['mecha']), ['mecha'])

    expect(enTitulo).toBeGreaterThan(enTag)
  })

  test('el término puede estar dentro de una palabra', () => {
    expect(matchScore(candidato('Mechacorta'), ['mecha'])).toBeGreaterThan(0)
  })

  test('no distingue mayúsculas', () => {
    expect(matchScore(candidato('MECHA'), ['mecha'])).toBe(
      matchScore(candidato('mecha'), ['mecha']),
    )
  })

  test('sin coincidencia, cero', () => {
    expect(matchScore(candidato('Romance', ['drama']), ['mecha'])).toBe(0)
  })

  test('sin términos, cero', () => {
    expect(matchScore(candidato('Mecha'), [])).toBe(0)
  })

  test('el resultado no pasa de uno', () => {
    expect(matchScore(candidato('mecha mecha mecha'), ['mecha', 'mecha'])).toBeLessThanOrEqual(1)
  })
})

describe('peso de una búsqueda', () => {
  test('la semivida es de tres días', () => {
    expect(SEARCH_HALF_LIFE_DAYS).toBe(3)
  })

  test('a los tres días vale la mitad', () => {
    expect(searchWeight(busqueda('mecha', 3), AHORA)).toBeCloseTo(0.5, 6)
  })

  test('una búsqueda de hoy vale uno', () => {
    expect(searchWeight(busqueda('mecha', 0), AHORA)).toBeCloseTo(1, 6)
  })

  test('repetir la búsqueda sube el peso, pero no sin límite', () => {
    expect(searchWeight(busqueda('mecha', 0, 2), AHORA)).toBeCloseTo(2, 6)
    expect(searchWeight(busqueda('mecha', 0, 99), AHORA)).toBeCloseTo(3, 6)
  })
})

describe('puntuación de búsqueda', () => {
  test('una búsqueda reciente que encaja sube', () => {
    const puntuacion = searchScore(candidato('Mecha grande'), [busqueda('mecha', 0)], {
      now: AHORA,
    })

    expect(puntuacion).toBeGreaterThan(0)
    expect(puntuacion).toBeLessThanOrEqual(MAX_SEARCH_WEIGHT)
  })

  test('la misma búsqueda, vieja, sube menos', () => {
    const reciente = searchScore(candidato('Mecha grande'), [busqueda('mecha', 0)], { now: AHORA })
    const vieja = searchScore(candidato('Mecha grande'), [busqueda('mecha', 30)], { now: AHORA })

    expect(vieja).toBeLessThan(reciente)
  })

  test('se toma la que más encaja, no la suma de todas', () => {
    // Veinte búsquedas vagas no pueden superar a una concreta: si sumaran, el
    // volumen mandaría sobre la coincidencia.
    const muchas = Array.from({ length: 20 }, () => busqueda('otra cosa', 0))
    const una = searchScore(candidato('Mecha grande'), [busqueda('mecha', 0)], { now: AHORA })
    const veinte = searchScore(candidato('Mecha grande'), muchas, { now: AHORA })

    expect(veinte).toBe(0)
    expect(una).toBeGreaterThan(veinte)
  })

  test('dos búsquedas que encajan no suman: manda la que más encaja', () => {
    // Cada una encaja al máximo y pesa 0,5 por su antigüedad: tomando la mejor,
    // el resultado es 0,5; sumándolas sería 1. Es la diferencia que mide esta
    // prueba, y la mutación que sumaba sobrevivía sin ella.
    const dos = [busqueda('mecha', 3), busqueda('mecha', 3)]
    const puntuacion = searchScore(candidato('Mecha'), dos, { now: AHORA })

    expect(puntuacion).toBeCloseTo(0.5, 6)
  })

  test('sin historial, cero', () => {
    expect(searchScore(candidato('Mecha'), [], { now: AHORA })).toBe(0)
  })

  test('sin coincidencia, cero', () => {
    expect(searchScore(candidato('Romance'), [busqueda('mecha', 0)], { now: AHORA })).toBe(0)
  })
})

describe('la razón', () => {
  test('dice con qué término coincide', () => {
    const razon = searchReason(candidato('Mecha grande'), [busqueda('mecha', 0)], { now: AHORA })

    expect(razon?.kind).toBe('matches-search')
    expect(razon?.detail).toContain('mecha')
  })

  test('sin coincidencia no hay razón', () => {
    expect(
      searchReason(candidato('Romance'), [busqueda('mecha', 0)], { now: AHORA }),
    ).toBeUndefined()
  })

  test('la razón sale del mismo cálculo que la puntuación', () => {
    const candidatoMecha = candidato('Mecha grande')
    const historial = [busqueda('mecha', 1)]

    expect(searchScore(candidatoMecha, historial, { now: AHORA })).toBeGreaterThan(0)
    expect(searchReason(candidatoMecha, historial, { now: AHORA })).toBeDefined()
  })
})

describe('qué no recomendar', () => {
  const visto = (ref: string, ratio: number, dias: number) => ({
    ref,
    ratio,
    at: new Date(AHORA.getTime() - dias * DIA),
  })

  test('lo nunca visto se queda', () => {
    expect(filterCandidate(undefined, { now: AHORA }).keep).toBe(true)
  })

  test('un título visto al 100 % no vuelve, ni con el tiempo', () => {
    const salida = filterCandidate(visto('a', 1, 400), { now: AHORA })

    expect(salida.keep).toBe(false)
    expect(salida.reason).toBe('finished')
  })

  test('uno visto al 95 % tampoco: el umbral es 0,9', () => {
    expect(FINISHED_RATIO).toBe(0.9)
    expect(filterCandidate(visto('a', 0.95, 400), { now: AHORA }).keep).toBe(false)
  })

  test('un título visto al 10 % hace más de 30 días sí reaparece', () => {
    const salida = filterCandidate(visto('a', 0.1, 45), { now: AHORA })

    expect(salida.keep).toBe(true)
    expect(salida.rediscovery).toBeGreaterThan(0)
    expect(salida.rediscovery).toBeLessThanOrEqual(1)
  })

  test('el mismo título hace diez días no reaparece', () => {
    const salida = filterCandidate(visto('a', 0.1, 10), { now: AHORA })

    expect(salida.keep).toBe(false)
    expect(salida.reason).toBe('started')
  })

  test('lo visto casi entero no vuelve ni pasado el plazo', () => {
    const salida = filterCandidate(visto('a', 0.8, 100), { now: AHORA })

    expect(salida.keep).toBe(false)
    expect(salida.reason).toBe('watched')
  })

  test('el peso de reencuentro crece con el tiempo y no pasa de uno', () => {
    const aLosTreinta = filterCandidate(visto('a', 0.1, 30), { now: AHORA })
    const aLosSesenta = filterCandidate(visto('b', 0.1, 60), { now: AHORA })
    const aLosDosAnios = filterCandidate(visto('c', 0.1, 730), { now: AHORA })

    expect(aLosTreinta.rediscovery).toBeLessThan(aLosSesenta.rediscovery ?? 0)
    expect(aLosDosAnios.rediscovery).toBe(1)
  })

  test('los umbrales son los del spec', () => {
    expect(REDISCOVERY_DAYS).toBe(30)
    expect(BARELY_STARTED_RATIO).toBe(0.5)
  })

  test('el índice se queda con el visionado más reciente de cada título', () => {
    const indice = indexWatchState([visto('a', 0.1, 100), visto('a', 0.9, 2)])

    expect(indice.get('a')?.ratio).toBe(0.9)
  })

  test('filtrar conserva el orden y devuelve el peso de reencuentro', () => {
    const candidatos = [
      { ref: { providerId: 'fixture', value: 'nuevo' }, title: 'nuevo' },
      { ref: { providerId: 'fixture', value: 'terminado' }, title: 'terminado' },
      { ref: { providerId: 'fixture', value: 'abandonado' }, title: 'abandonado' },
    ]
    const estados = indexWatchState([
      { ref: 'fixture#terminado', ratio: 1, at: new Date(AHORA.getTime() - DIA) },
      { ref: 'fixture#abandonado', ratio: 0.1, at: new Date(AHORA.getTime() - 45 * DIA) },
    ])

    const salida = filterCandidates(candidatos, estados, { now: AHORA })

    expect(salida.map((entrada) => entrada.candidate.title)).toEqual(['nuevo', 'abandonado'])
    expect(salida[0]?.rediscovery).toBe(0)
    expect(salida[1]?.rediscovery).toBeGreaterThan(0)
  })

  test('un candidato visto al 100 % no aparece en el top 10', () => {
    const candidatos = Array.from({ length: 12 }, (_valor, indice) => ({
      ref: { providerId: 'fixture', value: `t${indice}` },
      title: `t${indice}`,
    }))
    const estados = indexWatchState([
      { ref: 'fixture#t0', ratio: 1, at: new Date(AHORA.getTime() - DIA) },
    ])

    const top10 = filterCandidates(candidatos, estados, { now: AHORA }).slice(0, 10)

    expect(top10.some((entrada) => entrada.candidate.title === 't0')).toBe(false)
  })
})
