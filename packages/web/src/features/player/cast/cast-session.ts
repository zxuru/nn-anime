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
  type CastSessionStateEvent,
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
  /**
   * Manda otro medio por la sesión que ya está abierta.
   *
   * Es el encadenado de episodios: la TV no vuelve a pedir permiso, sólo cambia
   * lo que reproduce. Con la sesión cerrada no inventa una: `iniciar` es el
   * camino que la pide.
   */
  cargar(
    url: string,
    kind: CastKind,
    meta: CastMetadata,
    startAtS?: number,
    subtitles?: readonly CastTrack[],
  ): Promise<void>
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

export function crearCastSesion(
  sdk: CastSdk,
  onEstado: (estado: CastEstado) => void,
  onDesconectar?: () => void,
): CastSesion {
  let estado: CastEstado = CAST_ESTADO_INICIAL
  let session: CastSessionLike | null = null
  let escuchando = false
  let escuchandoSesion = false
  let estabaReproduciendo = false

  const actualizar = (cambio: Partial<CastEstado>): void => {
    estado = { ...estado, ...cambio }
    onEstado(estado)
  }

  const sincronizar = (): void => {
    const remoto = sdk.remote
    const playerState = remoto.playerState ?? ''
    const playing = playerState === 'PLAYING' || (playerState === '' && remoto.isPaused === false)
    const terminado = playerState === 'IDLE' && estabaReproduciendo

    estabaReproduciendo = playing

    actualizar({
      positionS: remoto.currentTime ?? estado.positionS,
      durationS: remoto.duration ?? estado.durationS,
      volume: remoto.volumeLevel ?? estado.volume,
      muted: remoto.isMuted ?? estado.muted,
      playing,
      cargando: playerState === 'BUFFERING',
      terminado,
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

  /**
   * El receptor puede cerrar la sesión sin que el emisor toque nada: la TV se
   * apaga, alguien cambia de destino desde el móvil o se cae la red. Sin este
   * evento, la interfaz sigue diciendo «conectado» y los mandos escriben a una
   * sesión que ya no existe.
   *
   * La posición no se pierde: es lo único que el reproductor local necesita para
   * reanudar donde estaba la TV. El ticket del servidor lo revoca quien llama;
   * aquí no se cierra una sesión que ya está cerrada.
   */
  const alCambiarSesion = (evento: CastSessionStateEvent): void => {
    if (evento.sessionState !== 'SESSION_ENDED') return

    const posicion = estado.positionS
    const duracion = estado.durationS

    session = null
    estabaReproduciendo = false
    dejarDeEscuchar()
    dejarDeEscucharSesion()
    actualizar({ ...CAST_ESTADO_INICIAL, positionS: posicion, durationS: duracion })
    onDesconectar?.()
  }

  const empezarAEscucharSesion = (): void => {
    if (escuchandoSesion) return

    sdk.context.addEventListener?.('sessionstatechanged', alCambiarSesion)
    escuchandoSesion = true
  }

  const dejarDeEscucharSesion = (): void => {
    if (!escuchandoSesion) return

    sdk.context.removeEventListener?.('sessionstatechanged', alCambiarSesion)
    escuchandoSesion = false
  }

  /**
   * La carga de un medio por la sesión ya abierta.
   *
   * `iniciar` pide sesión y llama aquí; `cargar` entra directamente. Lo que hace
   * falta que sea uno solo es el contrato del `loadMedia`: si el encadenado
   * copiara esta parte, el día que cambie el tipo del medio o las pistas habría
   * dos conversaciones distintas con el receptor.
   */
  const cargarMedio = async (
    url: string,
    kind: CastKind,
    meta: CastMetadata,
    startAtS?: number,
    subtitles: readonly CastTrack[] = [],
  ): Promise<void> => {
    if (session === null) throw new Error('no hay ninguna emisión abierta')

    empezarAEscucharSesion()
    estabaReproduciendo = false
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
      positionS: startAtS ?? 0,
      durationS: 0,
      activeTrackId: subtitles[0]?.trackId,
      terminado: false,
      error: undefined,
    })
    sincronizar()
  }

  return {
    async iniciar(url, kind, meta, startAtS, subtitles = []) {
      try {
        sdk.context.setOptions({
          receiverApplicationId: sdk.receiverId,
          autoJoinPolicy: 'origin_scoped',
        })
        await sdk.context.requestSession()

        const actual = sdk.context.getCurrentSession()
        if (actual === null) throw new Error('el receptor no abrió ninguna sesión')

        session = actual

        await cargarMedio(url, kind, meta, startAtS, subtitles)
      } catch (cause) {
        actualizar({
          conectado: false,
          cargando: false,
          error: cause instanceof Error ? cause.message : String(cause),
        })

        throw cause
      }
    },

    async cargar(url, kind, meta, startAtS, subtitles = []) {
      try {
        await cargarMedio(url, kind, meta, startAtS, subtitles)
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
      empezarAEscucharSesion()
      empezarAEscuchar()
      actualizar({
        conectado: true,
        dispositivo: actual.getCastDevice()?.friendlyName,
        cargando: false,
        terminado: false,
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
      estabaReproduciendo = false
      dejarDeEscuchar()
      dejarDeEscucharSesion()
      actualizar(CAST_ESTADO_INICIAL)
    },

    cerrar() {
      dejarDeEscuchar()
      dejarDeEscucharSesion()
    },

    estado() {
      return estado
    },
  }
}
