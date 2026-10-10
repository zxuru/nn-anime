import { describe, expect, test } from 'bun:test'
import {
  coVisitScore,
  coVisits,
  indexBySeen,
  MIN_SUPPORT,
  SESSION_GAP_HOURS,
  sessions,
  type Visit,
  visitKey,
} from './covisit'

const HORA = 3_600_000
const BASE = new Date('2026-01-31T00:00:00Z')

function visita(ref: string, horas: number): Visit {
  return { ref, at: new Date(BASE.getTime() + horas * HORA) }
}

describe('sesiones', () => {
  test('el corte es de seis horas', () => {
    expect(SESSION_GAP_HOURS).toBe(6)
  })

  test('dos eventos separados por menos del corte son la misma sesión', () => {
    const partes = sessions([visita('a', 0), visita('b', 5)])

    expect(partes).toHaveLength(1)
    expect(partes[0]).toHaveLength(2)
  })

  test('justo en el corte ya son dos sesiones', () => {
    expect(sessions([visita('a', 0), visita('b', 6)])).toHaveLength(2)
  })

  test('el historial se ordena antes de cortar', () => {
    const partes = sessions([visita('b', 1), visita('a', 0), visita('c', 20)])

    expect(partes).toHaveLength(2)
    expect(partes[0]?.map((v) => v.ref)).toEqual(['a', 'b'])
  })

  test('sin historial no hay sesiones', () => {
    expect(sessions([])).toEqual([])
  })

  test('un hueco de una semana corta la sesión', () => {
    const partes = sessions([visita('a', 0), visita('b', 168)])

    expect(partes).toHaveLength(2)
  })
})

describe('pares que se ven juntos', () => {
  test('dos títulos en la misma sesión generan los dos sentidos', () => {
    const pares = coVisits([visita('a', 0), visita('b', 1), visita('a', 2), visita('b', 3)], {
      minSupport: 1,
    })

    const claves = pares.map((par) => `${par.seen}->${par.candidate}`).sort()

    expect(claves).toEqual(['a->b', 'b->a'])
  })

  test('el borde de sesión corta los pares', () => {
    // `a` y `b` juntos, y `c` diez horas después: no se vieron juntos.
    const pares = coVisits([visita('a', 0), visita('b', 1), visita('c', 10), visita('d', 11)], {
      minSupport: 1,
    })

    const claves = pares.map((par) => `${par.seen}->${par.candidate}`)

    expect(claves).toContain('a->b')
    expect(claves).toContain('c->d')
    expect(claves).not.toContain('b->c')
  })

  test('un par visto una sola vez no cuenta con el soporte por defecto', () => {
    expect(MIN_SUPPORT).toBe(2)
    expect(coVisits([visita('a', 0), visita('b', 1)])).toEqual([])
  })

  test('visto dos veces, sí', () => {
    const pares = coVisits([visita('a', 0), visita('b', 1), visita('a', 2), visita('b', 3)])

    expect(pares.length).toBeGreaterThan(0)
    expect(pares.every((par) => par.count >= MIN_SUPPORT)).toBe(true)
  })

  test('sin decaimiento, el par más frecuente vale uno', () => {
    // Todos los eventos en el mismo instante: así se mide la normalización sin
    // que el decaimiento la tape.
    const mismoInstante = (ref: string): Visit => ({ ref, at: BASE })
    // `a` tres veces, `b` dos y `c` una: el par (a,b) sale 6 veces y el (a,c) 3,
    // porque dentro de una sesión cuentan todos los cruces.
    const visitas = [
      mismoInstante('a'),
      mismoInstante('b'),
      mismoInstante('a'),
      mismoInstante('b'),
      mismoInstante('a'),
      mismoInstante('c'),
    ]

    const pares = coVisits(visitas, { gapHours: 1000 })
    const masFrecuente = pares.find((par) => par.seen === 'a' && par.candidate === 'b')
    const menosFrecuente = pares.find((par) => par.seen === 'a' && par.candidate === 'c')

    expect(masFrecuente?.weight).toBeCloseTo(1, 6)
    expect(menosFrecuente?.weight).toBeLessThan(1)
    expect(menosFrecuente?.weight).toBeGreaterThan(0)
  })

  test('con decaimiento, el más frecuente sigue siendo el que más pesa', () => {
    // Diez sesiones de (a,b) y dos de (a,c), repartidas en el tiempo.
    const visitas = [
      ...Array.from({ length: 10 }, (_valor, indice) => [
        visita('a', indice * 12),
        visita('b', indice * 12 + 1),
      ]).flat(),
      visita('a', 200),
      visita('c', 201),
      visita('a', 212),
      visita('c', 213),
    ]

    const pares = coVisits(visitas)
    const diez = pares.find((par) => par.seen === 'a' && par.candidate === 'b')
    const dos = pares.find((par) => par.seen === 'a' && par.candidate === 'c')

    expect(diez?.count).toBe(10)
    expect(dos?.count).toBe(2)
    expect(diez?.weight).toBeGreaterThan(dos?.weight ?? 1)
    // Y ninguno pasa de uno, que es lo que permite sumarlo con la afinidad.
    expect(diez?.weight).toBeLessThanOrEqual(1)
  })

  test('dentro de una sesión cuentan todos los pares, no sólo los vecinos', () => {
    // Una sola sesión con a, b y c: los pares son todos los cruces.
    const pares = coVisits([visita('a', 0), visita('b', 1), visita('c', 2)], { minSupport: 1 })
    const claves = pares.map((par) => `${par.seen}->${par.candidate}`).sort()

    expect(claves).toEqual(['a->b', 'a->c', 'b->a', 'b->c', 'c->a', 'c->b'])
  })

  test('un título no se empareja consigo mismo', () => {
    const pares = coVisits([visita('a', 0), visita('a', 1), visita('b', 2)], { minSupport: 1 })

    expect(pares.some((par) => par.candidate === par.seen)).toBe(false)
  })

  test('sin historial no hay pares y no hay división por cero', () => {
    expect(coVisits([])).toEqual([])
  })

  test('los pares salen ordenados por peso', () => {
    const pares = coVisits([
      ...Array.from({ length: 5 }, (_valor, indice) => [
        visita('a', indice * 2),
        visita('b', indice * 2 + 1),
      ]).flat(),
      visita('a', 100),
      visita('c', 101),
      visita('a', 102),
      visita('c', 103),
    ])

    const pesos = pares.map((par) => par.weight)

    expect(pesos).toEqual([...pesos].sort((a, b) => b - a))
  })
})

describe('consulta por el último visto', () => {
  test('el índice agrupa por el título visto', () => {
    const pares = coVisits([visita('a', 0), visita('b', 1), visita('a', 2), visita('b', 3)])
    const indice = indexBySeen(pares)

    expect(indice.get('a')?.every((par) => par.seen === 'a')).toBe(true)
  })

  test('la puntuación del candidato que se vio después', () => {
    const pares = coVisits([visita('a', 0), visita('b', 1), visita('a', 2), visita('b', 3)])

    expect(coVisitScore(pares, 'a', 'b')).toBeGreaterThan(0)
    expect(coVisitScore(pares, 'a', 'z')).toBe(0)
  })

  test('sin último visto, cero', () => {
    const pares = coVisits([visita('a', 0), visita('b', 1), visita('a', 2), visita('b', 3)])

    expect(coVisitScore(pares, undefined, 'b')).toBe(0)
  })

  test('sin historial, cero y no `NaN`', () => {
    const puntuacion = coVisitScore([], 'a', 'b')

    expect(puntuacion).toBe(0)
    expect(Number.isNaN(puntuacion)).toBe(false)
  })

  test('el índice también se puede consultar directamente', () => {
    const pares = coVisits([visita('a', 0), visita('b', 1), visita('a', 2), visita('b', 3)])
    const indice = indexBySeen(pares)

    expect(coVisitScore(indice, 'a', 'b')).toBeCloseTo(coVisitScore(pares, 'a', 'b'), 10)
  })
})

describe('clave de un título', () => {
  test('junta proveedor y referencia sin ambigüedad', () => {
    expect(visitKey('fixture', 'a#1')).toBe('fixture#a#1')
  })
})
