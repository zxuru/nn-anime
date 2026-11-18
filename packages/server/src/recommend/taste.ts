/**
 * Puente entre el perfil guardado y el motor puro.
 *
 * El motor no conoce referencias ni la base: recibe candidatos y un
 * `TasteSignals` ya resuelto. Aquí se resuelven los títulos marcados contra el
 * corpus —un título que la base no conoce no puede aportar sus géneros— y se
 * preparan las filas del inicio.
 *
 * Nada de esto pide a un proveedor: la encuesta y las filas salen del catálogo
 * que la aplicación ya tiene. Una recomendación de arranque no puede depender de
 * que un tercero conteste justo cuando el usuario acaba de llegar.
 */

import type { CatalogStore } from '@rona/catalog-store'
import {
  type AnimeSummary,
  type Candidate,
  normalizeGenreName,
  type TasteProfile,
  type TasteRow,
  titleKindSchema,
} from '@rona/core'
import type { TasteSignals } from '@rona/recsys'

/** Cuántos títulos enseña la encuesta. El requisito pide entre diez y doce. */
export const TASTE_TITLE_LIMIT = 12

/** Cuántas piezas lleva cada fila del inicio. */
export const TASTE_ROW_LIMIT = 8

function clave(ref: { readonly providerId: string; readonly value: string }): string {
  return `${ref.providerId}#${ref.value}`
}

/** El resumen que viaja en una tarjeta, a partir de un candidato. */
export function summaryOf(candidate: Candidate): AnimeSummary {
  return {
    ref: candidate.ref,
    title: candidate.title,
    ...(candidate.coverUrl === undefined ? {} : { coverUrl: candidate.coverUrl }),
    ...(candidate.year === undefined ? {} : { year: candidate.year }),
    ...(candidate.kind === undefined ? {} : { kind: candidate.kind }),
    ...(candidate.family === undefined ? {} : { family: candidate.family }),
    ...(candidate.format === undefined ? {} : { format: candidate.format }),
  }
}

/**
 * El perfil convertido en señales del motor.
 *
 * Un perfil sin empezar devuelve `undefined`: el motor distingue «no hay
 * encuesta» de «hay encuesta vacía» y con la segunda no debe apagar el
 * comportamiento ni el arranque en frío.
 */
export function tasteSignalsFrom(
  profile: TasteProfile | undefined,
  candidates: readonly Candidate[],
  behaviorEvents: number,
): TasteSignals | undefined {
  if (profile === undefined) return undefined

  const porClave = new Map(candidates.map((candidate) => [clave(candidate.ref), candidate]))
  const liked = profile.titles
    .map((title) => porClave.get(`${title.providerId}#${title.ref}`))
    .filter((candidate): candidate is Candidate => candidate !== undefined)

  const tieneAlgo =
    profile.genres.length > 0 ||
    profile.excludedGenres.length > 0 ||
    profile.titles.length > 0 ||
    profile.format !== null ||
    profile.tone !== null

  if (!tieneAlgo && profile.survey.status === 'not_started') return undefined

  return {
    genres: profile.genres.map((genre) => ({ name: genre.name, weight: genre.weight })),
    excludedGenres: profile.excludedGenres.map((genre) => genre.name),
    liked,
    ...(profile.format === null ? {} : { format: profile.format.value }),
    ...(profile.tone === null ? {} : { tone: profile.tone.value }),
    behaviorEvents,
  }
}

/**
 * Los títulos populares que enseña el paso 2.
 *
 * Se leen del catálogo ya cacheado, en el orden en que lo trae —lo más reciente
 * primero—, y se cortan a doce. No se pide a ningún proveedor: si la base está
 * vacía, la encuesta enseña menos títulos y el paso sigue siendo válido.
 */
export function popularTitles(
  store: Pick<CatalogStore, 'listCandidates'>,
  limit: number = TASTE_TITLE_LIMIT,
): Promise<readonly AnimeSummary[]> {
  return store.listCandidates(Math.max(limit * 4, limit)).then((filas) => {
    const vistos = new Set<string>()
    const salida: AnimeSummary[] = []

    for (const fila of filas) {
      if (salida.length >= limit) break

      const id = `${fila.ref.providerId}#${fila.ref.value}`
      if (vistos.has(id)) continue
      vistos.add(id)

      // El `kind` de la base es texto libre; sólo entra si es del vocabulario.
      const kind = fila.kind === undefined ? undefined : titleKindSchema.safeParse(fila.kind)

      salida.push({
        ref: fila.ref,
        title: fila.title,
        ...(fila.coverUrl === undefined ? {} : { coverUrl: fila.coverUrl }),
        ...(fila.year === undefined ? {} : { year: fila.year }),
        ...(kind?.success === true ? { kind: kind.data } : {}),
      })
    }

    return salida
  })
}

/**
 * Las filas «Porque te gusta…» del inicio.
 *
 * Se construyen **filtrando el catálogo que ya existe**, nunca añadiendo nada:
 * el requisito es ordenar el inicio con el perfil, no cambiar lo disponible. De
 * cada género preferido se toman sus mejores piezas, sin repetir obra entre
 * filas y sin colar un género excluido.
 */
export function tasteRowsFrom(
  profile: TasteProfile | undefined,
  candidates: readonly Candidate[],
  limite: number = TASTE_ROW_LIMIT,
): readonly TasteRow[] {
  if (profile === undefined || limite <= 0) return []

  const excluidos = new Set(profile.excludedGenres.map((genre) => normalizeGenreName(genre.name)))
  const generos = [...profile.genres]
    .filter((genre) => genre.weight > 0)
    .sort((uno, otro) => otro.weight - uno.weight || uno.name.localeCompare(otro.name))

  const filas: TasteRow[] = []
  const yaEstan = new Set<string>()

  for (const genero of generos) {
    if (filas.length >= 3) break

    const buscado = normalizeGenreName(genero.name)
    const items: AnimeSummary[] = []

    for (const candidate of candidates) {
      if (items.length >= limite) break

      const id = clave(candidate.ref)
      if (yaEstan.has(id)) continue
      if (candidate.tags.some((tag) => excluidos.has(normalizeGenreName(tag)))) continue
      if (!candidate.tags.some((tag) => normalizeGenreName(tag) === buscado)) continue

      yaEstan.add(id)
      items.push(summaryOf(candidate))
    }

    // Una fila vacía no se enseña: decir «porque te gusta el mecha» y no poner
    // nada debajo es peor que no tener la fila.
    if (items.length > 0) filas.push({ genre: genero.name, items })
  }

  return filas
}
