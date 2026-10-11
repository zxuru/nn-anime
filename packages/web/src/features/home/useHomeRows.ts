/**
 * Los datos de las filas de la home.
 *
 * Cinco lecturas en paralelo: continuar viendo, favoritos, tendencias, novedades
 * del feed y lo último que la aplicación ya conoce. En serie tardarían la suma de
 * las cinco latencias sin ninguna razón, porque ninguna necesita a las otras.
 *
 * Si una falla, **las demás se pintan igual**: la home no puede quedarse en blanco
 * porque un proveedor no conteste a tendencias o porque su feed esté roto. Sólo se
 * declara el error cuando fallan **todas**, que es cuando de verdad no hay nada que
 * enseñar.
 *
 * Desde T55 la home **relee**: al volver a la pestaña y cada dos minutos mientras
 * está visible. Tres reglas, y las tres importan:
 *
 * 1. **La relectura no sustituye, fusiona.** Una lectura que falla conserva lo que
 *    ya estaba pintado: cambiar un dato viejo por ninguno es empeorar.
 * 2. **`loading` es sólo la primera vez.** Una relectura marca `refrescando` y deja
 *    el contenido en su sitio; volver a poner la página en esqueleto cada dos
 *    minutos sería peor que no refrescar.
 * 3. **La cadencia se mide desde el último intento**, no desde el último acierto.
 *    Si se midiera desde el acierto, un servidor que falla se llevaría una petición
 *    cada vez que la pestaña vuelve a primer plano.
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
import { useEffect, useRef, useState } from 'react'
import { ApiError, apiGet } from '../../api/client'
import { describirFallo, type Fallo } from '../../api/fallo'

/** Cada cuánto se relee la home con la pestaña visible. */
export const REFRESCO_MS = 120_000

export interface HomeRows {
  readonly loading: boolean
  readonly error: Fallo | undefined
  /** Hay una relectura en curso: lo que se ve es de la lectura anterior. */
  readonly refrescando: boolean
  /** Cuándo llegó lo último que se ve. `undefined` si no llegó nada todavía. */
  readonly refreshedAt: Date | undefined
  /** Relecturas completadas después de la primera. */
  readonly relecturas: number
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
  refrescando: false,
  refreshedAt: undefined,
  relecturas: 0,
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
 * Si toca releer.
 *
 * Es una función pura y no dos líneas dentro del efecto por el mismo motivo que
 * `combineRows`: aquí está la decisión que importa —la visibilidad y la cadencia—
 * y un efecto no se puede probar sin un DOM. Con la decisión fuera, se prueba con
 * tres números y sin temporizadores.
 */
export function debeReleer(
  estado: DocumentVisibilityState,
  ultimoIntento: number | undefined,
  ahora: number,
): boolean {
  if (estado !== 'visible') return false
  if (ultimoIntento === undefined) return true

  return ahora - ultimoIntento >= REFRESCO_MS
}

/**
 * El fallo de la home, cuando hay que declararlo.
 *
 * Dos casos, y el orden importa:
 *
 * 1. **La sesión perdida se avisa siempre**, aunque las filas estén pintadas. Un
 *    401 no es «no hay nada que enseñar»: es que este navegador no tiene la
 *    cookie de sesión, y entonces **todo** falla a la vez. El mensaje genérico
 *    mandaba a mirar el servidor —«es el mismo servidor»— cuando lo que faltaba
 *    era entrar por la dirección de arranque. La cookie es de cada navegador:
 *    abrir la misma dirección en otro no hereda la sesión del primero.
 * 2. **Lo demás sólo cuando no hay nada que enseñar**, y se cuenta el primero de
 *    los fallos. Si las cinco lecturas fallaron con un 502, lo que hay que decir
 *    es que el proveedor no responde; un «algo falló» genérico tiraría el único
 *    dato que se tiene sobre la causa.
 */
export function falloDeLecturas(
  lecturas: readonly PromiseSettledResult<unknown>[],
  algoQueEnsenar: boolean,
): Fallo | undefined {
  const fallos = lecturas.filter((lectura) => lectura.status === 'rejected')
  const sinSesion = fallos.find(
    (fallo) => fallo.reason instanceof ApiError && fallo.reason.isSessionLost,
  )

  if (sinSesion !== undefined) return describirFallo(sinSesion.reason)
  if (algoQueEnsenar || fallos.length < lecturas.length) return undefined

  const primero = fallos[0]

  return primero === undefined ? undefined : describirFallo(primero.reason)
}

/** El valor de una lectura: el nuevo si llegó, el anterior si falló. */
function valorDe<T, V>(
  resultado: PromiseSettledResult<T>,
  anterior: V,
  elegir: (value: T) => V,
): V {
  return resultado.status === 'fulfilled' ? elegir(resultado.value) : anterior
}

/**
 * Junta una lectura con lo que ya se veía.
 *
 * Es una función pura y no el cuerpo del `then` porque aquí están las dos
 * decisiones que importan y no se pueden probar dentro de un hook: **una lectura
 * que falla conserva su fila** y el error sólo se declara cuando no hay nada que
 * enseñar —ni de esta lectura ni de la anterior—. Antes de T55 la condición era
 * «fallan las cinco», escrita a mano, y la primera relectura fallida habría
 * borrado la home entera.
 *
 * La excepción es la sesión perdida: ahí sí se avisa aunque haya datos, porque no
 * es un dato viejo, es que este navegador no puede pedir nada. Quién decide las
 * dos cosas —y con qué clase de fallo se cuentan— es `falloDeLecturas`.
 */
export function mergeRows(
  previas: HomeRows,
  resultados: RowResults,
  ahora: Date = new Date(),
): HomeRows {
  const continueWatching = valorDe(
    resultados.continueWatching,
    previas.continueWatching,
    (value) => value.items,
  )
  const favorites = valorDe(resultados.favorites, previas.favorites, (value) => value.favorites)
  const trending = valorDe(resultados.trending, previas.trending, (value) => value.items)
  const feed = valorDe(resultados.feed, previas.feed, (value) => value.items)
  const recent = valorDe(resultados.recent, previas.recent, (value) => value.items)

  const lecturas = [
    resultados.continueWatching,
    resultados.favorites,
    resultados.trending,
    resultados.feed,
    resultados.recent,
  ]
  const algoQueEnsenar = [continueWatching, favorites, trending, feed, recent].some(
    (fila) => fila.length > 0,
  )

  // `loading` dice «es la primera lectura»: después de la primera ya no vuelve a
  // ser cierto, y es lo que distingue una relectura de un arranque.
  const primera = previas.loading
  const llegoAlgo = lecturas.some((lectura) => lectura.status === 'fulfilled')

  return {
    loading: false,
    error: falloDeLecturas(lecturas, algoQueEnsenar),
    refrescando: false,
    refreshedAt: llegoAlgo ? ahora : previas.refreshedAt,
    relecturas: primera ? 0 : previas.relecturas + 1,
    continueWatching,
    favorites,
    trending,
    feed,
    recent,
  }
}

/**
 * La primera lectura, junta.
 *
 * Es `mergeRows` sobre el estado vacío: no hay una segunda versión de la misma
 * decisión, que es lo que había antes y lo que se habría desincronizado al añadir
 * la relectura.
 */
export function combineRows(resultados: RowResults, ahora: Date = new Date()): HomeRows {
  return mergeRows(VACIO, resultados, ahora)
}

/** Las cinco lecturas, en paralelo y con la misma señal. */
async function leerLasCinco(signal: AbortSignal): Promise<RowResults> {
  const opciones = { signal }
  const [continueWatching, favorites, trending, feed, recent] = await Promise.allSettled([
    apiGet('/api/watch/recent', continueWatchingResponseSchema, opciones),
    apiGet('/api/favorites', favoritesResponseSchema, opciones),
    apiGet('/api/trending', trendingResponseSchema, opciones),
    apiGet('/api/feed', feedResponseSchema, opciones),
    apiGet('/api/catalog/recent', recentResponseSchema, opciones),
  ])

  return { continueWatching, favorites, trending, feed, recent }
}

export function useHomeRows(): HomeRows {
  const [filas, setFilas] = useState<HomeRows>(VACIO)
  // El reloj de los intentos vive en un `ref`: no se pinta, y meterlo en el
  // estado volvería a montar el efecto en cada relectura.
  const ultimoIntento = useRef<number | undefined>(undefined)

  useEffect(() => {
    let vivo = true
    let enVuelo = false
    const controller = new AbortController()

    const leer = async (): Promise<void> => {
      // Dos disparos a la vez —la pestaña y el temporizador— no son dos lecturas.
      if (enVuelo) return

      enVuelo = true
      ultimoIntento.current = Date.now()
      setFilas((previas) => ({ ...previas, refrescando: !previas.loading }))

      const resultados = await leerLasCinco(controller.signal)
      enVuelo = false
      if (!vivo) return

      setFilas((previas) => mergeRows(previas, resultados, new Date()))
    }

    const siToca = (): void => {
      if (debeReleer(document.visibilityState, ultimoIntento.current, Date.now())) void leer()
    }

    void leer()
    const temporizador = setInterval(siToca, REFRESCO_MS)
    document.addEventListener('visibilitychange', siToca)

    return () => {
      vivo = false
      controller.abort()
      clearInterval(temporizador)
      document.removeEventListener('visibilitychange', siToca)
    }
  }, [])

  return filas
}
