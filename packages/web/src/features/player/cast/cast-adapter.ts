/**
 * El adapter entre el SDK real y la forma que usa la emisión.
 *
 * Es el único archivo que sabe que el SDK vive en `chrome.cast` y
 * `cast.framework`. Si no está cargado, devuelve `undefined` y la interfaz no
 * ofrece el mando: no hay nada que fingir.
 */

import type {
  CastContextLike,
  CastController,
  CastKind,
  CastLoadRequest,
  CastMedia,
  CastMetadata,
  CastRemotePlayer,
  CastSdk,
} from './cast-types'

interface MediaInfoReal {
  contentId: string
  contentType: string
  streamType: string
  metadata?: unknown
  tracks: unknown[]
  activeTrackIds: number[]
}

interface LoadRequestReal {
  media: MediaInfoReal
  currentTime?: number
  autoplay?: boolean
}

interface MediaNamespace {
  MediaInfo: new (contentId: string, contentType: string) => MediaInfoReal
  LoadRequest: new (media: MediaInfoReal) => LoadRequestReal
  GenericMediaMetadata: new () => { title?: string; subtitle?: string; images?: unknown[] }
  StreamType?: { BUFFERED?: string }
  DEFAULT_MEDIA_RECEIVER_APP_ID?: string
}

interface SessionReal {
  loadMedia(request: LoadRequestReal): Promise<unknown> | unknown
  endSession(stopCasting: boolean): void
  getCastDevice(): { friendlyName?: string } | undefined
}

interface ContextReal {
  requestSession(): Promise<unknown>
  getCurrentSession(): SessionReal | null
  setOptions(options: { receiverApplicationId: string; autoJoinPolicy: string }): void
}

interface FrameworkReal {
  CastContext?: { getInstance(): ContextReal }
  RemotePlayer?: new () => CastRemotePlayer
  RemotePlayerController?: new (player: CastRemotePlayer) => CastController
}

interface VentanaConCast extends Window {
  chrome?: { cast?: { media?: MediaNamespace } }
  cast?: { framework?: FrameworkReal }
}

/** El adapter, o `undefined` si el SDK no está cargado. */
export function adaptarCastSdk(): CastSdk | undefined {
  if (typeof window === 'undefined') return undefined

  const ventana = window as unknown as VentanaConCast
  const media = ventana.chrome?.cast?.media
  const framework = ventana.cast?.framework
  const Contexto = framework?.CastContext
  const RemotePlayer = framework?.RemotePlayer
  const RemotePlayerController = framework?.RemotePlayerController

  if (
    media === undefined ||
    Contexto === undefined ||
    RemotePlayer === undefined ||
    RemotePlayerController === undefined
  ) {
    return undefined
  }

  const context = Contexto.getInstance()
  const remote = new RemotePlayer()
  const controller = new RemotePlayerController(remote)

  const contentType = (kind: CastKind): string =>
    kind === 'hls' ? 'application/vnd.apple.mpegurl' : 'video/mp4'

  return {
    context: context as unknown as CastContextLike,
    receiverId: media.DEFAULT_MEDIA_RECEIVER_APP_ID ?? 'CC1AD845',
    remote,
    controller,
    createMedia(url, kind) {
      const info = new media.MediaInfo(url, contentType(kind))
      info.streamType = media.StreamType?.BUFFERED ?? 'BUFFERED'
      info.tracks = []
      info.activeTrackIds = []

      return info as unknown as CastMedia
    },
    createLoadRequest(mediaInfo) {
      return new media.LoadRequest(
        mediaInfo as unknown as MediaInfoReal,
      ) as unknown as CastLoadRequest
    },
    createMetadata(meta: CastMetadata) {
      const metadata = new media.GenericMediaMetadata()
      if (meta.title !== undefined) metadata.title = meta.title
      if (meta.subtitle !== undefined) metadata.subtitle = meta.subtitle
      if (meta.poster !== undefined) metadata.images = [{ url: meta.poster }]

      return metadata
    },
  }
}
