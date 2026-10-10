/**
 * Diversidad final: que el top 5 no sean cinco veces lo mismo.
 *
 * El problema es real y conocido: ordenando sólo por puntuación, cinco títulos del
 * mismo tag copan la lista, porque comparten el vector que más pesa. Quien mira la
 * lista ve una sola recomendación repetida cinco veces.
 *
 * MMR (maximal marginal relevance) lo arregla con una idea simple: en cada paso se
 * elige el candidato que maximiza
 *
 *     λ · relevancia − (1 − λ) · parecido con lo ya elegido
 *
 * Con λ = 0,7 manda la relevancia y la diversidad desempata; con λ = 0 sería una
 * lista de títulos todos distintos y ninguno bueno, y con λ = 1, la lista de
 * siempre. El 0,7 es del spec.
 */

import type { Candidate } from '@nn-anime/core'
import { candidateFeatures } from './affinity'

/** Cuánto manda la relevancia frente a la diversidad. */
export const DEFAULT_LAMBDA = 0.7

export interface RankedCandidate {
  readonly candidate: Candidate
  readonly score: number
}

/** Parecido entre dos candidatos, por sus características compartidas. */
export function similarity(a: Candidate, b: Candidate): number {
  const unas = new Set(candidateFeatures(a))
  const otras = new Set(candidateFeatures(b))
  if (unas.size === 0 || otras.size === 0) return 0

  let comunes = 0
  for (const clave of unas) if (otras.has(clave)) comunes += 1

  // Jaccard: lo que comparten sobre lo que suman. Con un solo tag en común y
  // ningún otro, el parecido es 1; con diez tags y uno en común, es bajo.
  return comunes / (unas.size + otras.size - comunes)
}

export interface MmrOptions {
  readonly lambda?: number
  readonly limit?: number
}

/**
 * Reordena una lista ya puntuada para que sea diversa.
 *
 * Se conservan las puntuaciones originales: MMR decide **el orden**, no cambia lo
 * que vale cada título. Cambiarlas rompería la promesa de que la razón que se
 * enseña sale del mismo cálculo que la puntuación.
 */
/**
 * Parecido entre dos conjuntos de características, con Jaccard.
 *
 * Es la versión que usa el bucle: los conjuntos se construyen **una vez** por
 * candidato, no en cada comparación. Construirlos dentro costaba 868 ms de los
 * 950 del ranking con 5 000 candidatos —lo midió la prueba de presupuesto, que se
 * quedaba colgada en vez de fallar— y así cuesta unos pocos.
 */
function similarityOf(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0

  // Se recorre el más corto: el parecido es simétrico.
  const [corto, largo] = a.size <= b.size ? [a, b] : [b, a]
  let comunes = 0
  for (const clave of corto) if (largo.has(clave)) comunes += 1

  return comunes / (a.size + b.size - comunes)
}

export function mmr(
  ranking: readonly RankedCandidate[],
  options: MmrOptions = {},
): readonly RankedCandidate[] {
  const lambda = options.lambda ?? DEFAULT_LAMBDA
  const limite = options.limit ?? ranking.length
  // Las características se calculan una vez por candidato.
  const pendientes = ranking.map((entrada) => ({
    entrada,
    caracteristicas: new Set(candidateFeatures(entrada.candidate)),
  }))
  const elegidos: { entrada: RankedCandidate; caracteristicas: Set<string> }[] = []

  while (elegidos.length < limite && pendientes.length > 0) {
    let mejorIndice = 0
    let mejorValor = Number.NEGATIVE_INFINITY

    for (const [indice, candidato] of pendientes.entries()) {
      // El primero se elige por relevancia pura: no hay nada con lo que comparar.
      let parecido = 0
      for (const previo of elegidos) {
        const valor = similarityOf(previo.caracteristicas, candidato.caracteristicas)
        if (valor > parecido) parecido = valor
      }

      const valor = lambda * candidato.entrada.score - (1 - lambda) * parecido
      if (valor > mejorValor) {
        mejorValor = valor
        mejorIndice = indice
      }
    }

    elegidos.push(pendientes[mejorIndice] as (typeof pendientes)[number])
    pendientes.splice(mejorIndice, 1)
  }

  return elegidos.map((elegido) => elegido.entrada)
}
