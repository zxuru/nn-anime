import { describe, expect, test } from 'bun:test'
import {
  crearSesionAirPlay,
  type RemotoLike,
  type VideoAirPlay,
  viaDeAirPlay,
} from './useRemotePlayback'

interface Doble {
  readonly video: VideoAirPlay
  readonly remoto: RemotoLike & { state: 'connected' | 'connecting' | 'disconnected' }
  readonly llamadas: { play: number; pause: number; prompt: number; picker: number }
  readonly emitir: (evento: string) => void
}

function doble(via: 'remote' | 'webkit'): Doble {
  const oyentes = new Map<string, Set<() => void>>()
  const llamadas = { play: 0, pause: 0, prompt: 0, picker: 0 }
  const estado = { paused: true, currentTime: 0, duration: 120, src: '' }

  const remoto = {
    state: 'disconnected' as 'connected' | 'connecting' | 'disconnected',
    prompt: () => {
      llamadas.prompt += 1
      remoto.state = 'connected'
      for (const oyente of oyentes.get('statechange') ?? []) oyente()
    },
    addEventListener: (evento: string, oyente: () => void) => {
      const lista = oyentes.get(evento) ?? new Set()
      lista.add(oyente)
      oyentes.set(evento, lista)
    },
    removeEventListener: (evento: string, oyente: () => void) => {
      oyentes.get(evento)?.delete(oyente)
    },
  }

  const video = {
    get src() {
      return estado.src
    },
    set src(valor: string) {
      estado.src = valor
    },
    get currentTime() {
      return estado.currentTime
    },
    set currentTime(valor: number) {
      estado.currentTime = valor
    },
    get duration() {
      return estado.duration
    },
    get paused() {
      return estado.paused
    },
    volume: 1,
    muted: false,
    play: () => {
      llamadas.play += 1
      estado.paused = false
    },
    pause: () => {
      llamadas.pause += 1
      estado.paused = true
    },
    addEventListener: (evento: string, oyente: () => void) => {
      const lista = oyentes.get(evento) ?? new Set()
      lista.add(oyente)
      oyentes.set(evento, lista)
    },
    removeEventListener: (evento: string, oyente: () => void) => {
      oyentes.get(evento)?.delete(oyente)
    },
    ...(via === 'remote'
      ? { remote: remoto }
      : {
          webkitShowPlaybackTargetPicker: () => {
            llamadas.picker += 1
          },
          webkitCurrentPlaybackTargetIsWireless: false,
        }),
  } as unknown as VideoAirPlay & {
    webkitCurrentPlaybackTargetIsWireless?: boolean
  }

  return {
    video,
    remoto,
    llamadas,
    emitir: (evento) => {
      for (const oyente of oyentes.get(evento) ?? []) oyente()
    },
  }
}

describe('la puerta de AirPlay', () => {
  test('`remote` es la vía estándar y gana cuando existe', () => {
    expect(viaDeAirPlay({ remote: {} })).toBe('remote')
    expect(viaDeAirPlay({ remote: {}, webkitShowPlaybackTargetPicker: () => {} })).toBe('remote')
  })

  test('sin `remote`, la puerta de WebKit ofrece la salida', () => {
    expect(viaDeAirPlay({ webkitShowPlaybackTargetPicker: () => {} })).toBe('webkit')
  })

  test('sin ninguna de las dos no hay mando', () => {
    expect(viaDeAirPlay(undefined)).toBeUndefined()
    expect(viaDeAirPlay(null)).toBeUndefined()
    expect(viaDeAirPlay({})).toBeUndefined()
    expect(viaDeAirPlay({ webkitShowPlaybackTargetPicker: 'no es una función' })).toBeUndefined()
  })
})

describe('la sesión de AirPlay', () => {
  test('carga la URL absoluta, arranca y pide el destino', async () => {
    const d = doble('remote')
    const estados: boolean[] = []
    const sesion = crearSesionAirPlay(d.video, 'remote', (estado) => estados.push(estado.conectado))

    await sesion.iniciar('http://192.168.1.10:7717/stream/ticket', 'hls', {}, 12)

    expect(d.video.src).toBe('http://192.168.1.10:7717/stream/ticket')
    expect(d.video.currentTime).toBe(12)
    expect(d.llamadas.play).toBe(1)
    expect(d.llamadas.prompt).toBe(1)
    expect(estados.at(-1)).toBe(true)
    expect(sesion.estado().dispositivo).toBe('AirPlay')
    expect(sesion.estado().conectado).toBe(true)
  })

  test('la posición y la duración salen del oculto', async () => {
    const d = doble('remote')
    const sesion = crearSesionAirPlay(d.video, 'remote', () => {})
    await sesion.iniciar('http://192.168.1.10:7717/stream/ticket', 'file', {})

    d.video.currentTime = 33
    d.emitir('timeupdate')

    expect(sesion.estado().positionS).toBe(33)
    expect(sesion.estado().durationS).toBe(120)
    expect(sesion.estado().playing).toBe(true)
  })

  test('los mandos mueven el oculto, no el video de la página', async () => {
    const d = doble('remote')
    const sesion = crearSesionAirPlay(d.video, 'remote', () => {})
    await sesion.iniciar('http://192.168.1.10:7717/stream/ticket', 'file', {})

    sesion.seekTo(45)
    expect(d.video.currentTime).toBe(45)

    sesion.setVolume(2)
    expect(d.video.volume).toBe(1)

    sesion.setMuted(true)
    expect(d.video.muted).toBe(true)

    sesion.pause()
    expect(d.video.paused).toBe(true)
    expect(sesion.estado().playing).toBe(false)

    sesion.toggle()
    expect(d.video.paused).toBe(false)
  })

  test('el final se avisa una sola vez y el receptor que se va devuelve la posición', async () => {
    const d = doble('remote')
    const estados: { terminado: boolean; conectado: boolean; positionS: number }[] = []
    const sesion = crearSesionAirPlay(d.video, 'remote', (estado) =>
      estados.push({
        terminado: estado.terminado,
        conectado: estado.conectado,
        positionS: estado.positionS,
      }),
    )
    await sesion.iniciar('http://192.168.1.10:7717/stream/ticket', 'file', {})

    d.video.currentTime = 60
    d.emitir('ended')
    d.emitir('ended')

    expect(estados.filter((estado) => estado.terminado)).toHaveLength(1)

    d.remoto.state = 'disconnected'
    d.emitir('statechange')

    expect(sesion.estado().conectado).toBe(false)
    expect(sesion.estado().positionS).toBe(60)
    expect(d.video.paused).toBe(true)
  })

  test('la rama WebKit usa el selector del sistema y su evento de conexión', async () => {
    const d = doble('webkit')
    const sesion = crearSesionAirPlay(d.video, 'webkit', () => {})
    await sesion.iniciar('http://192.168.1.10:7717/stream/ticket', 'hls', {})

    expect(d.llamadas.picker).toBe(1)

    const conWebKit = d.video as unknown as { webkitCurrentPlaybackTargetIsWireless: boolean }
    conWebKit.webkitCurrentPlaybackTargetIsWireless = true
    d.emitir('webkitcurrentplaybacktargetiswireless')

    expect(sesion.estado().conectado).toBe(true)
  })

  test('detener para el oculto y devuelve la posición', async () => {
    const d = doble('remote')
    const sesion = crearSesionAirPlay(d.video, 'remote', () => {})
    await sesion.iniciar('http://192.168.1.10:7717/stream/ticket', 'file', {}, 5)

    d.video.currentTime = 41

    expect(sesion.detener()).toBe(41)
    expect(d.video.paused).toBe(true)
    expect(sesion.estado().conectado).toBe(false)
  })
})
