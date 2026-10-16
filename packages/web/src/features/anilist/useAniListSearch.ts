/**
 * La búsqueda de una casilla contra AniList: estado, retardo y presupuesto.
 *
 * La lógica vive en funciones puras y el gancho de React que hay al final es fino a
 * propósito: lo que tiene reglas —cuándo se puede preguntar, qué se hace con una respuesta,
 * qué pasa si falla— se prueba sin un DOM, y lo que sólo ocurre en el navegador se queda
 * en tres líneas que se leen de un vistazo.
 *
 * **Se pide al servidor, nunca a AniList.** La frontera de la aplicación tiene la lista
 * blanca de hosts, el presupuesto de la API y la caché; el navegador no conoce ningún
 * origen remoto y la CSP no cambia. Aquí sólo se llama a `/api/anilist/search`.
 *
 * Cuatro reglas que se ven en el código:
 *
 * 1. **El retardo es de 300 ms** y una consulta nueva cancela la anterior: escribir cinco
 *    letras rápido es una petición, no cinco, y la que se queda es la última.
 * 2. **Entre dos peticiones hay al menos dos segundos.** No es una optimización: la API
 *    está hoy degradada a treinta peticiones por minuto y tiene un limitador de ráfagas,
 *    así que lo que sobra no se pide, se espera.
 * 3. **Un 429 abre una puerta**: hasta que pase lo que diga `Retry-After` no sale nada, y
 *    se dice cuánto falta en vez de reintentar a ciegas.
 * 4. **«No hay nada» se dice sólo con la respuesta delante.** Mientras se espera, el
 *    estado vacío no se pinta: afirmarlo antes es culpar a la consulta de lo que todavía
 *    no se sabe.
 */

import {
  type AniListSearchItem,
  type AniListSearchResponse,
  anilistSearchResponseSchema,
} from '@nn-anime/core/api'
import { useCallback, useEffect, useRef, useState } from 'react'

/** Lo que se espera desde la última tecla. */
export const DEBOUNCE_MS = 300
/** Lo mínimo entre dos peticiones que salen de aquí. */
export const MIN_INTERVAL_MS = 2000
/** Lo que se espera por defecto cuando un 429 no dice `Retry-After`. */
export const THROTTLE_DEFAULT_S = 60
/** Lo que se espera una respuesta antes de darla por perdida. */
export const REQUEST_TIMEOUT_MS = 10_000

/** Cómo se pidió una página, que es lo que decide si se sustituye o se añade. */
export type ModoDePagina = 'first' | 'more'

/** Un fallo, en la forma que la interfaz sabe traducir. */
export type AniListSearchFailure =
  | { readonly kind: 'network' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'throttled'; readonly waitS: number }
  | { readonly kind: 'server'; readonly status: number }
  | { readonly kind: 'shape' }

export interface AniListSearchState {
  readonly items: readonly AniListSearchItem[]
  /** Los géneros que se escribieron y AniList no tiene. El servidor no los envió. */
  readonly unknownGenres: readonly string[]
  readonly page: number
  readonly hasNextPage: boolean
  /** Aproximado, tal y como lo publica la API. Sólo se enseña. */
  readonly total?: number
  readonly loading: 'none' | 'first' | 'more'
  readonly failure?: AniListSearchFailure
}

/**
 * El estado antes de que conteste nadie.
 *
 * `loading: 'first'` y no `'none'`: la pantalla busca **siempre** al montarse —con la
 * casilla vacía, lo más popular—, así que ése es su estado de verdad y no un hueco. Con
 * `'none'` el primer render diría «no hay nada» antes de haber preguntado, que es el
 * mismo error que ya costó una tarde en la búsqueda de proveedores.
 */
export const ESTADO_INICIAL: AniListSearchState = {
  items: [],
  unknownGenres: [],
  page: 1,
  hasNextPage: false,
  loading: 'first',
}

/** La ruta de una página. El texto va escapado: es una consulta, no una ruta. */
export function searchPath(texto: string, page: number): string {
  const partes = [`q=${encodeURIComponent(texto)}`]
  if (page > 1) partes.push(`page=${page}`)

  return `/api/anilist/search?${partes.join('&')}`
}

/** Se empieza a pedir: se dice qué se está cargando y se olvida el fallo anterior. */
export function empezar(state: AniListSearchState, modo: ModoDePagina): AniListSearchState {
  const { failure: _fallo, ...resto } = state

  return { ...resto, loading: modo }
}

/**
 * Llega una página.
 *
 * `first` **sustituye** —es una búsqueda nueva— y `more` **añade**: el «más» es la misma
 * búsqueda con una página más, y perder lo que ya estaba sería empezar de cero.
 */
export function recibir(
  state: AniListSearchState,
  cuerpo: AniListSearchResponse,
  modo: ModoDePagina,
): AniListSearchState {
  const items = modo === 'first' ? cuerpo.items : [...state.items, ...cuerpo.items]

  return {
    items,
    unknownGenres: cuerpo.unknownGenres,
    page: cuerpo.page,
    hasNextPage: cuerpo.hasNextPage,
    ...(cuerpo.total === undefined ? {} : { total: cuerpo.total }),
    loading: 'none',
  }
}

/** Un fallo se cuenta y se deja de cargar. La lista que había se queda donde estaba. */
export function fallar(
  state: AniListSearchState,
  failure: AniListSearchFailure,
): AniListSearchState {
  return { ...state, loading: 'none', failure }
}

/** Lo que dice un `Retry-After`, en segundos, o nada si no lo dice o no se entiende. */
export function retryAfterSeconds(raw: string | null): number | undefined {
  if (raw === null) return undefined

  const segundos = Number(raw.trim())
  if (!Number.isFinite(segundos) || segundos <= 0) return undefined

  return Math.ceil(segundos)
}

/**
 * Si ya se puede volver a preguntar.
 *
 * La puerta la abre un 429 —con lo que diga `Retry-After`— o el presupuesto de dos
 * segundos entre peticiones. Se mide con el reloj que se le pase, que en las pruebas es
 * falso y en el navegador es el de verdad.
 */
export function puedeSalir(ahora: number, siguientePermitido: number): boolean {
  return ahora >= siguientePermitido
}

/** Cuánto falta para poder salir, en milisegundos. Nunca negativo. */
export function esperaHasta(ahora: number, siguientePermitido: number): number {
  return Math.max(0, siguientePermitido - ahora)
}

/**
 * Cuándo se puede volver a salir, después de un 429.
 *
 * Es la puerta: lo que diga `Retry-After` y no un reintento inmediato. Insistir antes de
 * que la API lo permita es lo que convierte una espera en un bloqueo.
 */
export function puertaTras429(ahora: number, waitS: number): number {
  return ahora + waitS * 1000
}

/** Cuándo se puede volver a salir, por el presupuesto entre peticiones. */
export function proximaSalida(ahora: number): number {
  return ahora + MIN_INTERVAL_MS
}

/**
 * Si se puede pedir la página siguiente.
 *
 * Dos condiciones y las dos importan: sin página siguiente no hay nada que pedir, y con una
 * petición en vuelo pedir otra duplicaría la lista —el «más» deja de ser inocente en cuanto
 * se puede pulsar dos veces seguidas—.
 */
export function puedePedirMas(state: AniListSearchState): boolean {
  return state.hasNextPage && state.loading === 'none'
}

/** El mínimo que se usa de `fetch`: una URL, unas opciones y una respuesta. */
export type AniListFetcher = (url: string, init: RequestInit) => Promise<Response>

export interface UseAniListSearchOptions {
  /** Se inyecta en las pruebas; en producción, el `fetch` del navegador. */
  readonly fetcher?: AniListFetcher
  /** Reloj inyectable: la puerta y el presupuesto se miden sin esperar de verdad. */
  readonly now?: () => number
  /** La espera, inyectable por el mismo motivo. */
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>
}

export interface UseAniListSearch {
  readonly state: AniListSearchState
  /** Pide la página siguiente de lo que ya se está buscando. */
  readonly mas: () => void
  /** Vuelve a intentar lo último que se pidió. */
  readonly reintentar: () => void
}

/** La espera de verdad, que se corta si la consulta se cancela. */
export function esperarDeVerdad(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolver, rechazar) => {
    if (signal.aborted) {
      rechazar(new Error('cancelado'))
      return
    }

    const temporizador = setTimeout(() => {
      signal.removeEventListener('abort', alCancelar)
      resolver()
    }, ms)

    function alCancelar(): void {
      clearTimeout(temporizador)
      rechazar(new Error('cancelado'))
    }

    signal.addEventListener('abort', alCancelar, { once: true })
  })
}

/**
 * La búsqueda, atada a un texto ya retardado.
 *
 * El texto que llega es el que el usuario dejó de escribir: el retardo vive en la
 * pantalla, que es quien tiene la casilla. Cada texto nuevo cancela lo que estuviera en
 * vuelo y empieza por la primera página.
 */
export function useAniListSearch(
  texto: string,
  options: UseAniListSearchOptions = {},
): UseAniListSearch {
  const fetcher = options.fetcher ?? fetch
  const ahora = options.now ?? Date.now
  const esperar = options.wait ?? esperarDeVerdad

  const [state, setState] = useState<AniListSearchState>(ESTADO_INICIAL)
  const enVuelo = useRef<AbortController | undefined>(undefined)
  const siguientePermitido = useRef(0)
  const ultimo = useRef<
    { readonly texto: string; readonly page: number; readonly modo: ModoDePagina } | undefined
  >(undefined)

  const pedir = useCallback(
    async (q: string, page: number, modo: ModoDePagina): Promise<void> => {
      ultimo.current = { texto: q, page, modo }
      enVuelo.current?.abort()

      const control = new AbortController()
      enVuelo.current = control
      setState((previo) => empezar(previo, modo))

      const plazo = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      const señal = AbortSignal.any([control.signal, plazo])

      try {
        // El presupuesto: lo que falte para los dos segundos se espera, no se pide.
        const espera = esperaHasta(ahora(), siguientePermitido.current)
        if (espera > 0) await esperar(espera, control.signal)

        const respuesta = await fetcher(searchPath(q, page), {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
          signal: señal,
        })

        if (respuesta.status === 429) {
          const waitS =
            retryAfterSeconds(respuesta.headers.get('retry-after')) ?? THROTTLE_DEFAULT_S
          siguientePermitido.current = puertaTras429(ahora(), waitS)
          setState((previo) => fallar(previo, { kind: 'throttled', waitS }))
          return
        }

        if (!respuesta.ok) {
          setState((previo) => fallar(previo, { kind: 'server', status: respuesta.status }))
          return
        }

        const crudo: unknown = await respuesta.json()
        const cuerpo = anilistSearchResponseSchema.safeParse(crudo)
        if (!cuerpo.success) {
          setState((previo) => fallar(previo, { kind: 'shape' }))
          return
        }

        siguientePermitido.current = proximaSalida(ahora())
        setState((previo) => recibir(previo, cuerpo.data, modo))
      } catch (cause) {
        // Cancelar no es fallar: si el usuario escribió otra cosa, aquí no hay nada que
        // contar, y decirlo sería inventarse un error suyo.
        if (control.signal.aborted) return

        const plazoAgotado = cause instanceof DOMException && cause.name === 'TimeoutError'
        setState((previo) => fallar(previo, { kind: plazoAgotado ? 'timeout' : 'network' }))
      }
    },
    [fetcher, ahora, esperar],
  )

  useEffect(() => {
    void pedir(texto, 1, 'first')

    return () => {
      enVuelo.current?.abort()
    }
  }, [texto, pedir])

  const mas = useCallback(() => {
    if (!puedePedirMas(state)) return

    void pedir(texto, state.page + 1, 'more')
  }, [pedir, state, texto])

  const reintentar = useCallback(() => {
    const intento = ultimo.current ?? { texto, page: 1, modo: 'first' as const }

    void pedir(intento.texto, intento.page, intento.modo)
  }, [pedir, texto])

  return { state, mas, reintentar }
}
