import { describe, expect, test } from 'bun:test'
import type { Candidate } from '@nn-anime/core'
import { es, t } from './i18n/es'
import { DEFAULT_LAMBDA, mmr, type RankedCandidate, similarity } from './mmr'
import { buildReasons, mainReason, type ReasonCandidate } from './reasons'

function candidato(
  titulo: string,
  tags: readonly string[],
  studios: readonly string[] = [],
): Candidate {
  return {
    ref: { providerId: 'fixture', value: titulo },
    title: titulo,
    tags: [...tags],
    studios: [...studios],
  }
}

function razon(
  kind: string,
  key: ReasonCandidate['key'],
  weight: number,
  values: Record<string, string> = {},
): ReasonCandidate {
  return { kind, key, evidence: { weight }, values }
}

describe('catálogo de razones', () => {
  test('todas las frases tienen texto', () => {
    for (const [clave, texto] of Object.entries(es)) {
      expect(texto.length, clave).toBeGreaterThan(10)
    }
  })

  test('los huecos se rellenan', () => {
    expect(t('reason.matches-search', { term: 'mecha' })).toContain('mecha')
    expect(t('reason.same-genre', { genre: 'acción' })).toContain('acción')
  })

  test('un hueco sin valor no deja llaves sueltas', () => {
    expect(t('reason.matches-search', {})).not.toContain('{')
  })
})

describe('razones de un candidato', () => {
  test('se ordenan por peso: se enseña la que más mandó', () => {
    const razones = buildReasons([
      razon('trending', 'reason.trending', 0.2),
      razon('matches-search', 'reason.matches-search', 0.9, { term: 'mecha' }),
    ])

    expect(razones[0]?.kind).toBe('matches-search')
    expect(razones[1]?.kind).toBe('trending')
  })

  test('una señal con peso cero no explica nada y no aparece', () => {
    const razones = buildReasons([
      razon('trending', 'reason.trending', 0),
      razon('covisit', 'reason.covisit', 0.5, { seen: 'otro' }),
    ])

    expect(razones).toHaveLength(1)
    expect(razones[0]?.kind).toBe('covisit')
  })

  test('cada razón lleva su tipo, su texto y su evidencia', () => {
    const razones = buildReasons([
      razon('same-studio', 'reason.same-studio', 0.4, { studio: 'Cobre' }),
    ])
    const primera = razones[0]

    expect(primera?.kind).toBe('same-studio')
    expect(primera?.text).toContain('Cobre')
    expect(primera?.evidence.weight).toBe(0.4)
  })

  test('la razón principal es la de más peso', () => {
    const razones = buildReasons([
      razon('a', 'reason.rediscovery', 0.1),
      razon('b', 'reason.trending', 0.8),
    ])

    expect(mainReason(razones).kind).toBe('b')
  })

  test('sin razones, la genérica tiene texto: nunca una razón vacía', () => {
    const principal = mainReason([])

    expect(principal.kind).toBe('fallback')
    expect(principal.text.length).toBeGreaterThan(10)
    expect(principal.text).not.toContain('{')
  })

  test('ninguna razón del top 20 sale con texto vacío', () => {
    const razones = Array.from({ length: 20 }, (_valor, indice) =>
      buildReasons([
        razon(`k${indice}`, 'reason.same-genre', 0.5, { genre: 'acción' }),
        razon(`k${indice}-b`, 'reason.covisit', 0.3, { seen: `t${indice}` }),
      ]),
    )

    for (const lista of razones) {
      expect(lista.length).toBeGreaterThan(0)
      for (const una of lista) {
        expect(una.text.trim()).not.toBe('')
        expect(una.text).not.toContain('{')
      }
    }
  })

  test('la razón de búsqueda lleva el término que la justifica', () => {
    // Que la razón salga del mismo cálculo que la puntuación se comprueba en
    // `search-signal.test.ts`: hay puntuación exactamente cuando hay razón.
    const razones = buildReasons([
      razon('matches-search', 'reason.matches-search', 0.7, { term: 'mecha' }),
    ])

    expect(razones[0]?.text).toContain('mecha')
    expect(razones[0]?.evidence.weight).toBe(0.7)
  })
})

describe('parecido entre candidatos', () => {
  test('dos títulos con los mismos tags se parecen del todo', () => {
    expect(similarity(candidato('a', ['x']), candidato('b', ['x']))).toBe(1)
  })

  test('sin nada en común no se parecen', () => {
    expect(similarity(candidato('a', ['x']), candidato('b', ['y']))).toBe(0)
  })

  test('compartir uno de tres tags se parece menos que compartir el único', () => {
    const mucho = similarity(candidato('a', ['x']), candidato('b', ['x']))
    const poco = similarity(candidato('a', ['x', 'y', 'z']), candidato('b', ['x']))

    expect(poco).toBeLessThan(mucho)
  })

  test('un candidato sin características no se parece a nada', () => {
    expect(similarity(candidato('a', []), candidato('b', ['x']))).toBe(0)
  })
})

describe('MMR', () => {
  test('el lambda por defecto es el del spec', () => {
    expect(DEFAULT_LAMBDA).toBe(0.7)
  })

  function ranking(): readonly RankedCandidate[] {
    // Cinco títulos del tag `accion`, con la misma puntuación, y uno de `romance`
    // con una puntuación algo menor.
    return [
      ...Array.from({ length: 5 }, (_valor, indice) => ({
        candidate: candidato(`accion-${indice}`, ['accion']),
        score: 1,
      })),
      { candidate: candidato('romance', ['romance']), score: 0.9 },
    ]
  }

  test('dos títulos del mismo tag no copan el top 5', () => {
    const orden = mmr(ranking(), { limit: 5 })
    const tags = orden.map((entrada) => entrada.candidate.tags[0])

    expect(tags.filter((tag) => tag === 'accion').length).toBeLessThan(5)
    expect(tags).toContain('romance')
  })

  test('el primero se elige por relevancia pura', () => {
    const orden = mmr(ranking(), { limit: 1 })

    expect(orden[0]?.score).toBe(1)
  })

  test('conserva las puntuaciones originales', () => {
    const orden = mmr(ranking(), { limit: 6 })
    const originales = new Map(ranking().map((entrada) => [entrada.candidate.title, entrada.score]))

    for (const entrada of orden) {
      expect(entrada.score).toBe(originales.get(entrada.candidate.title) ?? -1)
    }
  })

  test('con lambda 1 el orden es el de la puntuación', () => {
    const orden = mmr(ranking(), { lambda: 1, limit: 6 })

    expect(orden[0]?.score).toBe(1)
    expect(orden.at(-1)?.candidate.title).toBe('romance')
  })

  test('no pierde ni repite candidatos', () => {
    const orden = mmr(ranking(), { limit: 6 })
    const titulos = orden.map((entrada) => entrada.candidate.title)

    expect(new Set(titulos).size).toBe(titulos.length)
    expect(titulos.length).toBe(6)
  })

  test('sin candidatos no hay nada que ordenar', () => {
    expect(mmr([])).toEqual([])
  })

  test('el límite corta la lista', () => {
    expect(mmr(ranking(), { limit: 3 })).toHaveLength(3)
  })
})
