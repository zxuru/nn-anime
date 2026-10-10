/**
 * Señal de búsqueda: lo que el usuario está buscando ahora.
 *
 * Es la señal más volátil del motor y la más útil: si alguien busca «mecha» hoy,
 * lo que le interesa hoy tiene que ver con eso, no con lo que vio hace un mes.
 * Por eso su semivida es de **3 días** y no de 30: una búsqueda de la semana
 * pasada ya no dice qué se quiere ver esta noche.
 *
 * El cruce es contra el título y los tags, y se hace con los términos
 * normalizados: buscar «Acción» y «accion» es buscar lo mismo, y comparar cadenas
 * sin normalizar haría que la señal dependiera de las mayúsculas que alguien
 * escribió.
 */

import type { Candidate } from '@nn-anime/core'
import { normalizeQuery } from '@nn-anime/core'
import { decay } from './affinity'

/** Días que tarda una búsqueda en valer la mitad. */
export const SEARCH_HALF_LIFE_DAYS = 3

/** Peso máximo que puede aportar la señal de búsqueda a un candidato. */
export const MAX_SEARCH_WEIGHT = 1

export interface SearchSignalRecord {
  readonly query: string
  readonly at: Date | number
  /** Cuántas veces se repitió. Una búsqueda repetida dice más. */
  readonly hits?: number | undefined
}

export interface SearchSignalOptions {
  readonly halfLifeDays?: number
  readonly now?: Date | number
}

/** Los términos de una consulta, normalizados y sin repetir. */
export function terms(query: string): readonly string[] {
  const normalizada = normalizeQuery(query)
  if (normalizada === '') return []

  return [...new Set(normalizada.split(/\s+/).filter((termino) => termino !== ''))]
}

/**
 * Cuánto encaja un candidato con lo que se busca.
 *
 * Se mira el título y los tags: un término que aparece en el título vale el
 * doble que uno que sólo está en un tag, porque quien busca «mecha» y ve un
 * título con «mecha» ha encontrado lo que buscaba.
 *
 * El resultado se normaliza por el número de términos y se recorta a 1: la señal
 * tiene que poder sumarse con las demás, que también están entre 0 y 1.
 */
export function matchScore(candidate: Candidate, terminos: readonly string[]): number {
  if (terminos.length === 0) return 0

  const titulo = normalizeQuery(candidate.title)
  const tags = candidate.tags.map((tag) => normalizeQuery(tag))
  let suma = 0

  for (const termino of terminos) {
    if (titulo.includes(termino)) suma += 2
    else if (tags.some((tag) => tag.includes(termino))) suma += 1
  }

  return Math.min(suma / (terminos.length * 2), 1)
}

/**
 * El peso de una búsqueda: decaimiento por su antigüedad, por sus repeticiones.
 *
 * Una búsqueda sin `at` no existe para esta señal: no se puede saber si es de
 * ahora o de hace un año, y suponer que es de ahora sería inventarse la señal.
 */
export function searchWeight(
  record: SearchSignalRecord,
  now: Date | number,
  halfLifeDays: number = SEARCH_HALF_LIFE_DAYS,
): number {
  const repeticiones = Math.max(1, record.hits ?? 1)

  return decay(record.at, now, halfLifeDays) * Math.min(repeticiones, 3)
}

/**
 * La puntuación de búsqueda de un candidato, con el historial de búsquedas.
 *
 * Se toma la búsqueda que más encaja, no la suma de todas: sumar haría que veinte
 * búsquedas distintas del mismo día superaran a una búsqueda muy concreta, y lo
 * que interesa es la coincidencia, no el volumen.
 */
export function searchScore(
  candidate: Candidate,
  historial: readonly SearchSignalRecord[],
  options: SearchSignalOptions = {},
): number {
  const ahora = options.now ?? Date.now()
  const semivida = options.halfLifeDays ?? SEARCH_HALF_LIFE_DAYS
  let mejor = 0

  for (const registro of historial) {
    const encaje = matchScore(candidate, terms(registro.query))
    if (encaje === 0) continue

    const peso = encaje * searchWeight(registro, ahora, semivida)
    mejor = Math.max(mejor, peso)
  }

  return Math.min(mejor, MAX_SEARCH_WEIGHT)
}

/**
 * La razón `matches-search`, si la hay.
 *
 * Las razones se devuelven aquí y no se calculan en el ranking porque son parte
 * de la misma decisión: «por qué te lo recomiendo» tiene que salir del mismo
 * cálculo que la puntuación, o acabarán diciendo cosas distintas.
 */
export function searchReason(
  candidate: Candidate,
  historial: readonly SearchSignalRecord[],
  options: SearchSignalOptions = {},
): { readonly kind: 'matches-search'; readonly detail: string } | undefined {
  const ahora = options.now ?? Date.now()
  const semivida = options.halfLifeDays ?? SEARCH_HALF_LIFE_DAYS
  let mejor: { peso: number; termino: string } | undefined

  for (const registro of historial) {
    const terminos = terms(registro.query)

    for (const termino of terminos) {
      const encaje = matchScore(candidate, [termino])
      if (encaje === 0) continue

      const peso = encaje * searchWeight(registro, ahora, semivida)
      if (mejor === undefined || peso > mejor.peso) mejor = { peso, termino }
    }
  }

  return mejor === undefined
    ? undefined
    : { kind: 'matches-search', detail: `coincide con «${mejor.termino}»` }
}
