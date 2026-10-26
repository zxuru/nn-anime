/**
 * Las filas de la home, como datos.
 *
 * Cada fila sabe de dónde sale y qué decir cuando está vacía. Están juntas porque
 * comparten una decisión: **una fila vacía no se esconde**, se explica. Esconderla
 * deja al usuario con una página que cambia de forma sin motivo, y sin saber que
 * existe una función que no está usando.
 *
 * La fila de continuar viendo lleva la posición **en el enlace**: la tarjeta sabe
 * dónde se dejó y se lo dice al reproductor, que arranca ahí. Con la posición
 * sólo en el registro del servidor, darle a reproducir empezaba en el segundo
 * cero y la fila no servía para continuar nada.
 */

import type { ContinueWatchingItem } from '@nn-anime/core/api'
import { isPlayMode, watchPath } from '../player/watch-route'

/** La posición, en texto corto. */
export function resumeLabel(item: ContinueWatchingItem): string {
  const minutos = Math.floor(item.positionS / 60)
  const segundos = Math.floor(item.positionS % 60)

  return minutos >= 60
    ? `${Math.floor(minutos / 60)} h ${minutos % 60} min`
    : `${minutos}:${String(segundos).padStart(2, '0')}`
}

/**
 * La ruta a la que lleva una fila de continuar viendo.
 *
 * Con el modo en el que se estaba viendo y el segundo donde se dejó: los dos
 * datos que hacen que la tarjeta continúe el episodio y no lo empiece. Un modo
 * que el reproductor no sepa pedir no viaja: la dirección se escribe con los
 * modos que existen, no con lo que traiga la fila.
 */
export function continuePath(item: ContinueWatchingItem): string {
  const modo = isPlayMode(item.mode) ? item.mode : undefined

  return watchPath(item.animeRef.providerId, item.episodeRef.value, {
    ...(modo === undefined ? {} : { mode: modo }),
    at: Math.floor(item.positionS),
    // El título va escrito y no deducido: la fila lo trae en `animeRef`, y con
    // jkanime —que numera `slug/12`— deducirlo pedía la ficha del episodio.
    anime: item.animeRef.value,
    // La temporada, si la fuente la declara: sin ella, «el episodio 1» de una
    // serie de tres temporadas no dice cuál.
    ...(item.season === undefined ? {} : { s: item.season }),
  })
}

/** La proporción, como porcentaje entero para la barra. */
export function progressPercent(item: ContinueWatchingItem): number {
  return Math.round(Math.min(Math.max(item.ratio, 0), 1) * 100)
}

/**
 * Lo que queda del episodio, en texto corto.
 *
 * `undefined` cuando no se sabe la duración: un «0 min restantes» sería mentira,
 * y el pie se queda con la posición, que sí se sabe.
 */
export function remainingLabel(item: ContinueWatchingItem): string | undefined {
  if (item.durationS <= 0) return undefined

  const restante = Math.max(0, item.durationS - item.positionS)
  const minutos = Math.ceil(restante / 60)

  return minutos >= 60 ? `${Math.floor(minutos / 60)} h ${minutos % 60} min` : `${minutos} min`
}
