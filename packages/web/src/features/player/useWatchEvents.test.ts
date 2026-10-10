import { describe, expect, test } from 'bun:test'
import { MIN_DELTA_S, shouldSendUpdate, UPDATE_INTERVAL_MS, updateBody } from './useWatchEvents'

describe('cuándo se manda el avance', () => {
  test('cada quince segundos', () => {
    expect(UPDATE_INTERVAL_MS).toBe(15_000)
    expect(
      shouldSendUpdate({
        now: UPDATE_INTERVAL_MS,
        lastSentAt: 0,
        positionS: 0,
        lastSentPositionS: 0,
      }),
    ).toBe(true)
    expect(
      shouldSendUpdate({
        now: UPDATE_INTERVAL_MS - 1,
        lastSentAt: 0,
        positionS: 0,
        lastSentPositionS: 0,
      }),
    ).toBe(false)
  })

  test('y antes, si la posición se movió de verdad', () => {
    expect(
      shouldSendUpdate({
        now: 1000,
        lastSentAt: 0,
        positionS: 2,
        lastSentPositionS: 0,
      }),
    ).toBe(true)
    expect(MIN_DELTA_S).toBe(1)
  })

  test('un movimiento por debajo del mínimo no cuenta', () => {
    expect(
      shouldSendUpdate({
        now: 1000,
        lastSentAt: 0,
        positionS: 0.4,
        lastSentPositionS: 0,
      }),
    ).toBe(false)
  })

  test('al pausar se manda siempre, aunque no toque', () => {
    expect(
      shouldSendUpdate({
        now: 1000,
        lastSentAt: 999,
        positionS: 0,
        lastSentPositionS: 0,
        force: true,
      }),
    ).toBe(true)
  })
})

describe('el cuerpo del avance', () => {
  test('redondea hacia abajo y nunca manda negativos', () => {
    expect(updateBody(12.7, 1440.9)).toEqual({ positionS: 12, durationS: 1440 })
    expect(updateBody(-3, 10)).toEqual({ positionS: 0, durationS: 10 })
  })

  test('sin duración conocida manda cero, no un número inventado', () => {
    expect(updateBody(5, Number.NaN)).toEqual({ positionS: 5, durationS: 0 })
    expect(updateBody(5, 0)).toEqual({ positionS: 5, durationS: 0 })
  })
})
