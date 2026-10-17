/**
 * La marca de visto dentro de las señales del motor.
 *
 * La composición se prueba **sola** porque es lo único nuevo de este camino: el
 * motor es puro y recibe estados ya hechos, así que lo que hay que medir es qué
 * estados le llegan. Y se mide con el filtro real (`indexWatchState` +
 * `filterCandidate`) en la mano: comprobar que la lista trae un `ratio: 1` mide la
 * forma, no la consecuencia, y la consecuencia es que el título **no se
 * recomienda** ni vuelve por reencuentro.
 */

import { describe, expect, test } from 'bun:test'
import { filterCandidate, indexWatchState, type WatchState } from '@nn-anime/recsys'
import { refKey, watchStateFrom, watchStateWithMarks } from './signals'

const DIA = 24 * 60 * 60 * 1000
const AHORA = new Date('2026-10-10T12:00:00.000Z')

function fila(valor: string, ratio: number, dias: number) {
  return {
    anime: { ref: { providerId: 'fixture', value: valor } },
    positionS: ratio * 1440,
    durationS: 1440,
    startedAt: new Date(AHORA.getTime() - dias * DIA),
    finished: ratio >= 1,
  }
}

function marca(valor: string, dias: number) {
  return {
    ref: { providerId: 'fixture', value: valor },
    watchedAt: new Date(AHORA.getTime() - dias * DIA),
  }
}

/** Lo que el motor decide para una referencia, con los estados ya indexados. */
function decision(estados: readonly WatchState[], valor: string) {
  return filterCandidate(
    indexWatchState(estados).get(refKey({ providerId: 'fixture', value: valor })),
  )
}

describe('la marca de visto en las señales', () => {
  test('entra como un estado al 100 %, con la fecha en que se marcó', () => {
    const estados = watchStateWithMarks([], [marca('vista', 3)])

    expect(estados).toEqual([
      { ref: 'fixture#vista', ratio: 1, at: new Date(AHORA.getTime() - 3 * DIA) },
    ])
  })

  test('la marca gana a la fila vieja de la misma referencia, y la fila sale', () => {
    // El caso que decide la composición: la obra se dejó al 10 % hace medio año y
    // se marcó ayer. Sin sacar la fila, `indexWatchState` se queda con el estado
    // **más reciente** y una marca de hace un año perdería contra un visionado de
    // ayer: el título volvería por reencuentro.
    const estados = watchStateWithMarks([fila('abandonada', 0.1, 1)], [marca('abandonada', 365)])

    expect(estados).toEqual([
      { ref: 'fixture#abandonada', ratio: 1, at: new Date(AHORA.getTime() - 365 * DIA) },
    ])
    expect(decision(estados, 'abandonada')).toEqual({ keep: false, reason: 'finished' })
  })

  test('sin la composición, esa misma marca sí volvería por reencuentro', () => {
    // El control: la fila sola —y sin la marca— es un reencuentro de manual. Es lo
    // que mide que la exclusión la trae la marca y no el filtro del motor.
    const estados = watchStateFrom([fila('abandonada', 0.1, 90)])

    const salida = decision(estados, 'abandonada')
    expect(salida.keep).toBe(true)
    expect(salida.rediscovery).toBeGreaterThan(0)
  })

  test('las demás referencias conservan su fila, sin tocarla', () => {
    const estados = watchStateWithMarks([fila('otra', 0.5, 2)], [marca('vista', 1)])

    expect(estados).toEqual([
      { ref: 'fixture#vista', ratio: 1, at: new Date(AHORA.getTime() - DIA) },
      { ref: 'fixture#otra', ratio: 0.5, at: new Date(AHORA.getTime() - 2 * DIA) },
    ])
  })

  test('sin marcas, la composición es la lectura de siempre', () => {
    const filas = [fila('una', 0.5, 1), fila('dos', 1, 2)]

    expect(watchStateWithMarks(filas, [])).toEqual(watchStateFrom(filas))
  })
})
