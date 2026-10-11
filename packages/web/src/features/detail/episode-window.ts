/**
 * Las ventanas de una lista de episodios larga.
 *
 * Una serie de mil ciento ochenta episodios pintada de una vez son mil ciento
 * ochenta filas en el documento: el navegador las aguanta y la persona que busca
 * el 743 no. Aquí vive el cálculo de qué trozo se pinta y de en qué trozo cae un
 * número, que es lo único que tiene lógica; el componente sólo lo pinta.
 *
 * **El tope es de pintado, no de datos.** La ficha sigue recibiendo la lista
 * entera —el reproductor necesita los vecinos y la posición, y el resumen de
 * vistos los mira todos— y lo que se recorta es lo que se dibuja.
 *
 * Todo es puro y sin estado para poder medirlo sin navegador: el foco que deja el
 * salto se mide en el e2e, que es donde hay uno.
 */

/** Cuántos episodios se pintan de una vez. */
export const EPISODE_WINDOW = 100

/** Un trozo de la lista, en índices: `start` incluido, `end` excluido. */
export interface EpisodeWindow {
  readonly start: number
  readonly end: number
}

/** Cuántas ventanas tiene una lista. Siempre al menos una, aunque esté vacía. */
export function windowCount(total: number): number {
  if (total <= 0) return 1

  return Math.ceil(total / EPISODE_WINDOW)
}

/**
 * La ventana `index`, saneada.
 *
 * Un índice fuera de rango cae a la primera o a la última en vez de devolver un
 * trozo vacío: la lista no puede quedarse en blanco porque un botón contara mal.
 */
export function windowAt(index: number, total: number): EpisodeWindow {
  const ultima = windowCount(total) - 1
  const saneado = Number.isFinite(index) ? Math.trunc(index) : 0
  const cual = Math.min(Math.max(saneado, 0), ultima)
  const start = cual * EPISODE_WINDOW

  return { start, end: Math.min(start + EPISODE_WINDOW, total) }
}

/**
 * La ventana en la que cae un número de episodio.
 *
 * Devuelve el **índice** de la ventana y no el trozo: quien salta quiere cambiar
 * de ventana, y con el trozo tendría que volver a dividir.
 *
 * Los números pueden no ser correlativos —una fuente que numera 1, 2, 4…—, así
 * que la búsqueda es por número y no por posición. Si el número no está, se va a
 * la ventana del primero que sea mayor y, si no hay ninguno, a la última: dejar a
 * quien saltó donde estaba es peor que acercarse.
 */
export function windowForNumber(number: number, numbers: readonly number[]): number {
  if (numbers.length === 0) return 0

  const indice = numbers.findIndex((candidato) => candidato >= number)
  const posicion = indice === -1 ? numbers.length - 1 : indice

  return Math.floor(posicion / EPISODE_WINDOW)
}

/** Cuántos de los episodios de un trozo se dieron por terminados. */
export function watchedInWindow(
  window: EpisodeWindow,
  numbers: readonly number[],
  watched: readonly { readonly number: number; readonly finished: boolean }[],
): number {
  const terminados = new Set(watched.filter((fila) => fila.finished).map((fila) => fila.number))

  return numbers.slice(window.start, window.end).filter((numero) => terminados.has(numero)).length
}
