/**
 * `recommend()`: la fachada del motor.
 *
 * Junta las señales, filtra lo que no hay que recomendar, ordena, aplica
 * diversidad y explica cada resultado. Es la única puerta: quien llama no tiene
 * que saber que existen cinco señales, ni en qué orden se suman.
 *
 * Dos garantías que el spec pide y que se sostienen con decisiones concretas:
 *
 * - **Reproducibilidad.** Con el mismo `seed`, el mismo `now` y las mismas
 *   entradas, la salida es idéntica en orden y contenido. Eso obliga a no usar
 *   `Math.random` en ninguna parte y a que los empates se rompan con un criterio
 *   estable: la referencia del título, no el orden en que llegó. Sin ese
 *   desempate, dos candidatos con la misma puntuación saldrían en distinto orden
 *   según cómo hubiera quedado el array, y el `seed` no serviría de nada.
 * - **Sin historial no se inventa nada.** Sin señales, el motor devuelve
 *   `cold-start` ordenado por popularidad, y lo dice en la razón. Es mejor que
 *   devolver una lista vacía y que inventarse un historial que no existe.
 *
 * El `seed` no se usa para sortear: se usa para **desempatar** de forma estable
 * cuando dos candidatos son idénticos en todo lo demás. Es lo que hace que dos
 * peticiones seguidas con la misma semilla den lo mismo.
 */

import type { Candidate } from '@nn-anime/core'
import {
  type AffinityEvent,
  type AffinityVector,
  buildAffinity,
  buildIdfIndex,
  candidateVector,
  cosine,
  EMPTY_VECTOR,
} from './affinity'
import { type CoVisit, coVisitScore, indexBySeen } from './covisit'
import { filterCandidates, type WatchState } from './filters'
import { mmr } from './mmr'
import { buildReasons, mainReason, type Reason, type ReasonCandidate } from './reasons'
import { type SearchSignalRecord, searchReason, searchScore } from './search-signal'

/** Pesos de cada señal en la puntuación final. */
export interface SignalWeights {
  readonly affinity: number
  readonly covisit: number
  readonly search: number
  readonly rediscovery: number
  readonly popularity: number
}

export const SIGNAL_WEIGHTS: SignalWeights = {
  affinity: 1,
  covisit: 0.5,
  search: 0.8,
  rediscovery: 0.2,
  popularity: 0.3,
}

export interface RecommendSignals {
  readonly events: readonly AffinityEvent[]
  readonly coVisits: readonly CoVisit[]
  readonly searches: readonly SearchSignalRecord[]
  readonly watchState: readonly WatchState[]
  /** La última cosa que se vio, para la señal de co-visita. */
  readonly lastSeen?: string | undefined
}

/**
 * Cuántos candidatos entran en la diversidad.
 *
 * MMR compara cada candidato con todos los ya elegidos, así que sobre el catálogo
 * entero es cuadrático: con 5 000 candidatos son millones de comparaciones y el
 * ranking pasa de 50 ms a minutos. Lo encontró la prueba de presupuesto, que se
 * quedó colgada en vez de fallar. La diversidad se aplica sobre una
 * **preselección** por puntuación, que es como se usa MMR en la práctica.
 */
export const MMR_PRESELECTION = 100

export interface RecommendOptions {
  readonly limit?: number
  readonly mmrLambda?: number
  /** Semilla para desempatar. Con la misma, el mismo orden. */
  readonly seed?: number
  readonly now?: Date | number
  readonly weights?: Partial<SignalWeights>
}

/** Lo que aportó cada señal, por separado. Se expone para poder depurarlo. */
export interface Components {
  readonly affinity: number
  readonly covisit: number
  readonly recency: number
  readonly diversity: number
  readonly search: number
  readonly popularity: number
}

export interface Recommendation {
  readonly candidate: Candidate
  readonly score: number
  readonly components: Components
  readonly reasons: readonly Reason[]
  /** La razón principal, ya escrita. Nunca vacía. */
  readonly reason: Reason
}

export interface RecommendResult {
  readonly items: readonly Recommendation[]
  /** Si no había historial, se dice: la interfaz lo usa para explicarse. */
  readonly coldStart: boolean
}

/** Popularidad normalizada; sin dato, cero y no una suposición. */
function popularidad(candidate: Candidate): number {
  return candidate.popularity ?? 0
}

/**
 * Un desempate estable y dependiente de la semilla.
 *
 * Se calcula con la referencia y la semilla, sin azar: la misma entrada da el
 * mismo número, que es lo que exige la reproducibilidad. No es un hash
 * criptográfico, sólo tiene que repartir.
 */
export function tieBreak(candidate: Candidate, seed: number): number {
  const texto = `${candidate.ref.providerId}#${candidate.ref.value}#${seed}`
  let valor = 2_166_136_261

  for (let indice = 0; indice < texto.length; indice++) {
    valor ^= texto.charCodeAt(indice)
    valor = Math.imul(valor, 16_777_619)
  }

  return (valor >>> 0) / 4_294_967_296
}

/** Compara dos candidatos ya puntuados, con desempate estable. */
function compare(a: Recommendation, b: Recommendation, seed: number): number {
  if (b.score !== a.score) return b.score - a.score

  const desempate = tieBreak(a.candidate, seed) - tieBreak(b.candidate, seed)
  if (desempate !== 0) return desempate

  // Último recurso: la referencia. Sin esto, dos candidatos con el mismo
  // desempate saldrían en el orden en que llegaron, y ese orden no está
  // garantizado entre dos llamadas.
  return `${a.candidate.ref.providerId}#${a.candidate.ref.value}`.localeCompare(
    `${b.candidate.ref.providerId}#${b.candidate.ref.value}`,
  )
}

export function recommend(
  signals: RecommendSignals,
  candidates: readonly Candidate[],
  options: RecommendOptions = {},
): RecommendResult {
  const ahora = options.now ?? Date.now()
  const limite = options.limit ?? 20
  const pesos = { ...SIGNAL_WEIGHTS, ...(options.weights ?? {}) }
  const semilla = options.seed ?? 0
  const coldStart = signals.events.length === 0 && signals.searches.length === 0

  // Filtro: fuera lo ya visto, salvo el reencuentro.
  const estados = new Map(signals.watchState.map((estado) => [`${estado.ref}`, estado]))
  const filtrados = filterCandidates(candidates, estados, { now: ahora })

  // Las frecuencias se cuentan **una vez** para todo el ranking: contarlas por
  // candidato convierte el cálculo en cuadrático y con 5 000 candidatos pasa de
  // 50 ms a minutos. Lo encontró la prueba de presupuesto, que se quedó colgada
  // en vez de fallar.
  const indiceIdf = buildIdfIndex(candidates)

  const afinidad: AffinityVector =
    signals.events.length === 0
      ? EMPTY_VECTOR
      : buildAffinity(signals.events, ahora, { idfIndex: indiceIdf })

  const indiceCoVisita = indexBySeen(signals.coVisits)

  const puntuados: Recommendation[] = filtrados.map(({ candidate, rediscovery }) => {
    const afinidadPuntos =
      afinidad.norm === 0
        ? 0
        : cosine(afinidad, candidateVector(candidate, candidates, { idfIndex: indiceIdf }))
    const coVisitaPuntos = coVisitScore(indiceCoVisita, signals.lastSeen, clave(candidate))
    const busquedaPuntos = searchScore(candidate, signals.searches, { now: ahora })
    const popularidadPuntos = popularidad(candidate)

    const components: Components = {
      affinity: afinidadPuntos,
      covisit: coVisitaPuntos,
      recency: rediscovery,
      diversity: 0,
      search: busquedaPuntos,
      popularity: popularidadPuntos,
    }

    const score =
      pesos.affinity * afinidadPuntos +
      pesos.covisit * coVisitaPuntos +
      pesos.search * busquedaPuntos +
      pesos.rediscovery * rediscovery +
      pesos.popularity * popularidadPuntos

    const razones = razonesDe(candidate, {
      signals,
      ahora,
      afinidad,
      afinidadPuntos,
      coVisitaPuntos,
      busquedaPuntos,
      popularidadPuntos,
      rediscovery,
      coldStart,
    })

    // La lista nunca va vacía: si ninguna señal aportó nada, queda la razón
    // genérica. Una recomendación sin explicación es lo que el spec prohíbe, y una
    // lista vacía con `reason` llena sería una contradicción. Lo encontró la
    // prueba de la ruta.
    const conGenerica = razones.length === 0 ? [mainReason([])] : razones

    return {
      candidate,
      score,
      components,
      reasons: conGenerica,
      reason: mainReason(conGenerica),
    }
  })

  // Sin historial: sólo `cold-start`, ordenado por popularidad. La puntuación ya
  // lo refleja, así que aquí sólo se ordena y se corta.
  const ordenados = puntuados.sort((a, b) => compare(a, b, semilla))
  // El índice de posiciones se construye una vez: buscarla con `indexOf` dentro
  // del recorrido volvía a hacer el ranking cuadrático.
  const posiciones = new Map(ordenados.map((entrada, indice) => [clave(entrada.candidate), indice]))
  const porTitulo = new Map(ordenados.map((entrada) => [clave(entrada.candidate), entrada]))
  const preseleccion = ordenados.slice(0, Math.max(limite, MMR_PRESELECTION))

  const conDiversidad = mmr(
    preseleccion.map((entrada) => ({ candidate: entrada.candidate, score: entrada.score })),
    {
      limit: preseleccion.length,
      ...(options.mmrLambda === undefined ? {} : { lambda: options.mmrLambda }),
    },
  )

  const items = conDiversidad
    .map((entrada, indice) => {
      const original = porTitulo.get(clave(entrada.candidate))
      if (original === undefined) return undefined

      // La diversidad se expone como la caída de posición que sufrió: es la
      // forma de ver si MMR está moviendo la lista o no la está tocando.
      const posicionOriginal = posiciones.get(clave(entrada.candidate)) ?? indice
      const components: Components = {
        ...original.components,
        diversity: posicionOriginal - indice,
      }

      return { ...original, components }
    })
    .filter((entrada): entrada is Recommendation => entrada !== undefined)
    .slice(0, limite)

  return { items, coldStart }
}

function clave(candidate: Candidate): string {
  return `${candidate.ref.providerId}#${candidate.ref.value}`
}

interface ContextoRazones {
  readonly signals: RecommendSignals
  readonly ahora: Date | number
  readonly afinidad: AffinityVector
  readonly afinidadPuntos: number
  readonly coVisitaPuntos: number
  readonly busquedaPuntos: number
  readonly popularidadPuntos: number
  readonly rediscovery: number
  readonly coldStart: boolean
}

/** Las razones de un candidato, cada una producida por la señal que sumó. */
function razonesDe(candidate: Candidate, contexto: ContextoRazones): readonly Reason[] {
  const candidatas: ReasonCandidate[] = []
  const razonBusqueda = searchReason(candidate, contexto.signals.searches, { now: contexto.ahora })

  if (razonBusqueda !== undefined) {
    candidatas.push({
      kind: 'matches-search',
      key: 'reason.matches-search',
      evidence: {
        weight: contexto.busquedaPuntos * SIGNAL_WEIGHTS.search,
        value: razonBusqueda.detail,
      },
      values: { term: terminoDe(razonBusqueda.detail) },
    })
  }

  if (contexto.coVisitaPuntos > 0 && contexto.signals.lastSeen !== undefined) {
    candidatas.push({
      kind: 'covisit',
      key: 'reason.covisit',
      evidence: {
        weight: contexto.coVisitaPuntos * SIGNAL_WEIGHTS.covisit,
        value: contexto.signals.lastSeen,
      },
      values: { seen: contexto.signals.lastSeen },
    })
  }

  if (contexto.rediscovery > 0) {
    candidatas.push({
      kind: 'rediscovery',
      key: 'reason.rediscovery',
      evidence: { weight: contexto.rediscovery * SIGNAL_WEIGHTS.rediscovery },
      values: {},
    })
  }

  const genero = generoCompartido(contexto.afinidad, candidate)
  if (genero !== undefined && contexto.afinidadPuntos > 0) {
    candidatas.push({
      kind: 'same-genre',
      key: 'reason.same-genre',
      evidence: { weight: contexto.afinidadPuntos * SIGNAL_WEIGHTS.affinity, value: genero },
      values: { genre: genero },
    })
  }

  const estudio = estudioCompartido(contexto.afinidad, candidate)
  if (estudio !== undefined && contexto.afinidadPuntos > 0) {
    candidatas.push({
      kind: 'same-studio',
      key: 'reason.same-studio',
      evidence: { weight: contexto.afinidadPuntos * SIGNAL_WEIGHTS.affinity * 0.5, value: estudio },
      values: { studio: estudio },
    })
  }

  if (contexto.popularidadPuntos > 0) {
    candidatas.push({
      kind: contexto.coldStart ? 'trending' : 'popular',
      key: contexto.coldStart ? 'reason.trending' : 'reason.popular',
      evidence: { weight: contexto.popularidadPuntos * SIGNAL_WEIGHTS.popularity },
      values: {},
    })
  }

  return buildReasons(candidatas)
}

/** El término que se cita en la razón de búsqueda, sin las comillas del detalle. */
function terminoDe(detail: string): string {
  const coincidencia = /«([^»]*)»/.exec(detail)

  return coincidencia?.[1] ?? detail
}

/** El género que la afinidad y el candidato comparten, si hay alguno. */
function generoCompartido(afinidad: AffinityVector, candidate: Candidate): string | undefined {
  return candidate.tags.find((tag) => afinidad.weights.has(`tag:${tag}`))
}

/** El estudio compartido, si lo hay. */
function estudioCompartido(afinidad: AffinityVector, candidate: Candidate): string | undefined {
  return candidate.studios.find((estudio) => afinidad.weights.has(`studio:${estudio}`))
}
