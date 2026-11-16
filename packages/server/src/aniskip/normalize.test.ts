/**
 * La normalización de AniSkip, sin red ni store.
 *
 * Lo que se mide es la traducción: los alias `mixed-*`, los tipos que no se
 * conocen, los intervalos que no avanzan y la deduplicación por la terna. Es
 * exactamente lo que el reproductor recibe ya resuelto, así que una prueba aquí
 * es la que dice si los botones van a señalar el sitio correcto.
 */

import { describe, expect, test } from 'bun:test'
import { normalizeSkipTimes } from './normalize'

/** La forma real medida contra AniSkip, recortada a lo que se lee. */
const RESPUESTA_REAL = {
  found: true,
  results: [
    {
      interval: { startTime: 128.406, endTime: 218.406 },
      skipType: 'op',
      skipId: 'op-1',
      episodeLength: 1441.94,
    },
    {
      interval: { startTime: 129, endTime: 219 },
      skipType: 'mixed-op',
      skipId: 'mixed-op-1',
      episodeLength: 1441.94,
    },
    {
      interval: { startTime: 1300.5, endTime: 1386.2 },
      skipType: 'ed',
      skipId: 'ed-1',
      episodeLength: 1441.94,
    },
    {
      interval: { startTime: 1301, endTime: 1387 },
      skipType: 'mixed-ed',
      skipId: 'mixed-ed-1',
      episodeLength: 1441.94,
    },
    {
      interval: { startTime: 40, endTime: 70 },
      skipType: 'recap',
      skipId: 'recap-1',
      episodeLength: 1441.94,
    },
  ],
}

describe('la traducción de los tipos', () => {
  test('op y mixed-op son el mismo salto, y ed y mixed-ed también', () => {
    const resultado = normalizeSkipTimes(RESPUESTA_REAL)

    expect(resultado.kind).toBe('found')
    expect(resultado.kind === 'found' ? resultado.intervals : []).toEqual([
      { type: 'recap', start: 40, end: 70 },
      { type: 'op', start: 128.406, end: 218.406 },
      { type: 'op', start: 129, end: 219 },
      { type: 'ed', start: 1300.5, end: 1386.2 },
      { type: 'ed', start: 1301, end: 1387 },
    ])
  })

  test('un `mixed-op` y un `op` con tiempos distintos no se pisan: son dos saltos', () => {
    const resultado = normalizeSkipTimes(RESPUESTA_REAL)
    const ops = resultado.kind === 'found' ? resultado.intervals.filter((i) => i.type === 'op') : []

    // Está medido: para el mismo episodio coexisten con tiempos distintos, y
    // quedarse con uno perdería el salto que el otro describe.
    expect(ops).toHaveLength(2)
  })

  test('la lista sale ordenada por el segundo en el que empieza cada intervalo', () => {
    const resultado = normalizeSkipTimes({
      found: true,
      results: [
        { interval: { startTime: 900, endTime: 960 }, skipType: 'op' },
        { interval: { startTime: 8, endTime: 30 }, skipType: 'recap' },
        { interval: { startTime: 100, endTime: 160 }, skipType: 'ed' },
      ],
    })

    expect(resultado.kind === 'found' ? resultado.intervals.map((i) => i.start) : []).toEqual([
      8, 100, 900,
    ])
  })

  test('un tipo desconocido se descarta sin tirar los demás', () => {
    const resultado = normalizeSkipTimes({
      found: true,
      results: [
        { interval: { startTime: 10, endTime: 20 }, skipType: 'preview' },
        { interval: { startTime: 30, endTime: 40 }, skipType: 'op' },
      ],
    })

    expect(resultado).toEqual({
      kind: 'found',
      intervals: [{ type: 'op', start: 30, end: 40 }],
    })
  })

  test('si todos los tipos son desconocidos no hay saltos, y no es un error', () => {
    const resultado = normalizeSkipTimes({
      found: true,
      results: [{ interval: { startTime: 10, endTime: 20 }, skipType: 'preview' }],
    })

    expect(resultado.kind).toBe('empty')
  })

  test('el tipo se compara sin distinguir mayúsculas', () => {
    const resultado = normalizeSkipTimes({
      found: true,
      results: [{ interval: { startTime: 10, endTime: 20 }, skipType: 'OP' }],
    })

    expect(resultado).toEqual({ kind: 'found', intervals: [{ type: 'op', start: 10, end: 20 }] })
  })
})

describe('lo que se descarta', () => {
  test('un intervalo que no avanza no es un salto', () => {
    const resultado = normalizeSkipTimes({
      found: true,
      results: [
        { interval: { startTime: 50, endTime: 50 }, skipType: 'op' },
        { interval: { startTime: 90, endTime: 60 }, skipType: 'op' },
        { interval: { startTime: 10, endTime: 20 }, skipType: 'ed' },
      ],
    })

    expect(resultado).toEqual({ kind: 'found', intervals: [{ type: 'ed', start: 10, end: 20 }] })
  })

  test('un intervalo que empieza antes del episodio se descarta', () => {
    const resultado = normalizeSkipTimes({
      found: true,
      results: [{ interval: { startTime: -5, endTime: 20 }, skipType: 'op' }],
    })

    expect(resultado.kind).toBe('empty')
  })

  test('un tiempo que no es finito se descarta', () => {
    const resultado = normalizeSkipTimes({
      found: true,
      results: [
        { interval: { startTime: Number.POSITIVE_INFINITY, endTime: 20 }, skipType: 'op' },
        { interval: { startTime: 10, endTime: Number.NEGATIVE_INFINITY }, skipType: 'op' },
        { interval: { startTime: Number.NaN, endTime: 30 }, skipType: 'ed' },
        { interval: { startTime: 10, endTime: 20 }, skipType: 'recap' },
      ],
    })

    expect(resultado).toEqual({
      kind: 'found',
      intervals: [{ type: 'recap', start: 10, end: 20 }],
    })
  })
})

describe('la deduplicación', () => {
  test('la misma terna (type, start, end) no se repite', () => {
    const resultado = normalizeSkipTimes({
      found: true,
      results: [
        { interval: { startTime: 100, endTime: 200 }, skipType: 'op' },
        { interval: { startTime: 100, endTime: 200 }, skipType: 'op' },
      ],
    })

    expect(resultado).toEqual({ kind: 'found', intervals: [{ type: 'op', start: 100, end: 200 }] })
  })

  test('dos saltos del mismo tipo y el mismo inicio pero final distinto son dos', () => {
    const resultado = normalizeSkipTimes({
      found: true,
      results: [
        { interval: { startTime: 100, endTime: 200 }, skipType: 'op' },
        { interval: { startTime: 100, endTime: 220 }, skipType: 'mixed-op' },
      ],
    })

    expect(resultado).toEqual({
      kind: 'found',
      intervals: [
        { type: 'op', start: 100, end: 200 },
        { type: 'op', start: 100, end: 220 },
      ],
    })
  })

  test('un alias que acaba en el mismo salto que su canónico no se duplica', () => {
    const resultado = normalizeSkipTimes({
      found: true,
      results: [
        { interval: { startTime: 100, endTime: 200 }, skipType: 'op' },
        { interval: { startTime: 100, endTime: 200 }, skipType: 'mixed-op' },
      ],
    })

    expect(resultado).toEqual({ kind: 'found', intervals: [{ type: 'op', start: 100, end: 200 }] })
  })
})

describe('las respuestas sin saltos', () => {
  test('found:false es una respuesta buena y deja la lista vacía', () => {
    expect(normalizeSkipTimes({ found: false, results: [] }).kind).toBe('empty')
  })

  test('results ausente con found:true tampoco es un error', () => {
    expect(normalizeSkipTimes({ found: true }).kind).toBe('empty')
  })

  test('results null se trata como ausente', () => {
    expect(normalizeSkipTimes({ found: true, results: null }).kind).toBe('empty')
  })

  test('found:false con results se queda en vacío: manda el found', () => {
    expect(
      normalizeSkipTimes({
        found: false,
        results: [{ interval: { startTime: 10, endTime: 20 }, skipType: 'op' }],
      }).kind,
    ).toBe('empty')
  })
})

describe('las respuestas malformadas', () => {
  test.each([
    ['null', null],
    ['un objeto sin found', {}],
    ['found que no es booleano', { found: 'si', results: [] }],
    ['results que no es una lista', { found: true, results: 'no' }],
    [
      'un intervalo sin números',
      { found: true, results: [{ interval: { startTime: '10', endTime: 20 }, skipType: 'op' }] },
    ],
    ['una lista suelta', []],
  ])('%s se dice malformada, no se adivina', (_caso, payload) => {
    expect(normalizeSkipTimes(payload).kind).toBe('malformed')
  })
})
