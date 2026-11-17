import { describe, expect, test } from 'bun:test'
import {
  duracionConocida,
  MIN_DELTA_S,
  PRESENCE_INTERVAL_MS,
  presenceBody,
  shouldSendPresence,
  shouldSendUpdate,
  UPDATE_INTERVAL_MS,
  updateBody,
} from './useWatchEvents'

describe('cuándo se manda el avance', () => {
  test('cada cinco segundos', () => {
    expect(UPDATE_INTERVAL_MS).toBe(5_000)
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

describe('la foto de presencia', () => {
  test('no lleva el título y redondea como el avance', () => {
    expect(presenceBody({ providerId: 'f', value: 'x' }, 3, 12.7, 1440.9, false)).toEqual({
      animeRef: { providerId: 'f', value: 'x' },
      episodeNumber: 3,
      positionS: 12,
      durationS: 1440,
      paused: false,
    })
  })

  test('sin episodio no manda un cero que no dice nada', () => {
    expect(presenceBody({ providerId: 'f', value: 'x' }, undefined, -1, 0, true)).toEqual({
      animeRef: { providerId: 'f', value: 'x' },
      positionS: 0,
      durationS: 0,
      paused: true,
    })
  })
})

describe('cuándo se manda la foto a Discord', () => {
  test('cada quince segundos, y no antes', () => {
    expect(PRESENCE_INTERVAL_MS).toBe(15_000)
    expect(
      shouldSendPresence({
        now: PRESENCE_INTERVAL_MS,
        lastSentAt: 0,
        durationS: 1440,
        lastDurationS: 1440,
      }),
    ).toBe(true)
    expect(
      shouldSendPresence({
        now: PRESENCE_INTERVAL_MS - 1,
        lastSentAt: 0,
        durationS: 1440,
        lastDurationS: 1440,
      }),
    ).toBe(false)
  })

  test('al empezar y al pausar se manda siempre', () => {
    expect(
      shouldSendPresence({
        now: 1000,
        lastSentAt: 999,
        durationS: 1440,
        lastDurationS: 1440,
        force: true,
      }),
    ).toBe(true)
  })

  test('cuando la duración se conoce se manda una vez más', () => {
    expect(
      shouldSendPresence({
        now: 1000,
        lastSentAt: 999,
        durationS: 1440,
        lastDurationS: 0,
      }),
    ).toBe(true)
  })

  /**
   * La prueba que mide el fallo: un directo trae `Infinity` y la foto se
   * mandaba una vez por cada `timeupdate`. La duración normalizada es cero, así
   * que no hay «duración nueva» que anunciar y el pestillo no se abre.
   */
  test('una duración que no se puede conocer no abre el pestillo', () => {
    expect(duracionConocida(Number.POSITIVE_INFINITY)).toBe(0)
    expect(
      shouldSendPresence({
        now: 1000,
        lastSentAt: 999,
        durationS: duracionConocida(Number.POSITIVE_INFINITY),
        lastDurationS: duracionConocida(Number.POSITIVE_INFINITY),
      }),
    ).toBe(false)
  })
})
