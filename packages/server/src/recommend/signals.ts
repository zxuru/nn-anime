/**
 * De dónde salen las señales y los candidatos del motor.
 *
 * El motor es puro: recibe señales y candidatos y devuelve un ranking. Este
 * módulo es el que mira la base y los proveedores, y está separado a propósito
 * —el motor se prueba con datos sintéticos y no toca ni la base ni la red—.
 *
 * Dos reglas del spec que se ven aquí:
 *
 * 1. **Sin historial no se llama a ningún proveedor salvo `getTrending` y
 *    `getFeed`.** Son las dos listas que una fuente publica para quien no ha
 *    buscado nada; ni detalle, ni búsqueda, ni episodios. Lo demás se pide sólo
 *    cuando hay algo que recomendar, porque gastar el ancho de banda de un tercero
 *    para nada no es gratis para nadie.
 * 2. **Un candidato sin tags no entra en el ranking de afinidad.** Puede entrar
 *    por popularidad, y eso es lo que hace que un título recién cacheado, sin
 *    géneros todavía, no desaparezca de la lista.
 */

import type { CatalogStore } from '@nn-anime/catalog-store'
import type { Candidate, ProviderRef } from '@nn-anime/core'
import { normalizeQuery } from '@nn-anime/core'
import type { AffinityEvent, CoVisit, SearchSignalRecord, WatchState } from '@nn-anime/recsys'

/** Cuántos títulos se miran para construir el corpus. */
export const CORPUS_LIMIT = 500

/** Cuántos registros de historial se usan. */
export const HISTORY_LIMIT = 500

/** Cuántos títulos encontrados por una búsqueda entran como candidatos. */
export const RECENT_LIMIT = 100

export interface Signals {
  readonly events: readonly AffinityEvent[]
  readonly coVisits: readonly CoVisit[]
  readonly searches: readonly SearchSignalRecord[]
  readonly watchState: readonly WatchState[]
  readonly lastSeen?: string | undefined
  readonly candidates: readonly Candidate[]
}

export function refKey(ref: ProviderRef): string {
  return `${ref.providerId}#${ref.value}`
}

/**
 * El historial, convertido en señales.
 *
 * Los tags y estudios de cada visionado salen del corpus ya cacheado: un título
 * que no está en la base no puede aportar su vector, y contarlo con un vector
 * vacío sería contarlo como «no me gustó nada», que es distinto de «no lo sé».
 */
export function eventsFromWatch(
  watch: readonly {
    readonly anime: { readonly ref: ProviderRef }
    readonly positionS: number
    readonly durationS: number
    readonly startedAt: Date
    readonly finished: boolean
  }[],
  corpus: ReadonlyMap<string, Candidate>,
): readonly AffinityEvent[] {
  const eventos: AffinityEvent[] = []

  for (const registro of watch) {
    const candidato = corpus.get(refKey(registro.anime.ref))
    if (candidato === undefined) continue

    const ratio =
      registro.durationS > 0
        ? Math.min(registro.positionS / registro.durationS, 1)
        : registro.finished
          ? 1
          : 0

    eventos.push({
      tags: candidato.tags,
      studios: candidato.studios,
      ...(candidato.year === undefined ? {} : { year: candidato.year }),
      at: registro.startedAt,
      completion: ratio,
    })
  }

  return eventos
}

/** Los estados de visionado, para el filtro de exclusión. */
export function watchStateFrom(
  watch: readonly {
    readonly anime: { readonly ref: ProviderRef }
    readonly positionS: number
    readonly durationS: number
    readonly startedAt: Date
    readonly finished: boolean
  }[],
): readonly WatchState[] {
  return watch.map((registro) => ({
    ref: refKey(registro.anime.ref),
    ratio:
      registro.durationS > 0
        ? Math.min(registro.positionS / registro.durationS, 1)
        : registro.finished
          ? 1
          : 0,
    at: registro.startedAt,
  }))
}

/** Las búsquedas recientes, como señal. */
export function searchesFrom(
  historial: readonly {
    readonly query: string
    readonly searchedAt: Date
    readonly hits: number
  }[],
): readonly SearchSignalRecord[] {
  return historial.map((registro) => ({
    query: normalizeQuery(registro.query),
    at: registro.searchedAt,
    hits: registro.hits,
  }))
}

export interface GatherOptions {
  readonly corpusLimit?: number
  readonly historyLimit?: number
}

/**
 * Junta las señales locales. **No llama a ningún proveedor.**
 *
 * Los candidatos son los títulos cacheados, los favoritos y **lo que apareció en
 * una búsqueda**, aunque nadie abriera su ficha. Eso último es lo que hace que
 * quien busca y no entra en nada tenga igualmente destacado y top 5: antes, la
 * tabla `anime` sólo se escribía al pedir el detalle, así que una búsqueda no
 * dejaba candidatos y la home se quedaba vacía.
 *
 * El proveedor entra después y sólo para `getTrending` y `getFeed`; quien decide
 * es la ruta.
 */
export async function gatherSignals(
  store: CatalogStore,
  options: GatherOptions = {},
): Promise<Signals> {
  const [candidatos, watch, historial, favoritos, recientes] = await Promise.all([
    store.listCandidates(options.corpusLimit ?? CORPUS_LIMIT),
    store.listRecentlyWatched(options.historyLimit ?? HISTORY_LIMIT),
    store.listRecentSearches(50),
    store.listFavorites(),
    store.listRecentSummaries(RECENT_LIMIT),
  ])

  const corpus = new Map<string, Candidate>(
    candidatos.map((fila) => [
      refKey(fila.ref),
      {
        ref: fila.ref,
        title: fila.title,
        tags: [...fila.tags],
        studios: [...fila.studios],
        ...(fila.year === undefined ? {} : { year: fila.year }),
        ...(fila.coverUrl === undefined ? {} : { coverUrl: fila.coverUrl }),
      },
    ]),
  )

  // Los favoritos son candidatos aunque no tengan tags: entran por popularidad.
  for (const favorito of favoritos) {
    const clave = refKey(favorito.ref)
    if (!corpus.has(clave)) {
      corpus.set(clave, {
        ref: favorito.ref,
        title: favorito.title,
        tags: [],
        studios: [],
        ...(favorito.year === undefined ? {} : { year: favorito.year }),
        ...(favorito.coverUrl === undefined ? {} : { coverUrl: favorito.coverUrl }),
      })
    }
  }

  // Y lo encontrado por una búsqueda. Si el título ya está en el corpus —porque
  // alguien abrió su ficha— no se toca: ese ya tiene sus tags, y son los que
  // puntúan. Lo que entra por aquí no tiene vector y sólo puede entrar por
  // popularidad, que es justo lo que se quiere de un resultado que nadie abrió.
  for (const reciente of recientes) {
    const clave = refKey(reciente.ref)
    if (corpus.has(clave)) continue

    corpus.set(clave, {
      ref: reciente.ref,
      title: reciente.title,
      tags: [],
      studios: [],
      ...(reciente.year === undefined ? {} : { year: reciente.year }),
      ...(reciente.coverUrl === undefined ? {} : { coverUrl: reciente.coverUrl }),
    })
  }

  const eventos = eventsFromWatch(watch, corpus)
  const ultimo = watch[0]

  return {
    events: eventos,
    coVisits: [],
    searches: searchesFrom(historial),
    watchState: watchStateFrom(watch),
    ...(ultimo === undefined ? {} : { lastSeen: refKey(ultimo.anime.ref) }),
    candidates: [...corpus.values()],
  }
}
