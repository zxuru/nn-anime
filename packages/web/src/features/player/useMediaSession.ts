/**
 * Los controles del sistema (Media Session).
 *
 * La pantalla de bloqueo del móvil, los auriculares y la tecla de reproducción
 * del teclado no pasan por nuestros botones: hablan con `navigator.mediaSession`.
 * Sin esto, el episodio sonaba y el sistema decía que no había nada, y pausar
 * desde los auriculares no hacía nada.
 *
 * La API no está en todos los navegadores y tampoco en el renderizado de
 * servidor, así que **todo pasa por una guarda**: sin `navigator` o sin
 * `mediaSession` el gancho no hace nada. Lo que se puede probar sin un DOM —qué
 * metadata se compone, cuándo se anuncia la posición y cómo se registran y se
 * limpian los gestos— vive en funciones puras que reciben la sesión; el gancho
 * sólo las llama desde sus efectos.
 *
 * Los gestos del sistema son los mismos que los botones: reproducir y pausar
 * alternan, las flechas mueven diez segundos y una posición concreta la lleva
 * `seekTo`. Duplicar aquí la lógica sería tener dos formas de saltar que se
 * separan con el tiempo.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import { useEffect, useRef } from 'react'
import { t } from '../../i18n'

/**
 * Lo que hace falta de `navigator.mediaSession`.
 *
 * Es un contrato estrecho a propósito: el navegador ofrece más cosas —cámara y
 * micrófono— que aquí no se usan, y una prueba puede cumplirlo con un objeto
 * corriente. `metadata` admite el objeto de inicialización además del
 * `MediaMetadata` real para poder medir el asignado sin la clase del navegador;
 * el gancho siempre construye el segundo cuando existe.
 */
export interface MediaSessionPort {
  metadata: MediaMetadata | MediaMetadataInit | null
  playbackState: MediaSessionPlaybackState
  setActionHandler: (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => void
  setPositionState: (state?: MediaPositionState) => void
}

/** Lo único que se le pregunta al navegador para saber si hay sesión. */
export interface NavegadorConMediaSession {
  readonly mediaSession?: MediaSessionPort | undefined
}

/**
 * La sesión del sistema, o nada.
 *
 * `navigator` no existe en el servidor y `mediaSession` no existe en los
 * navegadores que no implementan la API. También se comprueban los dos métodos
 * que se van a usar: una sesión a medias es peor que ninguna, porque los
 * efectos fallarían al llamarla.
 */
export function sesionDeMedios(
  navegador: NavegadorConMediaSession | undefined,
): MediaSessionPort | undefined {
  if (navegador === undefined) return undefined

  const sesion = navegador.mediaSession
  if (sesion === undefined) return undefined
  if (typeof sesion.setActionHandler !== 'function') return undefined
  if (typeof sesion.setPositionState !== 'function') return undefined

  return sesion
}

/**
 * Lo que separa el título de la obra del episodio.
 *
 * Es el mismo punto medio que compone `composeTitle` para la pestaña y para el
 * nombre accesible del video: «Aurora Nocturna · Episodio 3». El sistema enseña
 * el episodio como título y la obra como artista, que es como se lee una pista
 * de música y como cabe en la pantalla de bloqueo.
 */
const SEPARADOR_DE_OBRA = ' · '

/**
 * La metadata que se le cuenta al sistema.
 *
 * Sin título no se inventa un hueco: se usa el mismo nombre que el resto de la
 * aplicación le da al reproductor. La carátula sólo va si hay póster; una
 * dirección inventada sería una imagen rota en la pantalla de bloqueo.
 */
export function metadataDeLaSesion(
  titulo: string | undefined,
  poster: string | undefined,
): MediaMetadataInit {
  const nombre = titulo?.trim() ?? ''
  const [obra = '', ...resto] = nombre.split(SEPARADOR_DE_OBRA)
  const episodio = resto.join(SEPARADOR_DE_OBRA).trim()

  const metadata: MediaMetadataInit = {
    title: (episodio === '' ? nombre : episodio) || t(DEFAULT_LOCALE, 'player.label'),
  }

  if (episodio !== '' && obra.trim() !== '') metadata.artist = obra.trim()
  if (poster !== undefined && poster !== '') metadata.artwork = [{ src: poster }]

  return metadata
}

/** Cómo se construye la metadata del navegador. Se inyecta para poder probarla. */
export type ConstructorDeMetadata = (
  init: MediaMetadataInit,
) => MediaMetadata | MediaMetadataInit | undefined

/**
 * El `MediaMetadata` del navegador, si existe.
 *
 * En el servidor no hay clase, y un navegador podría tener la sesión y no la
 * constructora. Se devuelve nada y no se asigna: el resto del reproductor sigue
 * funcionando igual.
 */
export function crearMetadataDelNavegador(init: MediaMetadataInit): MediaMetadata | undefined {
  if (typeof MediaMetadata === 'undefined') return undefined

  try {
    return new MediaMetadata(init)
  } catch {
    return undefined
  }
}

/** Deja la metadata en la sesión. Sin sesión o sin metadata, no hace nada. */
export function aplicarMetadata(
  sesion: MediaSessionPort | undefined,
  metadata: MediaMetadataInit,
  crear: ConstructorDeMetadata = crearMetadataDelNavegador,
): void {
  if (sesion === undefined) return

  const construida = crear(metadata)
  if (construida === undefined) return

  sesion.metadata = construida
}

/**
 * El estado que anuncia el sistema.
 *
 * `playing` sale del evento del elemento, no de haber pulsado el botón. Sin
 * duración todavía no hay medio que anunciar y el estado es `none`; en cuanto el
 * elemento conoce la duración —o es un directo, que no la tiene— está en pausa
 * hasta que suene.
 */
export function estadoDeReproduccion(
  playing: boolean,
  durationS: number,
): MediaSessionPlaybackState {
  if (playing) return 'playing'

  return durationS > 0 ? 'paused' : 'none'
}

/** Deja el estado de reproducción en la sesión. */
export function aplicarEstado(
  sesion: MediaSessionPort | undefined,
  playing: boolean,
  durationS: number,
): void {
  if (sesion === undefined) return

  sesion.playbackState = estadoDeReproduccion(playing, durationS)
}

/**
 * La posición que admite `setPositionState`, o nada.
 *
 * La especificación exige una duración finita y mayor que cero: con `Infinity`
 * —un directo— o con cero —antes de los metadatos— no hay barra que enseñar y
 * llamar sería un error que algunos navegadores lanzan. La posición se recorta a
 * la duración porque el elemento puede corregirla a mitad de reproducción.
 */
export function posicionDeLaSesion(
  positionS: number,
  durationS: number,
): MediaPositionState | undefined {
  if (!Number.isFinite(durationS) || durationS <= 0) return undefined

  const posicion = Number.isFinite(positionS) ? Math.min(Math.max(positionS, 0), durationS) : 0

  return { duration: durationS, position: posicion }
}

/**
 * Deja la posición en la sesión.
 *
 * El navegador puede rechazar los valores —una duración que acaba de cambiar, un
 * `playbackRate` que no le vale— y lanza. Es un adorno de la pantalla de bloqueo:
 * un fallo aquí no puede parar la reproducción.
 */
export function aplicarPosicion(
  sesion: MediaSessionPort | undefined,
  positionS: number,
  durationS: number,
): void {
  if (sesion === undefined) return

  const estado = posicionDeLaSesion(positionS, durationS)
  if (estado === undefined) return

  try {
    sesion.setPositionState(estado)
  } catch {
    // El navegador dijo que no; la reproducción sigue y el mando del sistema
    // simplemente no tiene barra.
  }
}

/** Las cinco acciones que se atan; también son las que se limpian. */
export const ACCIONES_DEL_SISTEMA: readonly MediaSessionAction[] = [
  'play',
  'pause',
  'seekbackward',
  'seekforward',
  'seekto',
]

/** Lo que el reproductor hace cuando el sistema pulsa un mando. */
export interface MediaSessionHandlers {
  readonly play: () => void
  readonly pause: () => void
  readonly seekbackward: () => void
  readonly seekforward: () => void
  /** La posición concreta de una barra del sistema, en segundos. */
  readonly seekto: (positionS: number) => void
}

/**
 * Ata un gesto del sistema, tolerando que el navegador no lo conozca.
 *
 * Safari, por ejemplo, no implementa todas las acciones. Una que falle no puede
 * llevarse por delante a las demás.
 */
function registrar(
  sesion: MediaSessionPort,
  accion: MediaSessionAction,
  manejador: MediaSessionActionHandler,
): void {
  try {
    sesion.setActionHandler(accion, manejador)
  } catch {
    // Esa acción no existe en este navegador; las otras siguen atándose.
  }
}

/** Ata los cinco gestos a los manejadores del reproductor. */
export function registrarManejadores(
  sesion: MediaSessionPort | undefined,
  handlers: MediaSessionHandlers,
): void {
  if (sesion === undefined) return

  registrar(sesion, 'play', () => handlers.play())
  registrar(sesion, 'pause', () => handlers.pause())
  registrar(sesion, 'seekbackward', () => handlers.seekbackward())
  registrar(sesion, 'seekforward', () => handlers.seekforward())
  registrar(sesion, 'seekto', (detalles) => {
    // Sin `seekTime` no hay destino: el sistema pidió un salto y no dijo a dónde.
    if (typeof detalles.seekTime === 'number' && Number.isFinite(detalles.seekTime)) {
      handlers.seekto(detalles.seekTime)
    }
  })
}

/** Suelta los cinco gestos; los mandos del sistema dejan de responder. */
export function liberarManejadores(sesion: MediaSessionPort | undefined): void {
  if (sesion === undefined) return

  for (const accion of ACCIONES_DEL_SISTEMA) {
    try {
      sesion.setActionHandler(accion, null)
    } catch {
      // Si no se pudo atar, tampoco hace falta soltarla.
    }
  }
}

/**
 * Apaga la sesión al desmontar.
 *
 * No basta con soltar los manejadores: la pantalla de bloqueo conservaría el
 * título y la carátula del episodio que ya no se está viendo. Al salir de la
 * pantalla, el sistema vuelve a no saber nada.
 */
export function desconectarSesion(sesion: MediaSessionPort | undefined): void {
  if (sesion === undefined) return

  liberarManejadores(sesion)
  sesion.playbackState = 'none'
  sesion.metadata = null
}

/**
 * Ata los mandos y devuelve cómo soltarlos.
 *
 * La devolución es lo que el efecto entrega a React como limpieza: una sola
 * llamada apaga la sesión entera, y por eso no se puede olvidar una mitad.
 */
export function conectarManejadores(
  sesion: MediaSessionPort | undefined,
  handlers: MediaSessionHandlers,
): () => void {
  registrarManejadores(sesion, handlers)

  return () => desconectarSesion(sesion)
}

/** La sesión tal y como la ve el navegador ahora mismo, sin romper en el servidor. */
function sesionActual(): MediaSessionPort | undefined {
  return sesionDeMedios(typeof navigator === 'undefined' ? undefined : navigator)
}

export interface UseMediaSessionOptions extends MediaSessionHandlers {
  /** El nombre completo, como el de la pestaña: «obra · episodio». */
  readonly title?: string | undefined
  readonly poster?: string | undefined
  readonly positionS: number
  readonly durationS: number
  readonly playing: boolean
}

/**
 * Pone el reproductor en los controles del sistema.
 *
 * Los manejadores viven en una referencia porque quien monta el reproductor
 * puede pasar funciones nuevas en cada render; con ellas en las dependencias, el
 * efecto se ejecutaría en cada actualización de estado y volvería a atar los
 * cinco gestos cuatro veces por segundo. Los datos que se pintan —título,
 * carátula, estado y posición— sí van en las dependencias de sus efectos.
 */
export function useMediaSession(options: UseMediaSessionOptions): void {
  const manejadores = useRef<MediaSessionHandlers>(options)
  manejadores.current = options

  useEffect(() => {
    const sesion = sesionActual()
    if (sesion === undefined) return

    return conectarManejadores(sesion, {
      play: () => manejadores.current.play(),
      pause: () => manejadores.current.pause(),
      seekbackward: () => manejadores.current.seekbackward(),
      seekforward: () => manejadores.current.seekforward(),
      seekto: (positionS) => manejadores.current.seekto(positionS),
    })
  }, [])

  useEffect(() => {
    const sesion = sesionActual()
    if (sesion === undefined) return

    aplicarMetadata(sesion, metadataDeLaSesion(options.title, options.poster))
  }, [options.title, options.poster])

  useEffect(() => {
    aplicarEstado(sesionActual(), options.playing, options.durationS)
  }, [options.playing, options.durationS])

  useEffect(() => {
    aplicarPosicion(sesionActual(), options.positionS, options.durationS)
  }, [options.positionS, options.durationS])
}
