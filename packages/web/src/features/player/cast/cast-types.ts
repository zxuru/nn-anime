/**
 * Lo mínimo del SDK de Cast que usa la aplicación.
 *
 * No es un types package: son las propiedades que tocamos, declaradas a mano.
 * Fuera de esta frontera no hay `any`; si el SDK cambia una forma, el adapter
 * deja de compilar en un sitio y no en cada componente.
 */

export type CastKind = 'hls' | 'file'

/** Lo que se manda al receptor para pintar la ficha del título. */
export interface CastMetadata {
  readonly title?: string
  readonly subtitle?: string
  readonly poster?: string
}

/** Una pista de subtítulos del receptor. T394 la rellena. */
export interface CastTrack {
  readonly trackId: number
  readonly trackContentId: string
  readonly trackContentType: string
  readonly subtype: 'SUBTITLES'
  readonly name: string
  readonly language: string
}

/** El `MediaInfo` del SDK, con lo que la emisión toca. */
export interface CastMedia {
  contentId: string
  contentType: string
  streamType: string
  metadata?: unknown
  tracks: CastTrack[]
  activeTrackIds: number[]
}

/** El `LoadRequest` del SDK. */
export interface CastLoadRequest {
  media: CastMedia
  currentTime?: number
  autoplay?: boolean
}

/** El estado del `RemotePlayer` que se lee en cada evento. */
export interface CastRemotePlayer {
  isPaused?: boolean
  currentTime?: number
  duration?: number
  volumeLevel?: number
  isMuted?: boolean
  playerState?: string
  isMediaLoaded?: boolean
}

/** Los mandos del `RemotePlayerController`. */
export interface CastController {
  playOrPause(): void
  seek(): void
  setVolumeLevel(): void
  muteOrUnmute(): void
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

/** La sesión del receptor. */
export interface CastSessionLike {
  loadMedia(request: CastLoadRequest): Promise<unknown> | unknown
  endSession(stopCasting: boolean): void
  getCastDevice(): { friendlyName?: string } | undefined
  getMedia?():
    | { setActiveTrackIds?: ((ids: readonly number[]) => void) | undefined }
    | undefined
}

/** El `CastContext` del SDK. */
export interface CastContextLike {
  requestSession(): Promise<unknown>
  getCurrentSession(): CastSessionLike | null
  setOptions(options: { receiverApplicationId: string; autoJoinPolicy: string }): void
}

/**
 * El SDK ya adaptado. El adapter es el único que conoce `chrome.cast` y
 * `cast.framework`; el resto de la aplicación habla con esta forma.
 */
export interface CastSdk {
  readonly context: CastContextLike
  readonly receiverId: string
  readonly remote: CastRemotePlayer
  readonly controller: CastController
  createMedia(url: string, kind: CastKind): CastMedia
  createLoadRequest(media: CastMedia): CastLoadRequest
  createMetadata?(meta: CastMetadata): unknown
  /** Convierte una pista al objeto real del SDK; sin él, se manda tal cual. */
  createTrack?(track: CastTrack): CastTrack
}

/** Lo que la interfaz pinta del receptor. */
export interface CastEstado {
  readonly conectado: boolean
  readonly dispositivo: string | undefined
  readonly cargando: boolean
  readonly playing: boolean
  readonly positionS: number
  readonly durationS: number
  readonly volume: number
  readonly muted: boolean
  readonly activeTrackId: number | undefined
  readonly terminado: boolean
  readonly error: string | undefined
}

export const CAST_ESTADO_INICIAL: CastEstado = {
  conectado: false,
  dispositivo: undefined,
  cargando: false,
  playing: false,
  positionS: 0,
  durationS: 0,
  volume: 1,
  muted: false,
  activeTrackId: undefined,
  terminado: false,
  error: undefined,
}
