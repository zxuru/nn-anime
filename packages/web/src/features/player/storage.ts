/**
 * Lo que la pantalla recuerda entre visitas.
 *
 * Dos cosas y las dos en `localStorage`: por dónde iba el episodio y si se quiere
 * que el siguiente empiece solo. Son preferencias de quien mira, no del
 * visionado —el visionado lo guarda el servidor— así que no viajan a ninguna
 * parte y no tienen que estar en la base.
 *
 * Todo el acceso pasa por aquí porque `localStorage` **lanza**: en el renderizado
 * de servidor no existe y en un navegador con el almacenamiento bloqueado por
 * política tampoco. Se envuelve en `try`/`catch` y se sigue: perder el sitio
 * donde alguien se quedó es una molestia, y una pantalla que no carga porque no
 * pudo escribir una preferencia es un fallo.
 *
 * Las funciones reciben el almacén en vez de buscarlo ellas: así se prueban sin
 * un navegador, que es donde se rompen —un JSON corrupto de una versión
 * anterior— y no en el camino de en medio.
 */

/** El prefijo de todo lo que escribe esta aplicación. */
const PREFIJO = 'nn-anime:'

/** Lo que hace falta de `localStorage`, para poder pasar uno de mentira. */
export interface Almacen {
  getItem(clave: string): string | null
  setItem(clave: string, valor: string): void
  removeItem(clave: string): void
}

/** El almacén del navegador, o nada si no se puede tocar. */
export function almacenLocal(): Almacen | undefined {
  try {
    return globalThis.localStorage ?? undefined
  } catch {
    return undefined
  }
}
/** Por dónde iba un episodio, en segundos. */
export interface Progreso {
  readonly positionS: number
  readonly durationS: number
}

/**
 * El segundo a partir del cual se reanuda.
 *
 * Por debajo de diez segundos no se reanuda: quien abrió el episodio y lo cerró
 * en el segundo tres no lo estaba viendo, y volver a ponerlo ahí es empezarlo
 * con un salto. Por encima del noventa y cinco por ciento tampoco: eso es un
 * episodio terminado, y lo que toca es el siguiente.
 */
const MINIMO_S = 10
const PROPORCION_MAXIMA = 0.95

/** Lo que hay guardado, sea lo que sea, tiene que ser un objeto. */
function esObjeto(valor: unknown): valor is Readonly<Record<string, unknown>> {
  return typeof valor === 'object' && valor !== null
}

/** La clave del progreso de un episodio. */
export function claveDeProgreso(providerId: string, episodeRef: string): string {
  return `${PREFIJO}progreso:${providerId}:${episodeRef}`
}

/** La clave de la preferencia de reproducción automática. */
export const CLAVE_AUTOPLAY = `${PREFIJO}autoplay`

/** Guarda por dónde va. Un fallo del almacén no rompe la reproducción. */
export function guardarProgreso(
  almacen: Almacen | undefined,
  clave: string,
  progreso: Progreso,
): void {
  if (almacen === undefined) return
  if (!Number.isFinite(progreso.positionS) || !Number.isFinite(progreso.durationS)) return

  try {
    almacen.setItem(clave, JSON.stringify(progreso))
  } catch {
    // Sin sitio para apuntarlo, la reproducción sigue igual.
  }
}

/**
 * Lo que había guardado, si es un progreso de verdad.
 *
 * Un JSON que no es el que se escribió —una versión vieja, una mano ajena— no se
 * interpreta: se devuelve nada y se empieza por el principio, que es lo que haría
 * alguien que no tuviera el dato.
 */
export function leerProgreso(almacen: Almacen | undefined, clave: string): Progreso | undefined {
  if (almacen === undefined) return undefined

  try {
    const crudo = almacen.getItem(clave)
    if (crudo === null) return undefined

    const datos: unknown = JSON.parse(crudo)
    if (!esObjeto(datos)) return undefined

    const { positionS, durationS } = datos
    if (typeof positionS !== 'number' || typeof durationS !== 'number') return undefined

    return { positionS, durationS }
  } catch {
    return undefined
  }
}

/** Olvida el progreso de un episodio. Se usa al terminarlo. */
export function olvidarProgreso(almacen: Almacen | undefined, clave: string): void {
  if (almacen === undefined) return

  try {
    almacen.removeItem(clave)
  } catch {
    // Igual que arriba: no hay nada que hacer y no es un fallo de la pantalla.
  }
}

/** El segundo en el que hay que seguir, o nada si no toca reanudar. */
export function reanudarEn(progreso: Progreso | undefined): number | undefined {
  if (progreso === undefined) return undefined
  if (progreso.durationS <= 0) return undefined
  if (progreso.positionS <= MINIMO_S) return undefined
  if (progreso.positionS / progreso.durationS >= PROPORCION_MAXIMA) return undefined

  return Math.floor(progreso.positionS)
}

/**
 * ¿Se reproduce solo el episodio siguiente? Por defecto, sí.
 *
 * Lo que no está guardado es lo que nunca se eligió, y el valor de fábrica es que
 * sí: quien ve una serie espera que siga. Se guarda sólo lo que se cambia.
 */
export function leerAutoplay(almacen: Almacen | undefined): boolean {
  if (almacen === undefined) return true

  try {
    return almacen.getItem(CLAVE_AUTOPLAY) !== 'no'
  } catch {
    return true
  }
}

export function guardarAutoplay(almacen: Almacen | undefined, valor: boolean): void {
  if (almacen === undefined) return

  try {
    almacen.setItem(CLAVE_AUTOPLAY, valor ? 'si' : 'no')
  } catch {
    // Sin sitio para apuntarlo, la preferencia vale para esta visita.
  }
}
