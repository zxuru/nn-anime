import { describe, expect, test } from 'bun:test'
import {
  ACCIONES_DEL_SISTEMA,
  aplicarEstado,
  aplicarMetadata,
  aplicarPosicion,
  conectarManejadores,
  estadoDeReproduccion,
  liberarManejadores,
  type MediaSessionHandlers,
  type MediaSessionPort,
  metadataDeLaSesion,
  posicionDeLaSesion,
  registrarManejadores,
  sesionDeMedios,
} from './useMediaSession'

/**
 * Un doble de `navigator.mediaSession`.
 *
 * El entorno de las pruebas no tiene DOM ni la clase `MediaMetadata`, así que la
 * lógica que se puede medir es la que recibe la sesión como argumento: el
 * gancho sólo la llama desde sus efectos. El doble guarda lo último que le
 * dejaron en cada propiedad, que es lo que la pantalla de bloqueo leería.
 */
class SesionFalsa implements MediaSessionPort {
  metadata: MediaMetadataInit | null = null
  playbackState: MediaSessionPlaybackState = 'none'
  readonly manejadores = new Map<MediaSessionAction, MediaSessionActionHandler | null>()
  readonly posiciones: MediaPositionState[] = []

  setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void {
    this.manejadores.set(action, handler)
  }

  setPositionState(state?: MediaPositionState): void {
    if (state !== undefined) this.posiciones.push(state)
  }
}

const MANEJADORES: MediaSessionHandlers = {
  play: () => {},
  pause: () => {},
  seekbackward: () => {},
  seekforward: () => {},
  seekto: () => {},
}

describe('la sesión del sistema', () => {
  test('sin navegador o sin `mediaSession` no hay sesión', () => {
    // Es el caso del renderizado de servidor y el de un navegador viejo: el
    // gancho tiene que poder montarse sin que nada lance.
    expect(sesionDeMedios(undefined)).toBeUndefined()
    expect(sesionDeMedios({})).toBeUndefined()
  })

  test('con `mediaSession` se usa la del navegador', () => {
    const sesion = new SesionFalsa()

    expect(sesionDeMedios({ mediaSession: sesion })).toBe(sesion)
  })
})

describe('la metadata de la pantalla de bloqueo', () => {
  test('el nombre completo se reparte entre la obra y el episodio', () => {
    expect(metadataDeLaSesion('Aurora Nocturna · Episodio 3', '/api/cover/aurora')).toEqual({
      title: 'Episodio 3',
      artist: 'Aurora Nocturna',
      artwork: [{ src: '/api/cover/aurora' }],
    })
  })

  test('un episodio con su propio título conserva el separador de dentro', () => {
    expect(metadataDeLaSesion('Aurora Nocturna · Episodio 3 · El faro', undefined)).toEqual({
      title: 'Episodio 3 · El faro',
      artist: 'Aurora Nocturna',
    })
  })

  test('sin episodio, el nombre entero es el título y no hay artista inventado', () => {
    expect(metadataDeLaSesion('Aurora Nocturna', undefined)).toEqual({
      title: 'Aurora Nocturna',
    })
  })

  test('sin título se usa el nombre del reproductor, como en el resto de la aplicación', () => {
    expect(metadataDeLaSesion(undefined, undefined)).toEqual({ title: 'Reproductor de video' })
  })

  test('el asignado se puede medir sin la clase del navegador', () => {
    const sesion = new SesionFalsa()
    const metadata = { title: 'Episodio 3', artist: 'Aurora Nocturna' }

    aplicarMetadata(sesion, metadata, (init) => init)

    expect(sesion.metadata).toEqual(metadata)
  })

  test('un navegador que no puede construir la metadata no rompe nada', () => {
    const sesion = new SesionFalsa()

    // El servidor no tiene la clase `MediaMetadata`: el asignado se salta y la
    // sesión —si existiera— se queda como estaba.
    aplicarMetadata(sesion, { title: 'Episodio 3' }, () => undefined)

    expect(sesion.metadata).toBeNull()
  })
})

describe('el estado de reproducción', () => {
  test('suena, está en pausa o todavía no hay nada', () => {
    expect(estadoDeReproduccion(true, 1440)).toBe('playing')
    expect(estadoDeReproduccion(false, 1440)).toBe('paused')
    expect(estadoDeReproduccion(false, 0)).toBe('none')
    // Un directo no tiene duración finita, pero sí tiene medio que anunciar.
    expect(estadoDeReproduccion(false, Number.POSITIVE_INFINITY)).toBe('paused')
  })

  test('el estado se deja en la sesión', () => {
    const sesion = new SesionFalsa()

    aplicarEstado(sesion, true, 1440)
    expect(sesion.playbackState).toBe('playing')

    aplicarEstado(sesion, false, 1440)
    expect(sesion.playbackState).toBe('paused')

    aplicarEstado(sesion, false, 0)
    expect(sesion.playbackState).toBe('none')
  })
})

describe('la posición que se anuncia', () => {
  test('una duración infinita no llama a `setPositionState`', () => {
    const sesion = new SesionFalsa()

    aplicarPosicion(sesion, 30, Number.POSITIVE_INFINITY)

    expect(sesion.posiciones).toHaveLength(0)
    expect(posicionDeLaSesion(30, Number.POSITIVE_INFINITY)).toBeUndefined()
  })

  test('sin duración conocida tampoco se llama', () => {
    const sesion = new SesionFalsa()

    aplicarPosicion(sesion, 30, 0)

    expect(sesion.posiciones).toHaveLength(0)
  })

  test('con duración finita se anuncia la posición, sin salirse de la duración', () => {
    const sesion = new SesionFalsa()

    aplicarPosicion(sesion, 30, 1440)
    aplicarPosicion(sesion, 2000, 1440)

    expect(sesion.posiciones).toEqual([
      { duration: 1440, position: 30 },
      { duration: 1440, position: 1440 },
    ])
  })

  test('un navegador que rechaza los valores no rompe el reproductor', () => {
    const sesion: MediaSessionPort = {
      metadata: null,
      playbackState: 'none',
      setActionHandler: () => {},
      setPositionState: () => {
        throw new Error('duración no válida')
      },
    }

    expect(() => aplicarPosicion(sesion, 30, 1440)).not.toThrow()
  })
})

describe('los mandos del sistema', () => {
  test('los cinco gestos llaman a los manejadores del reproductor', () => {
    const sesion = new SesionFalsa()
    const llamadas: string[] = []

    registrarManejadores(sesion, {
      play: () => llamadas.push('play'),
      pause: () => llamadas.push('pause'),
      seekbackward: () => llamadas.push('back'),
      seekforward: () => llamadas.push('forward'),
      seekto: (segundos) => llamadas.push(`seekto:${segundos}`),
    })

    sesion.manejadores.get('play')?.({ action: 'play' })
    sesion.manejadores.get('pause')?.({ action: 'pause' })
    sesion.manejadores.get('seekbackward')?.({ action: 'seekbackward' })
    sesion.manejadores.get('seekforward')?.({ action: 'seekforward' })
    sesion.manejadores.get('seekto')?.({ action: 'seekto', seekTime: 42 })
    // Un salto sin destino no puede llevar a nadie a la posición cero.
    sesion.manejadores.get('seekto')?.({ action: 'seekto' })

    expect(llamadas).toEqual(['play', 'pause', 'back', 'forward', 'seekto:42'])
  })

  test('al desmontar se limpian los cinco manejadores', () => {
    const sesion = new SesionFalsa()

    const desconectar = conectarManejadores(sesion, MANEJADORES)
    for (const accion of ACCIONES_DEL_SISTEMA) {
      expect(sesion.manejadores.get(accion)).not.toBeNull()
    }

    desconectar()

    for (const accion of ACCIONES_DEL_SISTEMA) {
      expect(sesion.manejadores.get(accion)).toBeNull()
    }
    // La pantalla de bloqueo no puede quedarse con el episodio que ya se cerró.
    expect(sesion.playbackState).toBe('none')
    expect(sesion.metadata).toBeNull()
  })

  test('sin sesión, atar y soltar no hacen nada ni lanzan', () => {
    const desconectar = conectarManejadores(undefined, MANEJADORES)

    expect(() => desconectar()).not.toThrow()
  })

  test('una acción que el navegador no conoce no impide atar las demás', () => {
    const sesion: MediaSessionPort = {
      metadata: null,
      playbackState: 'none',
      setActionHandler: (action, handler) => {
        if (action === 'seekbackward') throw new Error('no soportada')
        manejadores.set(action, handler)
      },
      setPositionState: () => {},
    }
    const manejadores = new Map<MediaSessionAction, MediaSessionActionHandler | null>()

    registrarManejadores(sesion, MANEJADORES)

    expect(manejadores.get('play')).toBeFunction()
    expect(manejadores.get('seekto')).toBeFunction()
  })

  test('soltar tampoco se lleva por delante las acciones que fallan', () => {
    const sesion: MediaSessionPort = {
      metadata: null,
      playbackState: 'none',
      setActionHandler: (action) => {
        if (action === 'seekforward') throw new Error('no soportada')
      },
      setPositionState: () => {},
    }

    expect(() => liberarManejadores(sesion)).not.toThrow()
  })
})
