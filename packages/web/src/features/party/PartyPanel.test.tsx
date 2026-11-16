import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { PartyPanel } from './PartyPanel'
import type { PartyHandle } from './useParty'

/**
 * El panel de la sala, pintado sin navegador.
 *
 * `renderToString` no ejecuta efectos: el `showModal` no ocurre y el contenido
 * se mide tal y como se sirve. Con eso basta para lo que tiene que sujetar esta
 * prueba: que en reposo se ofrezcan las dos puertas, que el error se anuncie, y
 * que la sala abierta enseñe el código, el roster y el botón que toca.
 */

function mano(overrides: Partial<PartyHandle> = {}): PartyHandle {
  return {
    phase: 'idle',
    room: undefined,
    roster: [],
    connection: 'closed',
    sync: 'unknown',
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

function render(party: PartyHandle, canHost = true, initialTab?: 'crear' | 'unirse'): string {
  return renderToString(
    <PartyPanel
      party={party}
      canHost={canHost}
      {...(initialTab === undefined ? {} : { initialTab })}
      onClose={() => {}}
    />,
  )
}

describe('el panel en reposo', () => {
  test('es un diálogo con las dos puertas: crear y unirse', () => {
    const html = render(mano())

    expect(html).toContain('<dialog')
    expect(html).toContain('Sala de visionado')
    expect(html).toContain('Crear sala')
    expect(html).toContain('Unirse')
  })

  test('la pestaña de unirse pide dirección, código y nombre', () => {
    const html = render(mano(), true, 'unirse')

    expect(html).toContain('Dirección del anfitrión')
    expect(html).toContain('Código de la sala')
    expect(html).toContain('Tu nombre')
    expect(html).toContain('192.168.1.5:7717')
    expect(html).toContain('XXXX-XXXX-XXXX-XXXX')
    expect(html).toContain('Cómo te verán en la sala')
  })

  test('el aviso de crear dice lo que se abre y lo que viaja sin cifrar', () => {
    const html = render(mano())

    expect(html).toContain('abre un puerto en tu red local')
    expect(html).toContain('viaja sin cifrar')
    expect(html).toContain('Cierra la sala al terminar')
  })

  test('la promesa de la sala está dicha: nunca el vídeo ni la fuente', () => {
    const html = render(mano())

    expect(html).toContain('nunca el vídeo')
    expect(html).toContain('la dirección de la fuente')
  })

  test('sin episodio que anunciar, crear sala no se ofrece en falso', () => {
    const html = render(mano(), false)

    expect(html).toContain('hay que estar viendo un episodio')
    expect(html).toContain('disabled')
  })
})

describe('el panel con un fallo', () => {
  test('el último error se anuncia y se traduce, no se enseña la clave', () => {
    const html = render(mano({ error: 'party.error.full', connection: 'error' }))

    expect(html).toContain('role="alert"')
    expect(html).toContain('La sala está llena')
    expect(html).not.toContain('party.error.full')
  })

  test('un enlace caído dice que el anfitrión no responde', () => {
    const html = render(mano({ error: 'party.error.hostUnreachable', connection: 'error' }))

    expect(html).toContain('No se pudo hablar con el anfitrión')
    expect(html).toContain('la misma red')
  })
})

describe('el panel con la sala abierta', () => {
  const sala = {
    roomId: 'sala-1',
    code: 'ABCDEFGHIJKLMNOP',
    expiresAt: 1000,
    urls: ['http://192.168.1.5:7717', 'http://192.168.1.5:7717/'],
  }

  test('enseña el código en grupos de cuatro y el roster con su estado', () => {
    const html = render(
      mano({
        phase: 'guest',
        room: { ...sala, urls: [] },
        connection: 'connected',
        sync: 'ok',
        driftS: 0.2,
        roster: [
          { id: 'ana', name: 'Ana', ready: true, buffering: false },
          { id: 'bea', name: 'Bea', ready: false, buffering: true },
        ],
      }),
    )

    expect(html).toContain('ABCD-EFGH-IJKL-MNOP')
    expect(html).toContain('Ana')
    expect(html).toContain('listo')
    expect(html).toContain('almacenando')
    expect(html).toContain('Sincronizado')
    expect(html).toContain('Salir de la sala')
    // El invitado no invita a nadie: las direcciones son del anfitrión.
    expect(html).not.toContain('Direcciones para invitar')
  })

  test('el anfitrión ve sus direcciones y el botón de cerrar la sala', () => {
    const html = render(mano({ phase: 'host', room: sala, connection: 'connected' }))

    expect(html).toContain('Direcciones para invitar')
    expect(html).toContain('http://192.168.1.5:7717')
    expect(html).toContain('Cerrar la sala')
    expect(html).not.toContain('Salir de la sala')
  })

  test('sin direcciones no se inventa ninguna', () => {
    const html = render(
      mano({ phase: 'host', room: { ...sala, urls: [] }, connection: 'connected' }),
    )

    expect(html).toContain('No se pudieron leer las direcciones')
  })
})
