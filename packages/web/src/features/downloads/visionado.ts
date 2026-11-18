/**
 * El visionado de un episodio descargado: modo, posición local y registro.
 *
 * La biblioteca reproduce un archivo, no un stream del proveedor, pero para el
 * resto de la aplicación es el mismo episodio: tiene que contar en «continuar
 * viendo» y en el historial, y tiene que reanudarse donde se dejó. Lo que cambia
 * es de dónde sale la posición —el almacén del navegador, no la respuesta del
 * proveedor— y que el modo ya está decidido: es el que se eligió al descargar y
 * no se puede cambiar sin volver a bajar el capítulo.
 *
 * Las funciones puras viven aquí para poder medirlas sin un DOM, que es donde se
 * rompen: una clave que no coincide deja de reanudar, y un modo que se pierde
 * apunta el doblado como subtitulado en el historial.
 */

import type { DownloadItem } from '@rona/core/api'
import { DEFAULT_LOCALE } from '@rona/core/i18n'
import { t } from '../../i18n'
import {
  type Almacen,
  almacenLocal,
  claveDeProgreso,
  leerProgreso,
  reanudarEn,
} from '../player/storage'
import type { WatchEvents, WatchEventsOptions } from '../player/useWatchEvents'

const MODE_KEYS = {
  sub: 'player.mode.sub',
  dub: 'player.mode.dub',
} as const

/** El nombre traducido del audio, para la biblioteca y su reproductor. */
export function etiquetaDeAudio(mode: DownloadItem['mode']): string {
  return t(DEFAULT_LOCALE, MODE_KEYS[mode])
}

/**
 * «Con subtítulos (2)», o nada si el episodio no trae pistas.
 *
 * El número y no sólo la palabra: quien elige una descarga quiere saber si lleva
 * las dos pistas que tenía la ficha o sólo la del idioma original.
 */
export function etiquetaDeSubtitulos(item: DownloadItem): string | undefined {
  const pistas = item.subtitles?.length ?? 0

  return pistas === 0
    ? undefined
    : t(DEFAULT_LOCALE, 'library.episode.subtitles', { count: pistas })
}

/**
 * Dónde se apunta el progreso local de una descarga.
 *
 * La clave es la del episodio, no la de la descarga: si se borró y se volvió a
 * bajar, la posición de antes sigue sirviendo. Tampoco lleva el modo: el mismo
 * capítulo doblado y subtitulado se ve por el mismo sitio, y separarlo obligaría
 * a repetir la reanudación por cada audio.
 */
export function claveDeLaDescarga(item: DownloadItem): string {
  return claveDeProgreso(item.providerId, item.episodeRef.value)
}

/**
 * El segundo desde el que reanudar, o cero.
 *
 * `reanudarEn` aplica las mismas reglas que el reproductor del proveedor: ni los
 * primeros segundos ni un capítulo casi terminado se reanudan. La descarga no
 * tiene por qué comportarse distinto porque el archivo esté en disco.
 */
export function posicionDeLaDescarga(
  item: DownloadItem,
  almacen: Almacen | undefined = almacenLocal(),
): number {
  return reanudarEn(leerProgreso(almacen, claveDeLaDescarga(item))) ?? 0
}

/** El alta del visionado, con el modo con el que se bajó el episodio. */
export function opcionesDeVisionado(item: DownloadItem, startAtS: number): WatchEventsOptions {
  return {
    animeRef: item.animeRef,
    episodeRef: item.episodeRef,
    mode: item.mode,
    ...(startAtS > 0 ? { startAtS } : {}),
  }
}

export interface MandosDelReproductor {
  readonly onPlay: () => void
  readonly onPause: () => void
  readonly onProgress: (positionS: number, durationS: number) => void
  readonly onEnded: () => void
}

export interface VisionadoQueSeRegistra {
  /** El registro del servidor: alta, pausa y avance. */
  readonly eventos: Pick<WatchEvents, 'onPlay' | 'onPause' | 'onProgress'>
  /** Guarda la última posición conocida, sin esperar al turno periódico. */
  readonly guardar: () => void
  /** Apunta el avance y decide si toca escribirlo. */
  readonly guardarAvance: (positionS: number, durationS: number) => void
  /** Olvida la posición local y avisa al final del capítulo. */
  readonly terminar: () => void
}

/**
 * Los mandos del `<Player>` que registran el visionado.
 *
 * Se separan del componente por la misma razón que el resto de funciones puras
 * de este archivo: sin un DOM no se puede montar el reproductor, pero sí se puede
 * comprobar que cada aviso llega a los dos sitios que lo necesitan —el servidor y
 * el almacén local— y en el mismo orden que en la pantalla del proveedor.
 *
 * La pausa guarda siempre: es el momento en el que quien mira suele estar a punto
 * de irse, y el turno de cinco segundos puede no haber llegado.
 */
export function mandosDelReproductor(input: VisionadoQueSeRegistra): MandosDelReproductor {
  return {
    onPlay: () => input.eventos.onPlay(),
    onPause: () => {
      input.guardar()
      input.eventos.onPause()
    },
    onProgress: (positionS, durationS) => {
      input.guardarAvance(positionS, durationS)
      input.eventos.onProgress(positionS, durationS)
    },
    onEnded: () => input.terminar(),
  }
}
