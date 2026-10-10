/**
 * Co-visita: qué se ve junto en la misma sesión.
 *
 * Es la única señal colaborativa del motor, y es **local**: no hay servidor
 * central ni otros usuarios, sólo «después de este título vi este otro». Sirve
 * para lo que la afinidad no ve: dos títulos sin un solo tag en común que, en la
 * práctica, se ven seguidos.
 *
 * Tres reglas:
 *
 * 1. **La sesión se corta a las 6 h.** Dos episodios separados por una semana no
 *    se vieron «juntos»; sin este corte, todo el historial sería una sesión y la
 *    señal diría que todo se relaciona con todo.
 * 2. **El par se normaliza por el más frecuente.** Un par visto diez veces tiene
 *    que valer más que uno visto una, pero el resultado se queda entre 0 y 1 para
 *    poder sumarse con la afinidad, que también lo está.
 * 3. **Un par con soporte 1 no cuenta.** Una coincidencia suelta es ruido: con
 *    miles de pares posibles, cualquiera aparece una vez por azar. El umbral es
 *    lo que separa una señal de una casualidad.
 */

import { decay, HALF_LIFE_DAYS } from './affinity'

/** Horas de silencio que cierran una sesión. */
export const SESSION_GAP_HOURS = 6

/** Veces que hay que ver un par para que cuente. */
export const MIN_SUPPORT = 2

/** Un visionado, tal como lo ve esta señal. */
export interface Visit {
  /** El título visto, por su referencia (`providerId#value`). */
  readonly ref: string
  readonly at: Date | number
}

/** Un par ordenado que se vio junto, con cuántas veces y cuánto pesa. */
export interface CoVisit {
  readonly candidate: string
  readonly seen: string
  readonly count: number
  readonly weight: number
}

export interface CoVisitOptions {
  readonly gapHours?: number
  readonly minSupport?: number
  readonly halfLifeDays?: number
}

/** La clave de un título: proveedor y referencia, sin ambigüedad. */
export function visitKey(providerId: string, value: string): string {
  return `${providerId}#${value}`
}

/** Milisegundos de un evento. */
function tiempo(at: Date | number): number {
  return at instanceof Date ? at.getTime() : at
}

/**
 * Parte un historial en sesiones.
 *
 * Se ordena por fecha porque el historial puede llegar en cualquier orden, y una
 * sesión se corta cuando el hueco con el evento **anterior** pasa del umbral.
 */
export function sessions(
  visits: readonly Visit[],
  gapHours: number = SESSION_GAP_HOURS,
): readonly (readonly Visit[])[] {
  if (visits.length === 0) return []

  const ordenados = [...visits].sort((a, b) => tiempo(a.at) - tiempo(b.at))
  const hueco = gapHours * 3_600_000
  const salida: Visit[][] = []
  let actual: Visit[] = [ordenados[0] as Visit]

  for (const visita of ordenados.slice(1)) {
    const anterior = actual[actual.length - 1] as Visit

    if (tiempo(visita.at) - tiempo(anterior.at) < hueco) {
      actual.push(visita)
    } else {
      salida.push(actual)
      actual = [visita]
    }
  }

  salida.push(actual)

  return salida
}

/**
 * Los pares que se ven juntos, ya normalizados.
 *
 * Para cada sesión se cuentan los pares (candidato, visto) **en los dos
 * sentidos**: si A y B se ven juntos, «después de A, B» y «después de B, A» son
 * las dos direcciones útiles, y una lista de recomendaciones se construye desde
 * la última vista.
 *
 * El peso de cada par es su cuenta por el decaimiento de su última vez, y el
 * resultado se divide por el par más frecuente: así el más visto vale 1 y el
 * resto se reparte por debajo.
 */
export function coVisits(
  visits: readonly Visit[],
  options: CoVisitOptions = {},
): readonly CoVisit[] {
  const minSupport = options.minSupport ?? MIN_SUPPORT
  const semivida = options.halfLifeDays ?? HALF_LIFE_DAYS
  const porPar = new Map<string, { candidate: string; seen: string; count: number; at: number }>()

  for (const sesion of sessions(visits, options.gapHours ?? SESSION_GAP_HOURS)) {
    for (const [indice, candidato] of sesion.entries()) {
      for (const [otroIndice, visto] of sesion.entries()) {
        if (indice === otroIndice || candidato.ref === visto.ref) continue

        const clave = `${candidato.ref}\u0000${visto.ref}`
        const previo = porPar.get(clave)

        if (previo === undefined) {
          porPar.set(clave, {
            candidate: candidato.ref,
            seen: visto.ref,
            count: 1,
            at: tiempo(candidato.at),
          })

          continue
        }

        previo.count += 1
        previo.at = Math.max(previo.at, tiempo(candidato.at))
      }
    }
  }

  const conSoporte = [...porPar.values()].filter((par) => par.count >= minSupport)
  if (conSoporte.length === 0) return []

  const maximo = Math.max(...conSoporte.map((par) => par.count))
  const ahora = Math.max(...visits.map((visita) => tiempo(visita.at)))

  return conSoporte
    .map((par) => ({
      candidate: par.candidate,
      seen: par.seen,
      count: par.count,
      weight: (par.count / maximo) * decay(par.at, ahora, semivida),
    }))
    .sort((a, b) => b.weight - a.weight)
}

/** Índice para consultar por el título que se acaba de ver. */
export type CoVisitIndex = ReadonlyMap<string, readonly CoVisit[]>

export function indexBySeen(pares: readonly CoVisit[]): CoVisitIndex {
  const indice = new Map<string, CoVisit[]>()

  for (const par of pares) {
    const lista = indice.get(par.seen)
    if (lista === undefined) indice.set(par.seen, [par])
    else lista.push(par)
  }

  return indice
}

/**
 * La puntuación de co-visita de un candidato, dado lo último visto.
 *
 * Sin historial o sin pares, cero: la señal no aporta nada y no puede romper el
 * ranking con un `NaN`. Es la mitad del trabajo de esta función.
 */
export function coVisitScore(
  pares: readonly CoVisit[] | CoVisitIndex,
  lastSeen: string | undefined,
  candidate: string,
): number {
  if (lastSeen === undefined) return 0

  const lista = Array.isArray(pares) ? pares : (pares as CoVisitIndex).get(lastSeen)
  if (lista === undefined) return 0

  const encontrado = (lista as readonly CoVisit[]).find(
    (par) => par.seen === lastSeen && par.candidate === candidate,
  )

  return encontrado?.weight ?? 0
}
