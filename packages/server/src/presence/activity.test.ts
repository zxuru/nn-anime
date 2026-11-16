import { describe, expect, test } from 'bun:test'
import { buildActivity, limpiarTexto, type PresenceSnapshot } from './activity'

const NOW = 1_700_000_000_000

function foto(cambios: Partial<PresenceSnapshot> = {}): PresenceSnapshot {
  return {
    mode: 'completo',
    title: 'Aurora Nocturna',
    episodeNumber: 3,
    positionS: 120,
    durationS: 1_440,
    paused: false,
    ...cambios,
  }
}

describe('el texto que se publica', () => {
  test('se queda en una línea y recorta por puntos de código', () => {
    expect(limpiarTexto('  Aurora\nNocturna\t  ')).toBe('Aurora Nocturna')
    expect(limpiarTexto('a'.repeat(200)).length).toBe(128)
    expect([...limpiarTexto('界'.repeat(200))].length).toBe(128)
  })
})

describe('la actividad', () => {
  test('en modo completo lleva el título y el episodio', () => {
    const activity = buildActivity(foto(), NOW)

    expect(activity.type).toBe(3)
    expect(activity.details).toBe('Aurora Nocturna')
    expect(activity.state).toBe('Episodio 3')
    expect(activity.status_display_type).toBe(0)
    expect(activity.timestamps).toEqual({
      start: NOW - 120_000,
      end: NOW - 120_000 + 1_440_000,
    })
  })

  test('en modo discreto no enseña ni el título ni el episodio', () => {
    const activity = buildActivity(foto({ mode: 'discreto' }), NOW)

    expect(activity.details).toBe('Viendo en RoNa')
    expect(activity.state).toBeUndefined()
    expect(JSON.stringify(activity)).not.toContain('Aurora')
    // El reloj sí: no identifica la obra, sólo dice que hay algo en marcha.
    expect(activity.timestamps).toBeDefined()
  })

  test('un título de adultos llega como null y no se publica', () => {
    const activity = buildActivity(foto({ title: null }), NOW)

    expect(activity.details).toBe('Viendo en RoNa')
    expect(JSON.stringify(activity)).not.toContain('Aurora')
  })

  test('en pausa no hay timestamps y el estado lo dice', () => {
    const activity = buildActivity(foto({ paused: true }), NOW)

    expect(activity.state).toBe('En pausa')
    expect(activity.timestamps).toBeUndefined()
  })

  test('sin duración no inventa una barra', () => {
    const activity = buildActivity(foto({ durationS: 0 }), NOW)

    expect(activity.timestamps).toBeUndefined()
    expect(activity.state).toBe('Episodio 3')
  })

  test('la posición no puede pasarse de la duración', () => {
    const activity = buildActivity(foto({ positionS: 9_999, durationS: 600 }), NOW)

    expect(activity.timestamps?.start).toBe(NOW - 600_000)
  })

  test('un título vacío o de sólo espacios cae al texto genérico', () => {
    expect(buildActivity(foto({ title: '   ' }), NOW).details).toBe('Viendo en RoNa')
  })
})
