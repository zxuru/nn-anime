/**
 * Los datos de las filas de la home.
 *
 * Cinco lecturas en paralelo: continuar viendo, favoritos, tendencias, novedades
 * del feed y lo último que la aplicación conoce. En serie tardarían la suma de las
 * cinco latencias sin ninguna razón, porque ninguna necesita a las otras.
 *
 * Si una falla, **las demás se pintan igual**: la home no puede quedarse en blanco
 * porque un proveedor no conteste a tendencias o porque su feed esté roto. Sólo se
 * declara el error cuando fallan **todas**, que es cuando de verdad no hay nada que
 * enseñar.
 */

import type {
  ContinueWatchingResponse,
  FavoritesResponse,
  FeedResponse,
  RecentResponse,
  TrendingResponse,
} from '@nn-anime/core/api'
import {
  continueWatchingResponseSchema,
  favoritesResponseSchema,
  feedResponseSchema,
  recentResponseSchema,
  trendingResponseSchema,
} from '@nn-anime/core/api'
import { useEffect, useState } from 'react'
import { ApiError, apiGet } from '../../api/client'

export interface HomeRows {
  readonly loading: boolean
  readonly error: string | undefined
  readonly continueWatching: ContinueWatchingResponse['items']
  readonly favorites: FavoritesResponse['favorites']
  readonly trending: TrendingResponse['items']
  /** Lo que publica la fuente, sin que nadie haya buscado. */
  readonly feed: FeedResponse['items']
  /** Lo último que la aplicación ya conoce, sin red. */
  readonly recent: RecentResponse['items']
}

const VACIO: HomeRows = {
  loading: true,
  error: undefined,
  continueWatching: [],
  favorites: [],
  trending: [],
  feed: [],
  recent: [],
}

/** Lo que devolvió cada lectura, tal cual sale de `Promise.allSettled`. */
export interface RowResults {
  readonly continueWatching: PromiseSettledResult<ContinueWatchingResponse>
  readonly favorites: PromiseSettledResult<FavoritesResponse>
  readonly trending: PromiseSettledResult<TrendingResponse>
  readonly feed: PromiseSettledResult<FeedResponse>
  readonly recent: PromiseSettledResult<RecentResponse>
}

/**
 * Junta los resultados en las filas de la home.
 *
 * Es una función pura y no el cuerpo del `then` porque aquí está la decisión que
 * importa y no se puede probar dentro de un hook: **una lectura que falla deja su
 * fila vacía, y las demás se pintan igual**. El error sólo se declara cuando
 * fallan todas, que es cuando de verdad no hay nada que enseñar. Antes de esto,
 * la condición era «fallan las tres», escrita a mano, y añadir dos lecturas
 * habría dejado el número desactualizado sin que nada avisara.
 */
/**
 * Si lo que falló fue la sesión.
 *
 * Un 401 no es «no hay nada que enseñar»: es que este navegador no tiene la
 * cookie de sesión, y entonces **todo** falla a la vez. El mensaje genérico
 * mandaba a mirar el servidor —«es el mismo servidor»— cuando lo que faltaba era
 * entrar por la dirección de arranque. La cookie es de cada navegador: abrir la
 * misma dirección en otro no hereda la sesión del primero.
 */
function sesionPerdida(fallos: readonly PromiseRejectedResult[]): boolean {
  return fallos.some((fallo) => fallo.reason instanceof ApiError && fallo.reason.isSessionLost)
}

export function combineRows(resultados: RowResults): HomeRows {
  const lecturas = [
    resultados.continueWatching,
    resultados.favorites,
    resultados.trending,
    resultados.feed,
    resultados.recent,
  ]
  const fallos = lecturas.filter((lectura) => lectura.status === 'rejected')

  return {
    loading: false,
    error:
      fallos.length === lecturas.length
        ? sesionPerdida(fallos)
          ? 'la sesión de este navegador no vale: entra por la dirección de arranque que imprime el CLI'
          : 'no se pudo cargar nada de la página de inicio'
        : undefined,
    continueWatching:
      resultados.continueWatching.status === 'fulfilled'
        ? resultados.continueWatching.value.items
        : [],
    favorites:
      resultados.favorites.status === 'fulfilled' ? resultados.favorites.value.favorites : [],
    trending: resultados.trending.status === 'fulfilled' ? resultados.trending.value.items : [],
    feed: resultados.feed.status === 'fulfilled' ? resultados.feed.value.items : [],
    recent: resultados.recent.status === 'fulfilled' ? resultados.recent.value.items : [],
  }
}

export function useHomeRows(): HomeRows {
  const [filas, setFilas] = useState<HomeRows>(VACIO)

  useEffect(() => {
    let vivo = true
    const controller = new AbortController()
    const opciones = { signal: controller.signal }

    void Promise.allSettled([
      apiGet('/api/watch/recent', continueWatchingResponseSchema, opciones),
      apiGet('/api/favorites', favoritesResponseSchema, opciones),
      apiGet('/api/trending', trendingResponseSchema, opciones),
      apiGet('/api/feed', feedResponseSchema, opciones),
      apiGet('/api/catalog/recent', recentResponseSchema, opciones),
    ]).then(([continuar, favoritos, tendencias, novedades, recientes]) => {
      if (!vivo) return

      setFilas(
        combineRows({
          continueWatching: continuar,
          favorites: favoritos,
          trending: tendencias,
          feed: novedades,
          recent: recientes,
        }),
      )
    })

    return () => {
      vivo = false
      controller.abort()
    }
  }, [])

  return filas
}
