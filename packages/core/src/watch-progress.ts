/**
 * La proporción vista y el umbral de «terminado».
 *
 * Viven en `core` porque los leen dos lados que tienen que coincidir: el store,
 * que escribe `finished` cuando guarda la posición, y la interfaz, que pinta el
 * episodio como visto. Con dos umbrales, un episodio podría salir «visto» en la
 * ficha y seguir en «continuar viendo» en la home.
 *
 * Sin duración no hay proporción: un proveedor que no diga cuánto dura deja sus
 * episodios sin marcar. Preferimos no marcar nada a marcar por lo que no se sabe.
 */

/**
 * A partir de aquí, el episodio se da por terminado.
 *
 * 0.9 y no 1: quien deja los últimos segundos de créditos no ha dejado de ver el
 * episodio, y con el umbral en 1 el historial se llenaría de episodios vistos
 * enteros que nunca llegan a marcarse.
 */
export const FINISHED_RATIO = 0.9

/** Cuánto se vio, de 0 a 1. Cero cuando no hay duración que comparar. */
export function watchedRatio(positionS: number, durationS: number): number {
  if (!Number.isFinite(durationS) || durationS <= 0) return 0
  if (!Number.isFinite(positionS) || positionS <= 0) return 0

  return Math.min(positionS / durationS, 1)
}

/** ¿Se puede dar por terminado? */
export function isFinished(positionS: number, durationS: number): boolean {
  return watchedRatio(positionS, durationS) >= FINISHED_RATIO
}
