import { describe, expect, test } from 'bun:test'
import { crearCastSesion } from './cast-session'
import type {
  CastContextLike,
  CastController,
  CastEstado,
  CastLoadRequest,
  CastMedia,
  CastRemotePlayer,
  CastSdk,
  CastSessionLike,
} from './cast-types'

interface Doble {
  readonly sdk: CastSdk
  readonly remote: CastRemotePlayer
  readonly media: CastMedia[]
  readonly load: CastLoadRequest[]
  readonly opciones: { receiverApplicationId: string; autoJoinPolicy: string }[]
  readonly sesion: {
    end: boolean[]
  }
  readonly llamadas: {
    playOrPause: number
    seek: number
    setVolumeLevel: number
    muteOrUnmute: number
  }
  readonly emitir: (evento: string) => void
}

function doble(device = 'Salón'): Doble {
  const media: CastMedia[] = []
  const load: CastLoadRequest[] = []
  const opciones: { receiverApplicationId: string; autoJoinPolicy: string }[] = []
  const end: boolean[] = []
  const llamadas = { playOrPause: 0, seek: 0, setVolumeLevel: 0, muteOrUnmute: 0 }
  const remote: CastRemotePlayer = {
    isPaused: true,
    currentTime: 0,
    duration: 100,
    volumeLevel: 0.5,
    isMuted: false,
    playerState: 'PAUSED',
  }
  const oyentes = new Map<string, Set<() => void>>()

  const controller: CastController = {
    playOrPause: () => {
      llamadas.playOrPause += 1
    },
    seek: () => {
      llamadas.seek += 1
    },
    setVolumeLevel: () => {
      llamadas.setVolumeLevel += 1
    },
    muteOrUnmute: () => {
      llamadas.muteOrUnmute += 1
    },
    addEventListener: (evento, oyente) => {
      const lista = oyentes.get(evento) ?? new Set()
      lista.add(oyente)
      oyentes.set(evento, lista)
    },
    removeEventListener: (evento, oyente) => {
      oyentes.get(evento)?.delete(oyente)
    },
  }

  const session: CastSessionLike = {
    loadMedia: (request) => {
      load.push(request)

      return Promise.resolve({})
    },
    endSession: (stopCasting) => {
      end.push(stopCasting)
    },
    getCastDevice: () => ({ friendlyName: device }),
  }

  const context: CastContextLike = {
    requestSession: () => Promise.resolve({}),
    getCurrentSession: () => session,
    setOptions: (value) => {
      opciones.push(value)
    },
  }

  const sdk: CastSdk = {
    context,
    receiverId: 'CC1AD845',
    remote,
    controller,
    createMedia: (url, kind) => {
      const info: CastMedia = {
        contentId: url,
        contentType: kind === 'hls' ? 'application/vnd.apple.mpegurl' : 'video/mp4',
        streamType: 'BUFFERED',
        tracks: [],
        activeTrackIds: [],
      }
      media.push(info)

      return info
    },
    createLoadRequest: (info) => ({ media: info }),
    createMetadata: (meta) => ({ title: meta.title }),
  }

  return {
    sdk,
    remote,
    media,
    load,
    opciones,
    sesion: { end },
    llamadas,
    emitir: (evento) => {
      for (const oyente of oyentes.get(evento) ?? []) oyente()
    },
  }
}

function conEstado(): {
  readonly estados: CastEstado[]
  readonly onEstado: (e: CastEstado) => void
} {
  const estados: CastEstado[] = []

  return { estados, onEstado: (estado) => estados.push(estado) }
}

describe('la emisión', () => {
  test('pide sesión, manda HLS con su tipo y metadatos', async () => {
    const d = doble()
    const s = conEstado()
    const emision = crearCastSesion(d.sdk, s.onEstado)

    await emision.iniciar(
      'http://192.168.1.10:7717/stream/abc',
      'hls',
      { title: 'Aurora', subtitle: 'Ep. 1', poster: '/api/cover/x' },
      12,
    )

    expect(d.opciones[0]).toEqual({
      receiverApplicationId: 'CC1AD845',
      autoJoinPolicy: 'origin_scoped',
    })
    expect(d.load[0]?.media.contentType).toBe('application/vnd.apple.mpegurl')
    expect(d.load[0]?.media.contentId).toBe('http://192.168.1.10:7717/stream/abc')
    expect(d.load[0]?.media.metadata).toEqual({ title: 'Aurora' })
    expect(d.load[0]?.currentTime).toBe(12)
    expect(d.load[0]?.autoplay).toBe(true)

    const estado = emision.estado()
    expect(estado.conectado).toBe(true)
    expect(estado.dispositivo).toBe('Salón')
  })

  test('manda MP4 con `video/mp4` y escucha el estado del receptor', async () => {
    const d = doble()
    const s = conEstado()
    const emision = crearCastSesion(d.sdk, s.onEstado)

    await emision.iniciar('/stream/abc', 'file', {})
    expect(d.media[0]?.contentType).toBe('video/mp4')

    d.remote.playerState = 'PLAYING'
    d.remote.isPaused = false
    d.remote.currentTime = 42
    d.remote.duration = 120
    d.emitir('playerStateChanged')

    expect(emision.estado().playing).toBe(true)
    expect(emision.estado().positionS).toBe(42)
    expect(emision.estado().durationS).toBe(120)
    expect(s.estados.at(-1)?.playing).toBe(true)
  })

  test('los mandos hablan con el receptor', async () => {
    const d = doble()
    const emision = crearCastSesion(d.sdk, () => {})
    await emision.iniciar('/stream/abc', 'file', {})

    emision.play()
    expect(d.llamadas.playOrPause).toBe(1)

    d.remote.isPaused = false
    emision.pause()
    expect(d.llamadas.playOrPause).toBe(2)

    emision.seekTo(33)
    expect(d.remote.currentTime).toBe(33)
    expect(d.llamadas.seek).toBe(1)
    expect(emision.estado().positionS).toBe(33)

    emision.setVolume(2)
    expect(d.remote.volumeLevel).toBe(1)
    expect(d.llamadas.setVolumeLevel).toBe(1)

    emision.setMuted(true)
    expect(d.llamadas.muteOrUnmute).toBe(1)
    emision.setMuted(true)
    expect(d.llamadas.muteOrUnmute).toBe(1)
  })

  test('detener cierra la sesión, deja de escuchar y vuelve al estado inicial', async () => {
    const d = doble()
    const emision = crearCastSesion(d.sdk, () => {})
    await emision.iniciar('/stream/abc', 'file', {})

    d.remote.playerState = 'PLAYING'
    emision.detener()

    expect(d.sesion.end).toEqual([true])
    expect(emision.estado().conectado).toBe(false)
    expect(emision.estado().playing).toBe(false)

    d.remote.currentTime = 77
    d.emitir('currentTimeChanged')
    expect(emision.estado().positionS).toBe(0)
  })

  test('adoptar una sesión existente no vuelve a pedirla', () => {
    const d = doble('TV del salón')
    const emision = crearCastSesion(d.sdk, () => {})
    const actual = d.sdk.context.getCurrentSession()

    expect(actual).not.toBeNull()
    if (actual === null) return

    emision.adoptar(actual)

    expect(emision.estado().conectado).toBe(true)
    expect(emision.estado().dispositivo).toBe('TV del salón')
  })

  test('si no hay sesión, lo dice y no deja «conectado»', async () => {
    const d = doble()
    d.sdk.context.getCurrentSession = () => null
    const s = conEstado()
    const emision = crearCastSesion(d.sdk, s.onEstado)

    await expect(emision.iniciar('/stream/abc', 'file', {})).rejects.toThrow(
      'el receptor no abrió ninguna sesión',
    )

    expect(emision.estado().conectado).toBe(false)
    expect(emision.estado().error).toContain('ninguna sesión')
    expect(s.estados.at(-1)?.error).toContain('ninguna sesión')
  })
})
