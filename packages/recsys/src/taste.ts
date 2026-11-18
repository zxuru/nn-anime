/**
 * Lo que la encuesta declara y cómo entra en el motor.
 *
 * La encuesta no es un adorno: sin historial, es **la única señal** que tiene el
 * motor. Tres decisiones sostienen este módulo:
 *
 * 1. **Los títulos marcados pesan más que los géneros.** «Me gustó Frieren» dice
 *    mucho más que «me gusta la fantasía», y permite recomendar por similitud
 *    aunque el usuario no haya visto nada todavía.
 * 2. **Lo declarado y lo observado se mezclan con una cuota que se desplaza.**
 *    Al principio manda la encuesta; a medida que hay visionados, el
 *    comportamiento ocupa su sitio. La cuota no llega a cero: siempre queda un
 *    mínimo de lo que el usuario dijo, porque lo declarado y lo real suelen
 *    diferir y borrar del todo la declaración convierte un mal día en un perfil.
 * 3. **Los géneros excluidos excluyen.** No restan puntos: si el usuario dijo que
 *    no quiere ver terror, una obra de terror no se le recomienda.
 *
 * El módulo es puro: recibe candidatos y un perfil ya resuelto. Resolver las
 * referencias de los títulos marcados es cosa del servidor, que es quien tiene el
 * corpus.
 */

import { type Candidate, normalizeGenreName } from '@rona/core'
import {
  type AffinityVector,
  candidateFeatures,
  candidateVector,
  cosine,
  EMPTY_VECTOR,
  type IdfIndex,
  idfOf,
  normalize,
  tagKey,
} from './affinity'

/** Eventos de comportamiento en los que lo declarado ya sólo aporta el mínimo. */
export const TASTE_REPLACEMENT_EVENTS = 20

/**
 * La cuota mínima de lo declarado.
 *
 * No se baja de aquí: una racha de tres episodios abandonados no puede borrar
 * lo que el usuario contestó hace una semana. La encuesta sigue siendo suya.
 */
export const TASTE_MIN_DECLARED_SHARE = 0.15

/** Lo que un título marcado aporta frente a un género suelto. */
export const TASTE_LIKED_WEIGHT = 1

/** Los tres formatos que ofrece la encuesta. */
export type TasteFormat = 'long-series' | 'short-series' | 'movies'

/** Los tres tonos que ofrece la encuesta. */
export type TasteTone = 'dark' | 'light' | 'emotional'

/** Un gusto declarado, ya resuelto contra el catálogo. */
export interface TasteSignals {
  readonly genres: readonly { readonly name: string; readonly weight: number }[]
  readonly excludedGenres: readonly string[]
  /** Los títulos marcados, resueltos a candidatos del corpus. */
  readonly liked: readonly Candidate[]
  readonly format?: TasteFormat | undefined
  readonly tone?: TasteTone | undefined
  /** Cuántos visionados hay: es lo que decide cuánto manda lo observado. */
  readonly behaviorEvents: number
}

/**
 * Los géneros que se asocian a cada tono.
 *
 * El catálogo no publica un campo «tono», así que se deduce de los géneros, que
 * es lo que sí publica. La lista es deliberadamente corta: un género que no está
 * no empuja ninguna obra hacia un tono, y eso es mejor que inventarse uno.
 */
export const TONE_GENRES: Readonly<Record<TasteTone, readonly string[]>> = {
  dark: [
    'terror',
    'horror',
    'thriller',
    'suspense',
    'psicologico',
    'psychological',
    'misterio',
    'mystery',
    'gore',
    'dark fantasy',
  ],
  light: [
    'comedia',
    'comedy',
    'recuentos de la vida',
    'slice of life',
    'parodia',
    'parody',
    'ecchi',
    'isekai',
  ],
  emotional: ['drama', 'romance', 'musica', 'music', 'tragedia', 'tragedy', 'melodrama'],
}

/**
 * La cuota de lo declarado, de 1 a `TASTE_MIN_DECLARED_SHARE`.
 *
 * Es lineal a propósito: cada visionado quita el mismo trozo y el usuario puede
 * entender por qué su encuesta pesa menos sin leer una fórmula. En cero
 * visionados manda entero; en `replacementAt` queda el mínimo.
 */
export function declaredShare(
  behaviorEvents: number,
  replacementAt: number = TASTE_REPLACEMENT_EVENTS,
): number {
  const eventos = Number.isFinite(behaviorEvents) ? Math.max(0, behaviorEvents) : 0
  const tope = Number.isFinite(replacementAt)
    ? Math.max(1, replacementAt)
    : TASTE_REPLACEMENT_EVENTS
  const avance = Math.min(eventos / tope, 1)

  return Math.max(TASTE_MIN_DECLARED_SHARE, 1 - avance)
}

/** El tono de un título, si sus géneros lo dicen. */
export function toneOf(tags: readonly string[]): TasteTone | undefined {
  const normalizados = new Set(tags.map(normalizeGenreName))
  let mejor: TasteTone | undefined
  let mejorCuenta = 0

  for (const tono of ['dark', 'light', 'emotional'] as const) {
    const cuenta = TONE_GENRES[tono].filter((genero) => normalizados.has(genero)).length

    if (cuenta > mejorCuenta) {
      mejor = tono
      mejorCuenta = cuenta
    }
  }

  return mejor
}

/** Si un título pasa las exclusiones del perfil. */
export function passesTaste(candidate: Candidate, taste: TasteSignals | undefined): boolean {
  if (taste === undefined || taste.excludedGenres.length === 0) return true

  const excluidos = new Set(taste.excludedGenres.map(normalizeGenreName))

  return !candidate.tags.some((tag) => excluidos.has(normalizeGenreName(tag)))
}

/**
 * El vector de lo declarado: géneros elegidos y títulos marcados.
 *
 * Se normaliza para que un perfil con diez géneros no pese más que uno con dos.
 * Los títulos entran con sus géneros y estudios, que es lo que comparten con los
 * candidatos; un título marcado que el corpus no conoce no puede aportar vector y
 * el servidor no lo pasa.
 */
export function declaredVector(
  taste: TasteSignals | undefined,
  candidates: readonly Candidate[],
  idfIndex: IdfIndex,
): AffinityVector {
  if (taste === undefined) return EMPTY_VECTOR

  const pesos = new Map<string, number>()

  for (const genero of taste.genres) {
    const peso = genero.weight
    if (peso <= 0) continue

    const clave = tagKey(genero.name)
    pesos.set(clave, (pesos.get(clave) ?? 0) + peso * idfOf(idfIndex, clave))
  }

  if (taste.liked.length > 0) {
    const cuota = TASTE_LIKED_WEIGHT / taste.liked.length

    for (const titulo of taste.liked) {
      for (const clave of candidateFeatures(titulo)) {
        pesos.set(clave, (pesos.get(clave) ?? 0) + cuota * idfOf(idfIndex, clave))
      }
    }
  }

  // `candidates` no se usa hoy, pero se pide para dejar claro que el IDF se
  // calcula sobre el mismo corpus con el que se puntúa. Quien llame ya lo tiene.
  void candidates

  return normalize(pesos)
}

/** Cuánto encaja el formato del candidato con el que eligió el usuario. */
export function formatMatch(candidate: Candidate, taste: TasteSignals): number | undefined {
  if (taste.format === undefined) return undefined

  const esPelicula = candidate.format === 'movie' || candidate.kind === 'movie'
  const esSerie = candidate.format === 'series' || (!esPelicula && candidate.format === undefined)

  if (taste.format === 'movies') return esPelicula ? 1 : 0
  // Larga y corta comparten la señal de serie: el candidato no publica cuántos
  // episodios tiene, y fingir que se distingue sería medir el título por su nombre.
  if (taste.format === 'long-series' || taste.format === 'short-series') return esSerie ? 1 : 0

  return undefined
}

/** Cuánto encaja el tono del candidato con el que eligió el usuario. */
export function toneMatch(candidate: Candidate, taste: TasteSignals): number | undefined {
  if (taste.tone === undefined) return undefined

  const tono = toneOf(candidate.tags)
  if (tono === undefined) return 0.5

  return tono === taste.tone ? 1 : 0
}

/**
 * La parte del gusto declarado que no va dentro del vector: formato y tono.
 *
 * Los géneros y los títulos ya suman por afinidad declarada; sumarlos otra vez
 * aquí contaría dos veces la misma señal. Esta puntuación sólo mide lo que el
 * vector no puede: que el usuario prefiera películas o que busque un tono.
 */
export function tastePreferenceScore(candidate: Candidate, taste: TasteSignals): number {
  const partes: number[] = []

  const formato = formatMatch(candidate, taste)
  if (formato !== undefined) partes.push(formato)

  const tono = toneMatch(candidate, taste)
  if (tono !== undefined) partes.push(tono)

  if (partes.length === 0) return 0

  return partes.reduce((suma, valor) => suma + valor, 0) / partes.length
}

/** Si hay algo declarado que merezca personalizar la lista. */
export function hasTasteSignals(taste: TasteSignals | undefined): boolean {
  if (taste === undefined) return false

  return (
    taste.genres.length > 0 ||
    taste.liked.length > 0 ||
    taste.excludedGenres.length > 0 ||
    taste.format !== undefined ||
    taste.tone !== undefined
  )
}

/** El género preferido que comparte un candidato, para poder explicarlo. */
export function declaredGenreOf(
  taste: TasteSignals | undefined,
  candidate: Candidate,
): string | undefined {
  if (taste === undefined) return undefined

  const preferidos = taste.genres
    .filter((genero) => genero.weight > 0)
    .map((genero) => normalizeGenreName(genero.name))
  if (preferidos.length === 0) return undefined

  return candidate.tags.find((tag) => preferidos.includes(normalizeGenreName(tag)))
}

/**
 * El título marcado con el que más se parece un candidato.
 *
 * Se comparan los géneros; si hay empate gana el primero del perfil, que es el
 * orden en que el usuario los marcó. Sirve para la razón «se parece a…», que es
 * la más convincente de las tres.
 */
export function likedTitleOf(
  taste: TasteSignals | undefined,
  candidate: Candidate,
): Candidate | undefined {
  if (taste === undefined || taste.liked.length === 0) return undefined

  const suyos = new Set(candidate.tags.map(normalizeGenreName))
  let mejor: Candidate | undefined
  let mejorCuenta = 0

  for (const titulo of taste.liked) {
    const cuenta = titulo.tags.filter((tag) => suyos.has(normalizeGenreName(tag))).length

    if (cuenta > mejorCuenta) {
      mejor = titulo
      mejorCuenta = cuenta
    }
  }

  return mejorCuenta === 0 ? undefined : mejor
}

/** La puntuación declarada de un candidato, ya mezclada con la cuota. */
export function declaredScore(
  candidate: Candidate,
  taste: TasteSignals | undefined,
  candidates: readonly Candidate[],
  idfIndex: IdfIndex,
  share: number,
): number {
  if (taste === undefined || share <= 0) return 0

  const vector = declaredVector(taste, candidates, idfIndex)
  if (vector.norm === 0) return 0

  return cosine(vector, candidateVector(candidate, candidates, { idfIndex })) * share
}
