import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { PartyBar } from './PartyBar'
import type { PartyHandle } from './useParty'

/**
 * La barra, pintada sin navegador.
 *
 * Lo que se sujeta aquí son dos cosas que el invitado necesita leer: a qué sala
 * está conectado —y si aún no lo está— y en qué tramo de sincronización va. La
 * píldora es la única que vive en la región `aria-live`; la frase del enlace va
 * al lado, fuera, porque cambia con cada reintento.
 */

function mano(overrides: Partial<PartyHandle> = {}): PartyHandle {
  return {
    phase: 'guest',
    room: undefined,
    roster: [],
    connection: 'connected',
    sync: 'ok',
    driftS: 0,
    error: undefined,
    hostMedia: undefined,
    createRoom: async () => {},
    joinRoom: async () => {},
    closeRoom: async () => {},
    leave: async () => {},
    ...overrides,
  }
}

function render(party: PartyHandle): string {
  return renderToString(<PartyBar party={party} />)
}

describe('la barra del invitado', () => {
  test('dice a qué sala está conectado además de cómo va la sincronización', () => {
    const html = render(mano({ phase: 'guest', connection: 'connected', sync: 'ok' }))

    expect(html).toContain('Conectado a la sala.')
    expect(html).toContain('Sincronizado')
  })

  test('mientras conecta lo dice y no da la sala por hecha', () => {
    const html = render(mano({ phase: 'guest', connection: 'connecting', sync: 'unknown' }))

    expect(html).toContain('Conectando con la sala')
    expect(html).not.toContain('Conectado a la sala')
    expect(html).toContain('Midiendo')
  })

  test('el enlace caído y la sala cerrada también se leen', () => {
    expect(render(mano({ connection: 'error' }))).toContain('Sin conexión con la sala.')
    expect(render(mano({ connection: 'closed' }))).toContain('Sala cerrada.')
  })

  test('sólo la píldora de sincronización vive en la región educada', () => {
    const html = render(mano({ connection: 'connected', sync: 'adjusting' }))
    const conexion = html.match(/<span class="party-bar__connection"[^>]*>/)

    expect(conexion).not.toBeNull()
    expect(conexion?.[0]).not.toContain('aria-live')
    expect(html.match(/aria-live="polite"/g) ?? []).toHaveLength(1)
  })
})

describe('la barra del anfitrión', () => {
  test('quien manda se anuncia como tal, sin medir deriva', () => {
    const html = render(mano({ phase: 'host', connection: 'connected', sync: 'drift' }))

    expect(html).toContain('Coordinando la sala.')
    expect(html).not.toContain('Desincronizado')
  })
})
