/**
 * Las filas de la home, como datos.
 *
 * Cada fila sabe de dónde sale y qué decir cuando está vacía. Están juntas porque
 * comparten una decisión: **una fila vacía no se esconde**, se explica. Esconderla
 * deja al usuario con una página que cambia de forma sin motivo, y sin saber que
 * existe una función que no está usando.
 *
 * La fila de continuar viendo lleva la posición y **no reanuda sola**: el enlace
 * lleva a la ficha del episodio, y quien decide seguir donde lo dejó es el
 * reproductor cuando se le da a reproducir. Reanudar al entrar es lo que hace que
 * alguien vea el final de un episodio sin querer.
 */

import type { ContinueWatchingItem } from '@nn-anime/core/api'

/** La posición, en texto corto. */
export function resumeLabel(item: ContinueWatchingItem): string {
  const minutos = Math.floor(item.positionS / 60)
  const segundos = Math.floor(item.positionS % 60)

  return minutos >= 60
    ? `${Math.floor(minutos / 60)} h ${minutos % 60} min`
    : `${minutos}:${String(segundos).padStart(2, '0')}`
}

/** La ruta a la que lleva una fila de continuar viendo. */
export function continuePath(item: ContinueWatchingItem): string {
  return `/watch/${encodeURIComponent(item.animeRef.providerId)}/${encodeURIComponent(item.episodeRef.value)}`
}

/** La proporción, como porcentaje entero para la barra. */
export function progressPercent(item: ContinueWatchingItem): number {
  return Math.round(Math.min(Math.max(item.ratio, 0), 1) * 100)
}
