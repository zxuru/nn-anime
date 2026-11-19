/**
 * La emisión, sin React y sin DOM.
 *
 * Pedir sesión, cargar el medio, escuchar al receptor y mandar los botones. La
 * interfaz de T384a sólo traduce sus botones y su teclado a esta forma; aquí no
 * hay componentes, así que se puede medir con un SDK falso.
 */

import {
  CAST_ESTADO_INICIAL,
  type CastEstado,
  type CastKind,
  type CastMetadata,
  type CastSdk,
  type CastSessionLike,
  type CastTrack,
} from './cast-types'

export interface CastSesion {
  /** Pide sesión si hace falta y manda el medio. */
  iniciar(
    url: string,
    kind: CastKind,
    meta: CastMetadata,
    startAtS?: number,
    subtitles?: readonly CastTrack[],
  ): Promise<void>
  /** Adopta una sesión que ya existía (recarga, reconexión). */
  adoptar(session: CastSessionLike): void
  /** Activa una pista de subtítulos por su id de receptor. */
  selectSubtitle(trackId: number): void
  play(): void
  pause(): void
  toggle(): void
  seekTo(positionS: number): void
  setVolume(volume: number): void
  setMuted(muted: boolean): void
  /** Cierra la sesión y deja de escuchar. */
  detener(): void
  /** Sólo deja de escuchar; no apaga la TV. */
  cerrar(): void
  estado(): CastEstado
}

function clavar(valor: number, min: number, max: number): number {
  if (!Number.isFinite(valor)) return min

  return Math.min(Math.max(valor, min), max)
}

export function crearCastSesion(sdk: CastSdk, onEstado: (estado: CastEstado) => void): CastSesion {
  let estado: CastEstado = CAST_ESTADO_INICIAL
  let session: CastSessionLike | null = null
  let escuchando = false

  const actualizar = (cambio: Partial<CastEstado>): void => {
    estado = { ...estado, ...cambio }
    onEstado(estado)
  }

  const sincronizar = (): void => {
    const remoto = sdk.remote
    const playerState = remoto.playerState ?? ''

    actualizar({
      positionS: remoto.currentTime ?? estado.positionS,
      durationS: remoto.duration ?? estado.durationS,
      volume: remoto.volumeLevel ?? estado.volume,
      muted: remoto.isMuted ?? estado.muted,
      playing: playerState === 'PLAYING' || (playerState === '' && remoto.isPaused === false),
      cargando: playerState === 'BUFFERING',
    })
  }

  const empezarAEscuchar = (): void => {
    if (escuchando) return

    for (const evento of [
      'currentTimeChanged',
      'durationChanged',
      'volumeChanged',
      'mutedChanged',
      'playerStateChanged',
      'isMediaLoadedChanged',
    ]) {
      sdk.controller.addEventListener(evento, sincronizar)
    }

    escuchando = true
  }

  const dejarDeEscuchar = (): void => {
    if (!escuchando) return

    for (const evento of [
      'currentTimeChanged',
      'durationChanged',
      'volumeChanged',
      'mutedChanged',
      'playerStateChanged',
      'isMediaLoadedChanged',
    ]) {
      sdk.controller.removeEventListener(evento, sincronizar)
    }

    escuchando = false
  }

  return {
    async iniciar(url, kind, meta, startAtS, subtitles = []) {      try {
        sdk.context.setOptions({
          receiverApplicationId: sdk.receiverId,
          autoJoinPolicy: 'origin_scoped',
        })
        await sdk.context.requestSession()

        const actual = sdk.context.getCurrentSession()
        if (actual === null) throw new Error('el receptor no abrió ninguna sesión')

        session = actual

        const media = sdk.createMedia(url, kind)
        media.tracks = subtitles.map((pista) => sdk.createTrack?.(pista) ?? pista)
        media.activeTrackIds = subtitles[0] === undefined ? [] : [subtitles[0].trackId]

        const metadata = sdk.createMetadata?.(meta)
        if (metadata !== undefined) media.metadata = metadata

        const request = sdk.createLoadRequest(media)
        request.currentTime = startAtS ?? 0
        request.autoplay = true

        await Promise.resolve(session.loadMedia(request))

        empezarAEscuchar()
        actualizar({
          conectado: true,
          dispositivo: session.getCastDevice()?.friendlyName,
          cargando: true,
          activeTrackId: subtitles[0]?.trackId,
          error: undefined,
        })
        sincronizar()
      } catch (cause) {
        actualizar({
          conectado: false,
          cargando: false,
          error: cause instanceof Error ? cause.message : String(cause),
        })

        throw cause
      }
    },

    adoptar(actual) {
      session = actual
      empezarAEscuchar()
      actualizar({
        conectado: true,
        dispositivo: actual.getCastDevice()?.friendlyName,
        cargando: false,
        error: undefined,
      })
      sincronizar()
    },

    selectSubtitle(trackId) {
      session?.getMedia?.()?.setActiveTrackIds?.([trackId])
      actualizar({ activeTrackId: trackId })
    },

    play() {
      if (sdk.remote.isPaused !== false) {
        sdk.remote.isPaused = false
        sdk.controller.playOrPause()
        actualizar({ playing: true })
      }
    },

    pause() {
      if (sdk.remote.isPaused !== true) {
        sdk.remote.isPaused = true
        sdk.controller.playOrPause()
        actualizar({ playing: false })
      }
    },

    toggle() {
      const vaAReproducir = sdk.remote.isPaused === true
      sdk.remote.isPaused = !vaAReproducir
      sdk.controller.playOrPause()
      actualizar({ playing: vaAReproducir })
    },

    seekTo(positionS) {
      const destino = Math.max(0, positionS)
      sdk.remote.currentTime = destino
      sdk.controller.seek()
      actualizar({ positionS: destino })
    },

    setVolume(volume) {
      const valor = clavar(volume, 0, 1)
      sdk.remote.volumeLevel = valor
      sdk.controller.setVolumeLevel()
      actualizar({ volume: valor })
    },

    setMuted(muted) {
      if (sdk.remote.isMuted === muted) return

      sdk.remote.isMuted = muted
      sdk.controller.muteOrUnmute()
      actualizar({ muted })
    },

    detener() {
      session?.endSession(true)
      session = null
      dejarDeEscuchar()
      actualizar(CAST_ESTADO_INICIAL)
    },

    cerrar() {
      dejarDeEscuchar()
    },

    estado() {
      return estado
    },
  }
}
