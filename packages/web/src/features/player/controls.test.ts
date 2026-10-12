import { describe, expect, test } from 'bun:test'
import {
  announcement,
  CLICK_DELAY_MS,
  clampVolume,
  formatTime,
  isTypingTarget,
  keyAction,
  needsHls,
  SEEK_STEP_S,
  seekBy,
  spokenTime,
  volumeBy,
  volumeFromPercent,
  volumePercent,
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

  /**
   * La barra va de 0 a 100 y el elemento de 0 a 1, así que el viaje de ida y
   * vuelta es la parte que se puede romper en silencio: un 50 que llegue como
   * «0,5» al `value` del `<input>` deja el mando en el cero.
   */
  test('la barra y el elemento hablan el mismo volumen', () => {
    expect(volumePercent(1)).toBe(100)
    expect(volumePercent(0.5)).toBe(50)
    expect(volumePercent(0)).toBe(0)
    expect(volumeFromPercent(50)).toBeCloseTo(0.5)
  })

  test('un volumen imposible no sale de cero y uno', () => {
    expect(volumeFromPercent(140)).toBe(1)
    expect(volumeFromPercent(-10)).toBe(0)
    // `video.volume = NaN` lanza: el no-número no puede llegar al elemento, y el
    // `<input>` tampoco puede quedarse con un `value` que no es un número.
    expect(clampVolume(Number.NaN)).toBe(1)
    expect(volumePercent(Number.NaN)).toBe(100)
    expect(volumeBy(Number.NaN, 0)).toBe(1)
  })

  /**
   * La espera que separa el clic del doble clic tiene que ser más corta que la
   * ventana del navegador —unos 500 ms—. Si se pasa, el clic sencillo salta antes
   * de que llegue el `dblclick` y un doble clic pausa el video además de poner la
   * pantalla completa. Y tiene que existir: sin espera no hay forma de saber qué
   * gesto fue.
   */
  test('la espera del clic sencillo cabe dentro del doble clic del navegador', () => {
    expect(CLICK_DELAY_MS).toBeGreaterThan(0)
    expect(CLICK_DELAY_MS).toBeLessThan(500)
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

describe('el tiempo dicho en palabras', () => {
  /**
   * Es el `aria-valuetext` de la barra de progreso.
   *
   * `0:31 / 24:55` es lo que se lee en la pantalla; quien no la ve necesita oír
   * «31 segundos de 24 minutos 55 segundos». Se mide la frase y no el número
   * porque el número ya lo dice el reloj de al lado.
   */
  test('minutos y segundos, sin unidades vacías', () => {
    expect(spokenTime(31)).toBe('31 segundos')
    expect(spokenTime(60)).toBe('1 minuto 0 segundos')
    expect(spokenTime(125)).toBe('2 minutos 5 segundos')
    expect(spokenTime(164)).toBe('2 minutos 44 segundos')
  })

  test('con horas, también', () => {
    expect(spokenTime(3661)).toBe('1 hora 1 minuto 1 segundo')
  })

  test('un tiempo imposible se dice como cero', () => {
    expect(spokenTime(Number.NaN)).toBe('0 segundos')
    expect(spokenTime(-5)).toBe('0 segundos')
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
