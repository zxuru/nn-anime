/**
 * Afinidad del usuario: qué le gusta, cuánto y desde cuándo.
 *
 * Es la base del motor de recomendación. Tres ideas, y cada una resuelve un
 * problema concreto:
 *
 * 1. **Decaimiento temporal con semivida.** Lo que alguien vio hace un año dice
 *    menos de lo que le gusta hoy que lo que vio ayer. Con semivida de 30 días,
 *    un visionado de hace un mes pesa la mitad, y uno de hace dos, un cuarto.
 * 2. **IDF sobre el corpus de candidatos.** Un tag que aparece en el 80 % del
 *    catálogo no distingue nada; uno que aparece en el 5 %, mucho. Sin esto, el
 *    motor recomienda «acción» a quien ve anime, que es lo mismo que no
 *    recomendar nada.
 * 3. **Coseno.** Comparar direcciones y no magnitudes: a quien ha visto cien
 *    episodios no le gustan más las cosas que a quien ha visto diez, le gustan
 *    las mismas con más datos.
 *
 * El reloj se inyecta (`now`) porque una prueba de decaimiento no puede depender
 * de en qué día se ejecute.
 */

import type { Candidate } from '@nn-anime/core'

/** Días que tarda un peso en valer la mitad. */
export const HALF_LIFE_DAYS = 30

/** Lo que suma cada estudio compartido con el candidato. */
export const STUDIO_BONUS = 0.1

/** Un visionado, tal como lo ve el motor. */
export interface AffinityEvent {
  readonly tags: readonly string[]
  readonly studios: readonly string[]
  readonly year?: number | undefined
  /** Cuándo pasó. */
  readonly at: Date | number
  /**
   * Cuánto se vio, de 0 a 1.
   *
   * Un episodio abandonado a los dos minutos dice mucho menos que uno terminado,
   * y un favorito dice más que cualquier episodio: es una declaración explícita.
   */
  readonly completion: number
}

/** Un vector de pesos por característica. */
export interface AffinityVector {
  readonly weights: ReadonlyMap<string, number>
  /** Norma euclídea, para el coseno. */
  readonly norm: number
}

export const EMPTY_VECTOR: AffinityVector = { weights: new Map(), norm: 0 }

/** La clave de una característica. Prefijos para que no se mezclen. */
export function tagKey(tag: string): string {
  return `tag:${tag}`
}

export function studioKey(studio: string): string {
  return `studio:${studio}`
}

export function yearKey(year: number): string {
  return `year:${year}`
}

/** Las características de un candidato, en el mismo espacio que la afinidad. */
export function candidateFeatures(candidate: Candidate): readonly string[] {
  const claves = [
    ...candidate.tags.map(tagKey),
    ...candidate.studios.map(studioKey),
    ...(candidate.year === undefined ? [] : [yearKey(candidate.year)]),
  ]

  return [...new Set(claves)]
}

/**
 * Cuánto queda de un peso después de un tiempo.
 *
 * `0.5 ** (días / semivida)`: a los 30 días vale la mitad, a los 60 un cuarto.
 * Un evento futuro (reloj movido hacia atrás) no se premia: se trata como
 * «ahora», porque un peso mayor que 1 sería un error de quien llama, no una
 * señal.
 */
export function decay(
  at: Date | number,
  now: Date | number,
  halfLifeDays: number = HALF_LIFE_DAYS,
): number {
  const desde = at instanceof Date ? at.getTime() : at
  const hasta = now instanceof Date ? now.getTime() : now
  const dias = Math.max(0, (hasta - desde) / 86_400_000)

  if (halfLifeDays <= 0) return 1

  return 0.5 ** (dias / halfLifeDays)
}

/** El peso de un evento: recencia por completitud. */
export function eventWeight(
  event: AffinityEvent,
  now: Date | number,
  halfLifeDays: number = HALF_LIFE_DAYS,
): number {
  const completitud = Math.min(Math.max(event.completion, 0), 1)

  return decay(event.at, now, halfLifeDays) * completitud
}

/**
 * Cuánto distingue una característica dentro del corpus.
 *
 * IDF suavizado: `ln((N + 1) / (df + 1)) + 1`. Nunca es cero —una característica
 * que está en todos los candidatos sigue contando algo— y no se dispara con las
 * que aparecen una sola vez, que es lo que pasaría sin el `+1`.
 */
export function idf(corpus: readonly Candidate[], feature: string): number {
  if (corpus.length === 0) return 1

  const conLaCaracteristica = corpus.filter((candidato) =>
    candidateFeatures(candidato).includes(feature),
  ).length

  return Math.log((corpus.length + 1) / (conLaCaracteristica + 1)) + 1
}

/** Normaliza un mapa de pesos a norma 1, sin dividir por cero. */
export function normalize(weights: ReadonlyMap<string, number>): AffinityVector {
  let suma = 0
  for (const peso of weights.values()) suma += peso * peso

  const norm = Math.sqrt(suma)
  if (norm === 0) return EMPTY_VECTOR

  const salida = new Map<string, number>()
  for (const [clave, peso] of weights) salida.set(clave, peso / norm)

  return { weights: salida, norm: 1 }
}

export interface AffinityOptions {
  readonly halfLifeDays?: number
  /** Corpus con el que calcular el IDF. Sin él, todos los pesos valen igual. */
  readonly corpus?: readonly Candidate[] | undefined
  readonly idf?: boolean | undefined
}

/**
 * El vector de afinidad de un historial.
 *
 * **El corpus tiene que ser el mismo con el que se puntúa después.** El IDF mete
 * las características en un espacio de pesos, y dos vectores construidos con
 * corpus distintos viven en espacios distintos: el coseno sale bajo sin que nada
 * avise, y el ranking se ordena mal sin dar ningún error. Es la trampa de esta
 * función, y tiene su prueba.
 *
 * Se suman los pesos de todos los eventos por característica, se multiplica por
 * el IDF de cada una y se normaliza. El orden importa: el IDF se aplica sobre la
 * suma, no evento a evento, porque lo que se pondera es «cuánto le gusta este
 * tag», no cada visionado por separado.
 */
export function buildAffinity(
  events: readonly AffinityEvent[],
  now: Date | number,
  options: AffinityOptions = {},
): AffinityVector {
  const semivida = options.halfLifeDays ?? HALF_LIFE_DAYS
  const corpus = options.corpus ?? []
  const usarIdf = options.idf ?? corpus.length > 0
  const suma = new Map<string, number>()

  for (const evento of events) {
    const peso = eventWeight(evento, now, semivida)
    if (peso <= 0) continue

    const claves = [
      ...evento.tags.map(tagKey),
      ...evento.studios.map(studioKey),
      ...(evento.year === undefined ? [] : [yearKey(evento.year)]),
    ]

    for (const clave of new Set(claves)) {
      suma.set(clave, (suma.get(clave) ?? 0) + peso)
    }
  }

  if (usarIdf && corpus.length > 0) {
    for (const [clave, peso] of suma) suma.set(clave, peso * idf(corpus, clave))
  }

  return normalize(suma)
}

/** El vector de un candidato, con el mismo IDF que la afinidad. */
export function candidateVector(
  candidate: Candidate,
  corpus: readonly Candidate[],
  options: { readonly idf?: boolean | undefined } = {},
): AffinityVector {
  const usarIdf = options.idf ?? corpus.length > 0
  const pesos = new Map<string, number>()

  for (const clave of candidateFeatures(candidate)) {
    pesos.set(clave, usarIdf && corpus.length > 0 ? idf(corpus, clave) : 1)
  }

  return normalize(pesos)
}

/**
 * Similitud coseno.
 *
 * Un vector vacío da 0 y no `NaN`: dividir por cero es el fallo clásico de esta
 * función, y un `NaN` se propaga por todo el ranking sin que nadie lo vea.
 */
export function cosine(a: AffinityVector, b: AffinityVector): number {
  if (a.norm === 0 || b.norm === 0) return 0

  // Se recorre el más corto: el coseno es simétrico y así se hacen menos
  // comparaciones.
  const [corto, largo] = a.weights.size <= b.weights.size ? [a, b] : [b, a]
  let producto = 0

  for (const [clave, peso] of corto.weights) {
    const otro = largo.weights.get(clave)
    if (otro !== undefined) producto += peso * otro
  }

  return producto / (a.norm * b.norm)
}

/** Cuántos estudios comparten la afinidad y el candidato. */
export function sharedStudios(affinity: AffinityVector, candidate: Candidate): number {
  return candidate.studios.filter((estudio) => affinity.weights.has(studioKey(estudio))).length
}

/**
 * La puntuación de un candidato: coseno más el bonus por estudio compartido.
 *
 * El bonus es pequeño a propósito: sirve para desempatar entre dos candidatos
 * parecidos, no para imponer un estudio a quien no lo ha visto nunca. Con 0,1 por
 * estudio, hacen falta diez coincidencias de estudio para igualar un coseno de 1,
 * y eso no pasa en un catálogo real.
 */
export function affinityScore(
  affinity: AffinityVector,
  candidate: Candidate,
  corpus: readonly Candidate[],
  options: AffinityOptions = {},
): number {
  // `corpus` tiene que ser el mismo que se usó para construir `affinity`: ver la
  // nota de `buildAffinity`.
  const vector = candidateVector(candidate, corpus, options)

  return cosine(affinity, vector) + STUDIO_BONUS * sharedStudios(affinity, candidate)
}
