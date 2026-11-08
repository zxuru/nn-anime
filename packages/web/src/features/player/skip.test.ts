import { describe, expect, test } from 'bun:test'
import type { SkipInterval } from '@nn-anime/core/schema'
import {
  claveDeIntervalo,
  dentroDelIntervalo,
  destinoDeSalto,
  etiquetaDeSalto,
  intervaloActivo,
  MARGEN_MAXIMO_S,
  MARGEN_MINIMO_S,
  margenValido,
  numeroDeEpisodio,
} from './skip'

const OP: SkipInterval = { type: 'op', start: 10, end: 40 }
const ED: SkipInterval = { type: 'ed', start: 1200, end: 1290 }
const RECAP: SkipInterval = { type: 'recap', start: 200, end: 290 }

describe('el intervalo activo', () => {
  test('dentro sí, en el principio también y en el final no', () => {
    expect(dentroDelIntervalo(OP, 25)).toBe(true)
    expect(dentroDelIntervalo(OP, 10)).toBe(true)
    // El final es medio abierto: en `end` el opening ya terminó.
    expect(dentroDelIntervalo(OP, 40)).toBe(false)
    expect(dentroDelIntervalo(OP, 9.9)).toBe(false)
  })

  test('sin intervalos no hay botón', () => {
    expect(intervaloActivo([], 25)).toBeUndefined()
  })

  test('el que contiene la posición es el que se ofrece', () => {
    expect(intervaloActivo([OP, ED, RECAP], 25)).toBe(OP)
    expect(intervaloActivo([OP, ED, RECAP], 1230)).toBe(ED)
    expect(intervaloActivo([OP, ED, RECAP], 50)).toBeUndefined()
  })

  /**
   * AniSkip publica `mixed-op` y `op` solapados en el mismo episodio (medido en
   * SNK 1: 75–135 y 128.406–218.406). Quedarse con el que empieza antes saltaría
   * sólo hasta 135 y dejaría la reproducción dentro del otro: el botón volvería
   * y el salto automático encadenaría dos saltos. Gana el que termina más lejos.
   */
  test('si dos se solapan gana el que termina más lejos', () => {
    const mixedOp: SkipInterval = { type: 'op', start: 75, end: 135 }
    const op: SkipInterval = { type: 'op', start: 128.406, end: 218.406 }

    expect(intervaloActivo([mixedOp, op], 130)).toBe(op)
    expect(intervaloActivo([op, mixedOp], 130)).toBe(op)
  })

  test('a igualdad de final manda el tipo: intro, ending y resumen', () => {
    const op: SkipInterval = { type: 'op', start: 10, end: 40 }
    const ed: SkipInterval = { type: 'ed', start: 20, end: 40 }
    const recap: SkipInterval = { type: 'recap', start: 15, end: 40 }

    expect(intervaloActivo([recap, ed, op], 25)).toBe(op)
    expect(intervaloActivo([recap, ed], 25)).toBe(ed)
  })
})

describe('a dónde lleva el salto', () => {
  test('sin margen, al final del intervalo', () => {
    expect(destinoDeSalto(OP, 0)).toBe(40)
  })

  test('el margen se descuenta del final', () => {
    expect(destinoDeSalto(OP, 3)).toBe(37)
    expect(destinoDeSalto(ED, MARGEN_MAXIMO_S)).toBe(1285)
  })

  test('un margen mayor que el intervalo no salta hacia atrás', () => {
    // El recap dura 90 s y cualquier margen permitido es menor, así que se
    // construye el caso con un intervalo corto: el suelo es `start`.
    const corto: SkipInterval = { type: 'op', start: 30, end: 32 }

    expect(destinoDeSalto(corto, 5)).toBe(30)
  })

  test('un margen fuera de rango se recorta al borde', () => {
    expect(margenValido(-3)).toBe(MARGEN_MINIMO_S)
    expect(margenValido(9)).toBe(MARGEN_MAXIMO_S)
    expect(margenValido(2.6)).toBe(3)
    expect(margenValido(Number.NaN)).toBe(MARGEN_MINIMO_S)
  })

  /**
   * Hay intervalos que terminan más allá del final del archivo (medido: un `ed`
   * que acaba en 1448 con 1440 de duración). El destino se recorta a la duración
   * real: el elemento lo aguantaría —`currentTime` se queda en el final—, pero lo
   * que se apuntaría como progreso sería un segundo que no existe.
   */
  test('con la duración real, el destino no se pasa del final', () => {
    const ed: SkipInterval = { type: 'ed', start: 1400, end: 1448 }

    expect(destinoDeSalto(ed, 0, 1440)).toBe(1440)
    expect(destinoDeSalto(ed, 5, 1440)).toBe(1440)
    // Y dentro del intervalo manda el margen, con o sin duración.
    expect(destinoDeSalto(ed, 5, 1440)).toBe(1440)
    expect(destinoDeSalto(OP, 3, 1000)).toBe(37)
    // Una duración absurda no recorta nada: sin dato, el destino tal cual.
    expect(destinoDeSalto(OP, 3, Number.NaN)).toBe(37)
    expect(destinoDeSalto(OP, 3, 0)).toBe(37)
  })
})

describe('la etiqueta del botón', () => {
  test('cada tipo tiene la suya', () => {
    expect(etiquetaDeSalto('op')).toBe('player.skip.op')
    expect(etiquetaDeSalto('ed')).toBe('player.skip.ed')
    expect(etiquetaDeSalto('recap')).toBe('player.skip.recap')
  })
})

describe('la clave de un intervalo', () => {
  test('distingue el episodio, el tipo y los dos extremos', () => {
    const base = claveDeIntervalo('fixture:aurora-nocturna#1', OP)

    expect(base).not.toBe(claveDeIntervalo('fixture:aurora-nocturna#2', OP))
    expect(base).not.toBe(claveDeIntervalo('fixture:aurora-nocturna#1', ED))
    expect(base).not.toBe(
      claveDeIntervalo('fixture:aurora-nocturna#1', { type: 'op', start: 10, end: 41 }),
    )
    // Y el mismo intervalo da siempre la misma clave: es lo que permite
    // recordarlo sin depender de la identidad del objeto.
    expect(claveDeIntervalo('fixture:aurora-nocturna#1', { ...OP })).toBe(base)
  })
})

describe('el número de episodio de la referencia', () => {
  test('lo lee de la almohadilla y de la barra', () => {
    expect(numeroDeEpisodio('aurora-nocturna#3')).toBe(3)
    expect(numeroDeEpisodio('dandadan/12')).toBe(12)
    expect(numeroDeEpisodio('aurora-nocturna#12')).toBe(12)
  })

  test('una referencia sin número no inventa uno', () => {
    expect(numeroDeEpisodio('aurora-nocturna')).toBeUndefined()
    expect(numeroDeEpisodio('dandadan/especial')).toBeUndefined()
    expect(numeroDeEpisodio('dandadan/0')).toBeUndefined()
  })
})
