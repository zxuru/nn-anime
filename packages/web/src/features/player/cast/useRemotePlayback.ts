/**
 * AirPlay: la emisión desde Safari, sin SDK y sin tocar el `<video>` principal.
 *
 * Safari reproduce HLS nativo y ofrece dos puertas: la estándar
 * `HTMLMediaElement.remote` (`RemotePlayback`, con `prompt()` y `statechange`) y
 * la de WebKit (`webkitShowPlaybackTargetPicker` con
 * `webkitCurrentPlaybackTargetIsWireless`). No todas las versiones tienen la
 * misma, y un mando que sólo puede fallar es peor que no tenerlo: la decisión de
 * si existe vive en `viaDeAirPlay`, que se prueba con dobles.
 *
 * El elemento que se manda no es el de la página: su `src` es relativo
 * (`/stream/...`) y la TV no puede resolverlo. Se usa un `<video>` oculto con la
 * **URL absoluta de la sesión de emisión** (T381) y el `<video>` visible se
 * pausa mientras dura. Al desconectar, la posición del oculto vuelve al
 * reproductor local.
 *
 * La medida con un Apple TV real sigue pendiente de hardware; aquí se mide con
 * un doble de `remote` y de la puerta WebKit, y lo que no se ha medido se dice.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { abrirCastSesion, cerrarCastSesion, leerCastInfo } from '../../../api/cast'
import {
  CAST_ESTADO_INICIAL,
  type CastEstado,
  type CastKind,
  type CastMetadata,
  type CastTrack,
} from './cast-types'

export type ViaAirPlay = 'remote' | 'webkit'

/** Lo mínimo del `RemotePlayback` que se usa, para poder doblarlo. */
export interface RemotoLike {
  readonly state?: 'connected' | 'connecting' | 'disconnected' | undefined
  readonly prompt?: (() => Promise<void> | void) | undefined
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

/** Lo que se toca de un `<video>` para emitir por AirPlay. */
export interface VideoAirPlay {
  src: string
  currentTime: number
  duration: number
  readonly paused: boolean
  volume: number
  muted: boolean
  readonly remote?: RemotoLike | undefined
  readonly webkitShowPlaybackTargetPicker?: (() => void) | undefined
  readonly webkitCurrentPlaybackTargetIsWireless?: boolean | undefined
  play(): Promise<void> | void
  pause(): void
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

/** La misma superficie que la sesión de Cast, para que el reproductor no distinga. */
export interface AirPlaySesion {
  iniciar(
    url: string,
    kind: CastKind,
    meta: CastMetadata,
    startAtS?: number,
    subtitles?: readonly CastTrack[],
  ): Promise<void>
  cargar(url: string, kind: CastKind, meta: CastMetadata, startAtS?: number): Promise<void>
  selectSubtitle(trackId: number): void
  play(): void
  pause(): void
  toggle(): void
  seekTo(positionS: number): void
  setVolume(volume: number): void
  setMuted(muted: boolean): void
  detener(): number
  cerrar(): void
  estado(): CastEstado
}

/**
 * ¿Por dónde puede salir este elemento?
 *
 * Se pregunta en ese orden porque `remote` es la vía estándar y la única que
 * informa del estado con un evento. Sin ninguna de las dos, no hay mando.
 */
export function viaDeAirPlay(dispositivo: unknown): ViaAirPlay | undefined {
  if (typeof dispositivo !== 'object' || dispositivo === null) return undefined

  const video = dispositivo as Partial<VideoAirPlay>

  if (video.remote !== undefined && video.remote !== null) return 'remote'
  if (typeof video.webkitShowPlaybackTargetPicker === 'function') return 'webkit'

  return undefined
}

function clavar(valor: number, min: number, max: number): number {
  if (!Number.isFinite(valor)) return min

  return Math.min(Math.max(valor, min), max)
}

const EVENTOS_DE_MEDIO: readonly string[] = [
  'timeupdate',
  'durationchange',
  'loadedmetadata',
  'play',
  'pause',
  'seeking',
  'seeked',
  'volumechange',
]

/**
 * La sesión de AirPlay sobre un `<video>` oculto.
 *
 * No pide sesión al receptor: eso lo hace el gancho con el servidor, porque la
 * URL absoluta y el ticket son de la emisión y no del navegador. Aquí sólo se
 * carga el medio, se sigue su reloj y se traducen los mandos del reproductor.
 */
export function crearSesionAirPlay(
  video: VideoAirPlay,
  via: ViaAirPlay,
  onEstado: (estado: CastEstado) => void,
): AirPlaySesion {
  let estado: CastEstado = { ...CAST_ESTADO_INICIAL, dispositivo: 'AirPlay' }
  let escuchando = false
  let terminadoAvisado = false

  const actualizar = (cambio: Partial<CastEstado>): void => {
    estado = { ...estado, ...cambio }
    onEstado(estado)
  }

  const leerMedio = (): void => {
    const duration = Number.isFinite(video.duration) ? video.duration : estado.durationS
    const positionS = Number.isFinite(video.currentTime) ? video.currentTime : estado.positionS
    const reproduciendo = !video.paused

    if (video.paused) terminadoAvisado = false

    actualizar({
      positionS,
      durationS: duration,
      playing: reproduciendo,
      volume: video.volume,
      muted: video.muted,
      cargando: false,
    })
  }

  const alTerminar = (): void => {
    if (terminadoAvisado) return

    terminadoAvisado = true
    actualizar({ playing: false, terminado: true })
  }

  const leerConexion = (): void => {
    const conectado =
      via === 'remote'
        ? video.remote?.state === 'connected'
        : video.webkitCurrentPlaybackTargetIsWireless === true

    if (!conectado) {
      // El receptor se ha ido: el oculto no puede seguir sonando en la pestaña
      // como si nada. La posición se conserva para que el reproductor local
      // reanude donde estaba la TV.
      video.pause()
      leerMedio()
    }

    actualizar({ conectado })
  }

  const empezarAEscuchar = (): void => {
    if (escuchando) return

    for (const evento of EVENTOS_DE_MEDIO) video.addEventListener(evento, leerMedio)
    video.addEventListener('ended', alTerminar)

    if (via === 'remote') {
      video.remote?.addEventListener('statechange', leerConexion)
    } else {
      video.addEventListener('webkitcurrentplaybacktargetiswireless', leerConexion)
    }

    escuchando = true
  }

  const dejarDeEscuchar = (): void => {
    if (!escuchando) return

    for (const evento of EVENTOS_DE_MEDIO) video.removeEventListener(evento, leerMedio)
    video.removeEventListener('ended', alTerminar)

    if (via === 'remote') {
      video.remote?.removeEventListener('statechange', leerConexion)
    } else {
      video.removeEventListener('webkitcurrentplaybacktargetiswireless', leerConexion)
    }

    escuchando = false
  }

  const cargarMedio = async (url: string, startAtS = 0): Promise<void> => {
    terminadoAvisado = false
    video.src = url
    video.currentTime = Math.max(0, startAtS)
    empezarAEscuchar()

    actualizar({
      conectado: false,
      dispositivo: 'AirPlay',
      cargando: true,
      positionS: Math.max(0, startAtS),
      durationS: 0,
      terminado: false,
      error: undefined,
    })

    await Promise.resolve(video.play())
    leerMedio()
  }

  return {
    async iniciar(url, _kind, _meta, startAtS = 0) {
      try {
        await cargarMedio(url, startAtS)

        if (via === 'remote') await Promise.resolve(video.remote?.prompt?.())
        else video.webkitShowPlaybackTargetPicker?.()
      } catch (cause) {
        actualizar({
          conectado: false,
          cargando: false,
          error: cause instanceof Error ? cause.message : String(cause),
        })

        throw cause
      }
    },

    async cargar(url, _kind, _meta, startAtS = 0) {
      await cargarMedio(url, startAtS)
    },

    selectSubtitle(trackId) {
      // Safari decide con las pistas del propio elemento. El gancho las monta
      // con la URL absoluta de la sesión; aquí sólo se recuerda la elegida.
      actualizar({ activeTrackId: trackId })
    },

    play() {
      void Promise.resolve(video.play()).catch(() => {})
      actualizar({ playing: true })
    },

    pause() {
      video.pause()
      actualizar({ playing: false })
    },

    toggle() {
      if (video.paused) {
        void Promise.resolve(video.play()).catch(() => {})
        actualizar({ playing: true })
      } else {
        video.pause()
        actualizar({ playing: false })
      }
    },

    seekTo(positionS) {
      const destino = Math.max(0, positionS)
      video.currentTime = destino
      actualizar({ positionS: destino })
    },

    setVolume(volume) {
      const valor = clavar(volume, 0, 1)
      video.volume = valor
      actualizar({ volume: valor })
    },

    setMuted(muted) {
      video.muted = muted
      actualizar({ muted })
    },

    detener() {
      const posicion = Number.isFinite(video.currentTime) ? video.currentTime : estado.positionS
      video.pause()
      dejarDeEscuchar()
      actualizar({ ...CAST_ESTADO_INICIAL, dispositivo: 'AirPlay' })

      return posicion
    },

    cerrar() {
      dejarDeEscuchar()
    },

    estado() {
      return estado
    },
  }
}

export interface UseRemotePlaybackOptions {
  readonly url: string
  readonly kind: CastKind
  readonly title?: string | undefined
  readonly subtitle?: string | undefined
  readonly poster?: string | undefined
  readonly positionS: number
  readonly tracks?:
    | readonly { readonly url: string; readonly lang: string; readonly label: string }[]
    | undefined
}

export interface RemotePlaybackHandle {
  readonly disponible: boolean
  readonly conectado: boolean
  readonly estado: CastEstado
  readonly cargando: boolean
  readonly error: string | undefined
  readonly sesion: AirPlaySesion | undefined
  activar: () => Promise<boolean>
  detener: () => Promise<number>
}

function conEstiloOculto(video: HTMLVideoElement): void {
  video.playsInline = true
  video.preload = 'auto'
  video.setAttribute('aria-hidden', 'true')
  video.tabIndex = -1
  video.style.position = 'fixed'
  video.style.width = '1px'
  video.style.height = '1px'
  video.style.opacity = '0'
  video.style.pointerEvents = 'none'
  video.style.left = '-9999px'
}

/** Monta las pistas con la URL absoluta que devolvió la sesión de emisión. */
function montarPistas(
  video: HTMLVideoElement,
  pistas: readonly { readonly url: string; readonly lang: string; readonly label: string }[],
): void {
  pistas.forEach((pista, indice) => {
    const elementoTrack = document.createElement('track')
    elementoTrack.kind = 'subtitles'
    elementoTrack.src = pista.url
    elementoTrack.srclang = pista.lang
    elementoTrack.label = pista.label
    elementoTrack.default = indice === 0
    video.appendChild(elementoTrack)
  })
}

export function useRemotePlayback(options: UseRemotePlaybackOptions): RemotePlaybackHandle {
  const [via, setVia] = useState<ViaAirPlay | undefined>(undefined)
  const [servidor, setServidor] = useState(false)
  const [estado, setEstado] = useState<CastEstado>({
    ...CAST_ESTADO_INICIAL,
    dispositivo: 'AirPlay',
  })
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [sesion, setSesion] = useState<AirPlaySesion | undefined>(undefined)

  const sesionRef = useRef<AirPlaySesion | undefined>(undefined)
  const videoRef = useRef<HTMLVideoElement | undefined>(undefined)
  const idRef = useRef<string | undefined>(undefined)
  const estadoRef = useRef(estado)
  const urlRef = useRef(options.url)
  const kindRef = useRef(options.kind)
  const titleRef = useRef(options.title)
  const subtitleRef = useRef(options.subtitle)
  const posterRef = useRef(options.poster)
  const positionRef = useRef(options.positionS)
  const tracksRef = useRef(options.tracks)

  urlRef.current = options.url
  kindRef.current = options.kind
  titleRef.current = options.title
  subtitleRef.current = options.subtitle
  posterRef.current = options.poster
  positionRef.current = options.positionS
  tracksRef.current = options.tracks
  estadoRef.current = estado

  useEffect(() => {
    if (typeof document === 'undefined') return

    setVia(viaDeAirPlay(document.createElement('video')))

    let vigente = true

    leerCastInfo()
      .then((info) => {
        if (vigente) setServidor(info.available)
      })
      .catch(() => {
        if (vigente) setServidor(false)
      })

    return () => {
      vigente = false
    }
  }, [])

  const disponible = via !== undefined && servidor

  const limpiar = useCallback((): void => {
    sesionRef.current?.cerrar()
    sesionRef.current = undefined
    setSesion(undefined)

    const video = videoRef.current
    videoRef.current = undefined
    if (video !== undefined) {
      video.pause()
      video.remove()
    }

    const id = idRef.current
    idRef.current = undefined
    if (id !== undefined) void cerrarCastSesion(id).catch(() => {})
  }, [])

  useEffect(() => {
    return () => {
      limpiar()
    }
  }, [limpiar])

  const detener = useCallback(async (): Promise<number> => {
    const posicion = sesionRef.current?.detener() ?? estadoRef.current.positionS

    limpiar()
    setCargando(false)

    return posicion
  }, [limpiar])

  const activar = useCallback(async (): Promise<boolean> => {
    if (!disponible || cargando) return false

    setCargando(true)
    setError(undefined)

    let id: string | undefined
    let video: HTMLVideoElement | undefined

    try {
      const alta = await abrirCastSesion({
        url: urlRef.current,
        kind: kindRef.current,
        ...(titleRef.current === undefined ? {} : { title: titleRef.current }),
        ...(posterRef.current === undefined ? {} : { poster: posterRef.current }),
        startAtS: positionRef.current,
        ...(tracksRef.current === undefined || tracksRef.current.length === 0
          ? {}
          : {
              subtitles: tracksRef.current.map((pista) => ({
                url: pista.url,
                lang: pista.lang,
                label: pista.label,
              })),
            }),
      })

      id = alta.id
      idRef.current = id

      video = document.createElement('video')
      conEstiloOculto(video)
      montarPistas(video, alta.subtitles)
      document.body.appendChild(video)
      videoRef.current = video

      const detectado = viaDeAirPlay(video) ?? via
      if (detectado === undefined) throw new Error('AirPlay no está disponible')

      const nueva = crearSesionAirPlay(video as unknown as VideoAirPlay, detectado, setEstado)
      sesionRef.current = nueva
      setSesion(nueva)

      const pistas: CastTrack[] = alta.subtitles.map((subtitulo, indice) => ({
        trackId: indice + 1,
        trackContentId: subtitulo.url,
        trackContentType: 'text/vtt',
        subtype: 'SUBTITLES',
        name: subtitulo.label,
        language: subtitulo.lang,
      }))

      await nueva.iniciar(
        alta.urls[0] ?? '',
        alta.kind,
        {
          ...(titleRef.current === undefined ? {} : { title: titleRef.current }),
          ...(subtitleRef.current === undefined ? {} : { subtitle: subtitleRef.current }),
          ...(posterRef.current === undefined ? {} : { poster: posterRef.current }),
        },
        positionRef.current,
        pistas,
      )

      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))

      sesionRef.current?.cerrar()
      sesionRef.current = undefined
      setSesion(undefined)
      video?.remove()
      videoRef.current = undefined

      if (id !== undefined) {
        idRef.current = undefined
        await cerrarCastSesion(id).catch(() => {})
      }

      return false
    } finally {
      setCargando(false)
    }
  }, [cargando, disponible, via])

  return {
    disponible,
    conectado: estado.conectado,
    estado,
    cargando,
    error,
    sesion,
    activar,
    detener,
  }
}
