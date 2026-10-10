/**
 * Qué no recomendar.
 *
 * Un motor de recomendación que propone lo que el usuario acaba de terminar está
 * roto, por muy buenas que sean sus puntuaciones. Aquí se decide qué queda fuera
 * y —más importante— **qué excepción hay**:
 *
 * - **Visto y terminado, fuera.** Al 100 % no se recomienda: ya se vio.
 * - **Empezado y abandonado, fuera por ahora.** Al 10 % se dejó a medias; volver a
 *   proponerlo a la semana siguiente es insistir.
 * - **Empezado hace mucho, dentro.** Al 10 % y hace más de 30 días sí puede
 *   reaparecer: la persona cambió, o el título le encaja ahora. Eso es el
 *   **reencuentro**, y es la excepción que hace que el filtro no sea una lista
 *   negra para siempre.
 *
 * Los umbrales son constantes con nombre porque son decisiones, no números
 * sueltos: quien los lea tiene que poder discutirlos.
 */

/** Porcentaje a partir del cual un título cuenta como terminado. */
export const FINISHED_RATIO = 0.9

/** Porcentaje por debajo del cual un título cuenta como apenas empezado. */
export const BARELY_STARTED_RATIO = 0.5

/** Días tras los cuales un título abandonado puede volver a proponerse. */
export const REDISCOVERY_DAYS = 30

/** Lo que se sabe de un candidato respecto al historial. */
export interface WatchState {
  readonly ref: string
  /** Cuánto se vio, de 0 a 1. */
  readonly ratio: number
  readonly at: Date | number
}

export type FilterReason = 'watched' | 'finished' | 'started'

export interface FilterOutcome {
  readonly keep: boolean
  /** Por qué se dejó fuera, si se dejó fuera. */
  readonly reason?: FilterReason | undefined
  /** Si vuelve por reencuentro, con cuánto peso extra. */
  readonly rediscovery?: number | undefined
}

export interface FilterOptions {
  readonly now?: Date | number
  readonly rediscoveryDays?: number
  readonly finishedRatio?: number
  readonly barelyStartedRatio?: number
}

/** Milisegundos de un instante. */
function tiempo(at: Date | number): number {
  return at instanceof Date ? at.getTime() : at
}

function dias(at: Date | number, now: Date | number): number {
  return Math.max(0, (tiempo(now) - tiempo(at)) / 86_400_000)
}

/**
 * Si un candidato ya visto puede volver a proponerse.
 *
 * Devuelve `keep: false` con su motivo cuando no, y `keep: true` con un
 * `rediscovery` entre 0 y 1 cuando sí: el peso crece con el tiempo transcurrido,
 * hasta 1 a los dos meses. Un reencuentro no puede pesar más que una señal
 * fresca, o el motor viviría del pasado.
 */
export function filterCandidate(
  state: WatchState | undefined,
  options: FilterOptions = {},
): FilterOutcome {
  if (state === undefined) return { keep: true }

  const ahora = options.now ?? Date.now()
  const umbralTerminado = options.finishedRatio ?? FINISHED_RATIO
  const umbralEmpezado = options.barelyStartedRatio ?? BARELY_STARTED_RATIO
  const diasReencuentro = options.rediscoveryDays ?? REDISCOVERY_DAYS

  // Terminado: fuera, sin excepción. Volver a ofrecer lo que se acabó de ver es
  // la forma más rápida de que el motor parezca tonto.
  if (state.ratio >= umbralTerminado) return { keep: false, reason: 'finished' }

  const transcurridos = dias(state.at, ahora)
  if (transcurridos < diasReencuentro) {
    return {
      keep: false,
      reason: state.ratio <= umbralEmpezado ? 'started' : 'watched',
    }
  }

  // Pasado el plazo, sólo vuelve lo que se dejó a medias: lo que se vio casi
  // entero ya se vio, y el reencuentro no lo arregla.
  if (state.ratio > umbralEmpezado) return { keep: false, reason: 'watched' }

  return { keep: true, rediscovery: Math.min(transcurridos / (diasReencuentro * 2), 1) }
}

/** Los estados indexados por referencia, para filtrar en una pasada. */
export function indexWatchState(estados: readonly WatchState[]): ReadonlyMap<string, WatchState> {
  const indice = new Map<string, WatchState>()

  for (const estado of estados) {
    const previo = indice.get(estado.ref)
    // Gana el más reciente: si alguien vio el mismo título dos veces, lo que
    // importa es la última. Comparar «días desde 1970» —que era lo que hacía
    // antes— daba siempre cero y dejaba el índice con el visionado más viejo. Lo
    // encontró la prueba.
    if (previo === undefined || tiempo(estado.at) > tiempo(previo.at)) {
      indice.set(estado.ref, estado)
    }
  }

  return indice
}

/**
 * Aplica el filtro a una lista de candidatos, conservando el orden.
 *
 * Se devuelve también el peso de reencuentro de cada uno: quien llame decide si
 * lo suma a la puntuación o lo usa sólo para desempatar, y esa decisión no es de
 * este módulo.
 */
export function filterCandidates<
  T extends { readonly ref: { readonly providerId: string; readonly value: string } },
>(
  candidatos: readonly T[],
  estados: ReadonlyMap<string, WatchState>,
  options: FilterOptions = {},
): readonly { readonly candidate: T; readonly rediscovery: number }[] {
  const salida: { candidate: T; rediscovery: number }[] = []

  for (const candidato of candidatos) {
    const clave = `${candidato.ref.providerId}#${candidato.ref.value}`
    const salida2 = filterCandidate(estados.get(clave), options)

    if (salida2.keep) salida.push({ candidate: candidato, rediscovery: salida2.rediscovery ?? 0 })
  }

  return salida
}
