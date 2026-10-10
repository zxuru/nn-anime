import { describe, expect, test } from 'bun:test'
import {
  announcement,
  formatTime,
  isTypingTarget,
  keyAction,
  needsHls,
  SEEK_STEP_S,
  seekBy,
  volumeBy,
} from './controls'

describe('qué tecla hace qué', () => {
  test('las flechas laterales mueven diez segundos', () => {
    expect(keyAction({ key: 'ArrowRight' })).toBe('forward')
    expect(keyAction({ key: 'ArrowLeft' })).toBe('back')
    expect(SEEK_STEP_S).toBe(10)
  })

  test('espacio, enter y `k` pausan', () => {
    expect(keyAction({ key: ' ' })).toBe('toggle')
    expect(keyAction({ key: 'Enter' })).toBe('toggle')
    expect(keyAction({ key: 'k' })).toBe('toggle')
  })

  test('las flechas verticales son el volumen, y `m` silencia', () => {
    expect(keyAction({ key: 'ArrowUp' })).toBe('volume-up')
    expect(keyAction({ key: 'ArrowDown' })).toBe('volume-down')
    expect(keyAction({ key: 'm' })).toBe('mute')
  })

  test('`f` es pantalla completa', () => {
    expect(keyAction({ key: 'f' })).toBe('fullscreen')
  })

  test('una tecla que no es del reproductor no hace nada', () => {
    expect(keyAction({ key: 'q' })).toBeUndefined()
    expect(keyAction({ key: 'Tab' })).toBeUndefined()
  })

  test('no secuestra la escritura: en un campo de texto no pasa nada', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(keyAction({ key: ' ', tagName }), tagName).toBeUndefined()
      expect(keyAction({ key: 'ArrowRight', tagName }), tagName).toBeUndefined()
    }

    expect(keyAction({ key: ' ', isContentEditable: true })).toBeUndefined()
  })

  test('reconoce los campos por su etiqueta, sin mirar el tipo', () => {
    expect(isTypingTarget({ key: '', tagName: 'input' })).toBe(true)
    expect(isTypingTarget({ key: '', tagName: 'DIV' })).toBe(false)
    expect(isTypingTarget(undefined)).toBe(false)
  })

  test('con modificadores no se hace nada: son atajos del navegador', () => {
    expect(keyAction({ key: ' ', ctrlKey: true })).toBeUndefined()
    expect(keyAction({ key: 'f', metaKey: true })).toBeUndefined()
    expect(keyAction({ key: 'k', altKey: true })).toBeUndefined()
  })
})

describe('posición y volumen', () => {
  test('el salto no se pasa del final ni baja de cero', () => {
    expect(seekBy(5, SEEK_STEP_S, 100)).toBe(15)
    expect(seekBy(95, SEEK_STEP_S, 100)).toBe(100)
    expect(seekBy(3, -SEEK_STEP_S, 100)).toBe(0)
  })

  test('sin duración conocida sólo se evita lo negativo', () => {
    expect(seekBy(5, 10, Number.NaN)).toBe(15)
    expect(seekBy(2, -10, Number.NaN)).toBe(0)
  })

  test('el volumen se queda entre cero y uno', () => {
    expect(volumeBy(0.5, 0.1)).toBeCloseTo(0.6)
    expect(volumeBy(0.95, 0.1)).toBe(1)
    expect(volumeBy(0.05, -0.1)).toBe(0)
  })
})

describe('tiempos legibles', () => {
  test('minutos y segundos', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(9)).toBe('0:09')
    expect(formatTime(75)).toBe('1:15')
  })

  test('con horas, tres cifras', () => {
    expect(formatTime(3661)).toBe('1:01:01')
  })

  test('un tiempo imposible no rompe la interfaz', () => {
    expect(formatTime(Number.NaN)).toBe('0:00')
    expect(formatTime(-5)).toBe('0:00')
  })
})

describe('lo que se anuncia', () => {
  test('dice si suena y por dónde va', () => {
    expect(announcement({ playing: true, positionS: 30, durationS: 120 })).toBe(
      'Reproduciendo, 0:30 de 2:00',
    )
    expect(announcement({ playing: false, positionS: 30, durationS: 120 })).toBe(
      'En pausa, 0:30 de 2:00',
    )
  })

  test('sin duración sólo dice el estado', () => {
    expect(announcement({ playing: true, positionS: 0, durationS: 0 })).toBe('Reproduciendo')
  })

  test('un error manda sobre todo lo demás', () => {
    expect(announcement({ playing: true, positionS: 5, durationS: 10, error: 'sin red' })).toBe(
      'Error: sin red',
    )
  })
})

describe('qué reproductor hace falta', () => {
  test('hls necesita la biblioteca; un archivo, no', () => {
    expect(needsHls('hls')).toBe(true)
    expect(needsHls('file')).toBe(false)
  })
})
