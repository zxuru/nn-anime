/**
 * Los datos de las filas de la home.
 *
 * Tres lecturas en paralelo: continuar viendo, favoritos y tendencias. En serie
 * tardarían la suma de las tres latencias sin ninguna razón, porque ninguna
 * necesita a las otras.
 *
 * Si una falla, **las otras dos se pintan igual**: la home no puede quedarse en
 * blanco porque un proveedor no conteste a tendencias.
 */

import type {
  ContinueWatchingResponse,
  FavoritesResponse,
  TrendingResponse,
} from '@nn-anime/core/api'
import {
  continueWatchingResponseSchema,
  favoritesResponseSchema,
  trendingResponseSchema,
} from '@nn-anime/core/api'
import { useEffect, useState } from 'react'
import { apiGet } from '../../api/client'

export interface HomeRows {
  readonly loading: boolean
  readonly error: string | undefined
  readonly continueWatching: ContinueWatchingResponse['items']
  readonly favorites: FavoritesResponse['favorites']
  readonly trending: TrendingResponse['items']
}

const VACIO: HomeRows = {
  loading: true,
  error: undefined,
  continueWatching: [],
  favorites: [],
  trending: [],
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
    ]).then(([continuar, favoritos, tendencias]) => {
      if (!vivo) return

      const fallos = [continuar, favoritos, tendencias].filter(
        (resultado) => resultado.status === 'rejected',
      )

      setFilas({
        loading: false,
        error: fallos.length === 3 ? 'no se pudo cargar nada de la página de inicio' : undefined,
        continueWatching: continuar.status === 'fulfilled' ? continuar.value.items : [],
        favorites: favoritos.status === 'fulfilled' ? favoritos.value.favorites : [],
        trending: tendencias.status === 'fulfilled' ? tendencias.value.items : [],
      })
    })

    return () => {
      vivo = false
      controller.abort()
    }
  }, [])

  return filas
}
