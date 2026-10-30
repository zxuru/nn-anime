/**
 * Estado de la búsqueda incremental.
 *
 * Aquí vive todo lo que se puede probar sin un DOM: la reducción de eventos a
 * estado, la agrupación de duplicados, el distribuidor que comparte una sola
 * petición entre dos montajes y la precarga acotada. El gancho de React que hay
 * al final es fino a propósito: lo que tiene reglas es esto.
 *
 * La regla que ordena el archivo: **un proveedor no puede retrasar a los demás**.
 * Por eso el estado guarda qué proveedores siguen pendientes y pinta un esqueleto
 * por cada uno, en vez de esperar a tenerlo todo.
 */

import {
  type DiscoverItem,
  type ProviderSummary,
  providersResponseSchema,
  type SearchEventPayload,
  settingsResponseSchema,
} from '@nn-anime/core/api'
import { groupByWork } from '@nn-anime/core/identity'
import { DEFAULT_MEDIA, type MediaFilter, mediaOf, puedeServir } from '@nn-anime/core/media'
import type { SearchResult } from '@nn-anime/core/models'
import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '../../api/client'
import { createDedupe } from '../../api/dedupe'
import { describirFallo, type Fallo } from '../../api/fallo'
import { readEventStream, searchRequestPath } from '../../api/stream-events'
import { prefetchDetail } from '../detail/prefetch'

export interface ProviderIssue {
  readonly providerId: string
  readonly message: string
}

export interface SearchState {
  /** Resultados en orden de llegada, sin agrupar: cada proveedor aporta los suyos. */
  readonly results: readonly SearchResult[]
  /**
   * Lo que AniList tiene de este término como estudio o como género.
   *
   * Va aparte de `results` porque no es lo mismo: son piezas de AniList —con su
   * portada y su ficha cuando la base la conoce— y no la respuesta de un proveedor.
   * Mezclarlas obligaría a la rejilla a saber de dos formas para pintar una lista
   * que se lee distinto: ésta dice «esto es lo que hay», no «esto es lo que tus
   * fuentes tienen».
   */
  readonly anilist: readonly DiscoverItem[]
  /** Proveedores de los que todavía no ha llegado nada. Uno, un esqueleto. */
  readonly pending: readonly string[]
  readonly errors: readonly ProviderIssue[]
  readonly done: boolean
  /** Fallo de transporte: ni siquiera llegó a haber stream. */
  readonly failed?: Fallo
}

export function initialState(active: readonly string[]): SearchState {
  return { results: [], anilist: [], pending: [...active], errors: [], done: false }
}

function sin(lista: readonly string[], valor: string): readonly string[] {
  return lista.filter((item) => item !== valor)
}

/** La clave de un resultado: su proveedor y su referencia. Es lo que lo identifica. */
function claveDeResultado(result: SearchResult): string {
  return `${result.ref.providerId}:${result.ref.value}`
}

export function reduce(state: SearchState, event: SearchEventPayload): SearchState {
  switch (event.type) {
    case 'results': {
      /**
       * Se descarta lo que ya está.
       *
       * El catálogo cacheado emite antes que los proveedores, así que la misma
       * referencia puede llegar dos veces: una del evento del catálogo y otra de
       * su proveedor. Sin esto, la rejilla pintaría dos tarjetas idénticas y el
       * recuento del anuncio contaría doble.
       */
      const vistos = new Set(state.results.map(claveDeResultado))
      const nuevos = event.results.filter((result) => {
        const clave = claveDeResultado(result)
        if (vistos.has(clave)) return false

        vistos.add(clave)
        return true
      })

      return {
        ...state,
        results: [...state.results, ...nuevos],
        pending: sin(state.pending, event.providerId),
      }
    }
    case 'anilist':
      /**
       * Se **sustituye** y no se acumula: la cruzada es una consulta por término, y
       * su respuesta es la lista entera de ese término. Acumular dejaría la lista
       * del término anterior debajo de la del actual.
       */
      return { ...state, anilist: event.items }
    case 'error':
      return {
        ...state,
        errors: [...state.errors, { providerId: event.providerId, message: event.message }],
        pending: sin(state.pending, event.providerId),
      }
    case 'done':
      return { ...state, pending: [], done: true }
  }
}

/**
 * Título normalizado: sin espacios de sobra, en minúsculas y en NFC.
 *
 * Es la clave de agrupación. Sin NFC, la misma palabra escrita en dos teclados
 * distintos no agruparía, y el usuario vería dos tarjetas del mismo título sin
 * ninguna pista de que son el mismo.
 */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().normalize('NFC').replace(/\s+/g, ' ')
}

export interface ResultGroup {
  readonly key: string
  /**
   * Todos los resultados del grupo, con el que da nombre a la tarjeta delante.
   * **No se fusionan**: cada ref es la suya.
   */
  readonly results: readonly SearchResult[]
}

/**
 * El nombre que la tarjeta muestra: el más largo de la obra.
 *
 * Cuando dos fuentes nombran la misma obra, la corta suele ser el alias con el
 * que se la conoce y la larga el título original completo —«Danmachi» contra
 * «Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka»—, y el que se pinta
 * es el segundo. Es una heurística y se llama así: una fuente con un subtítulo
 * de más le gana el nombre a la que acierta. El orden es **estable**, así que a
 * igualdad de largo manda el que llegó primero.
 */
function porNombre(a: SearchResult, b: SearchResult): number {
  return b.title.length - a.title.length
}

/**
 * El orden dentro de una obra: primero el proveedor preferido, y a igualdad el
 * nombre más largo de siempre.
 *
 * La preferencia es del usuario y está en los ajustes (`providerPriority`, del
 * primero al último). Un proveedor que la lista no nombra —uno recién instalado,
 * o uno que el usuario nunca movió— vale lo mismo que cualquier otro no nombrado
 * y cae en `porNombre`, que es la regla de antes: la prioridad **añade** un
 * criterio, no sustituye al que ya funcionaba cuando nadie ha reordenado nada.
 */
function porPreferencia(priority: readonly string[]): (a: SearchResult, b: SearchResult) => number {
  const puestos = new Map(priority.map((id, indice) => [id, indice]))
  const puesto = (providerId: string): number => puestos.get(providerId) ?? Number.MAX_SAFE_INTEGER

  return (a, b) => puesto(a.ref.providerId) - puesto(b.ref.providerId) || porNombre(a, b)
}

/**
 * Una tarjeta por obra.
 *
 * Pintar dos tarjetas de lo mismo es el «contenido repetido» que se reportó. La
 * identidad la resuelve `groupByWork` en `core` —título, alternativa y
 * referencia, para que «Danmachi» y «Dungeon ni Deai wo Motomeru no wa
 * Machigatteiru Darou ka» sean la misma obra— y aquí sólo queda lo que es
 * presentación: qué nombre da la tarjeta y en qué orden se pintan sus fuentes.
 *
 * **No se fusionan las referencias**: quien elige la fuente es el usuario, con
 * un enlace por proveedor, porque abrir la tarjeta lleva a una ficha concreta y
 * no a una media.
 *
 * `priority` es el orden de preferencia guardado en los ajustes y decide **cuál**
 * de las fuentes da el nombre y el enlace de la tarjeta. Sin él —vacío, o con un
 * id que ya no existe— todo queda como estaba.
 */
export function groupResults(
  results: readonly SearchResult[],
  priority: readonly string[] = [],
): readonly ResultGroup[] {
  const grupos = groupByWork(results, (uno, otro) => uno.year === otro.year)
  const ordenar = porPreferencia(priority)

  return grupos.map((grupo) => {
    const ordenados = [...grupo].sort(ordenar)
    const primero = ordenados[0]

    return {
      key: `${normalizeTitle(primero?.title ?? '')}|${primero?.year ?? ''}`,
      results: ordenados,
    }
  })
}

/**
 * Los demás proveedores que ofrecen la misma obra, sin el de la tarjeta.
 *
 * Es el «selector de proveedor»: cada uno es un enlace a la ficha de esa fuente,
 * así que la obra sale una vez y las fuentes siguen siendo elegibles.
 */
export function alternativas(grupo: ResultGroup, providerId: string): readonly SearchResult[] {
  return grupo.results.filter((result) => result.ref.providerId !== providerId)
}

/** Los ids de los proveedores activos: los que la búsqueda va a consultar. */
export function activeProviderIds(summaries: readonly ProviderSummary[]): readonly string[] {
  return summaries.filter((summary) => summary.status === 'active').map((summary) => summary.id)
}

/**
 * A qué proveedores se le pregunta, con el filtro de la dirección y el tipo.
 *
 * Es la intersección de tres cosas: los activos, el filtro que pone el CLI con
 * `--provider` y el tipo. Se calcula aquí además de en el servidor porque es lo que
 * decide **cuántos esqueletos** salen: uno por proveedor del que se espera
 * respuesta, y esperar a uno que no se ha consultado deja la rejilla con un hueco
 * que no se llena. Una fuente que sirve las dos cosas entra en las dos mitades: sus
 * resultados se reparten después, por el `kind` de cada uno.
 */
export function proveedoresSeleccionados(
  summaries: readonly ProviderSummary[],
  filter: readonly string[],
  media: MediaFilter,
): readonly string[] {
  const medias = new Map(summaries.map((uno) => [uno.id, mediaOf(uno.capabilities)]))

  return activeProviderIds(summaries)
    .filter((id) => filter.length === 0 || filter.includes(id))
    .filter((id) => puedeServir(media, medias.get(id) ?? DEFAULT_MEDIA))
}

export interface SearchHub {
  /** Se suscribe a una búsqueda. Dos suscripciones a la misma ruta, una petición. */
  subscribe(path: string, active: readonly string[], listener: () => void): () => void
  read(path: string): SearchState
}

export interface SearchHubDeps {
  /**
   * Abre el stream. Puede devolver la fuente directamente o una promesa que la
   * resuelva: abrir una conexión es asíncrono, y fingir que no lo es obligaría a
   * cada implementación a envolverlo.
   */
  readonly open: (
    path: string,
    signal: AbortSignal,
  ) => AsyncIterable<SearchEventPayload> | Promise<AsyncIterable<SearchEventPayload>>
}

interface Entry {
  state: SearchState
  readonly listeners: Set<() => void>
  readonly controller: AbortController
}

/**
 * Distribuidor de búsquedas en vuelo, por ruta.
 *
 * Es lo que hace que dos montajes de la misma consulta hagan **una** petición y
 * que los dos vean los mismos eventos: se comparte el recorrido, no la respuesta
 * —un cuerpo de SSE sólo se puede leer una vez—.
 *
 * La entrada se borra al terminar si nadie escucha, así que un remontaje
 * posterior vuelve a pedir en lugar de recibir un estado muerto.
 *
 * Se borra **la suya y sólo si sigue siendo la suya**. Lo segundo no es
 * ceremonia: la misma ruta puede tener dos entradas seguidas —la búsqueda monta
 * con la lista de proveedores en camino y se vuelve a suscribir en cuanto
 * llega—, y la vieja muere un giro después. Borrar por ruta se llevaba la nueva,
 * y a partir de ahí `read` contestaba el estado de relleno para siempre: la
 * pantalla se quedaba en «Buscando…», sin tarjetas y sin esqueletos.
 */
export function createSearchHub(deps: SearchHubDeps): SearchHub {
  const entries = new Map<string, Entry>()

  const notify = (entry: Entry): void => {
    for (const listener of [...entry.listeners]) listener()
  }

  /** Saca del mapa la entrada que se le pasa, si es la que la ruta tiene ahora. */
  const retirar = (path: string, entry: Entry): void => {
    if (entries.get(path) === entry) entries.delete(path)
  }

  const start = (path: string, active: readonly string[]): Entry => {
    const entry: Entry = {
      state: initialState(active),
      listeners: new Set(),
      controller: new AbortController(),
    }
    entries.set(path, entry)

    // El trabajo arranca en el siguiente ciclo, no ahora: si abrir falla al
    // instante, la limpieza del `finally` borraría la entrada antes de que quien
    // llama haya podido suscribirse, y acabaría leyendo un estado que ya no
    // existe.
    queueMicrotask(() => {
      // Si el último suscriptor se fue antes de que esto arranque, no hay nada
      // que abrir: una conexión que nadie va a leer es trabajo contra un tercero.
      if (entry.controller.signal.aborted) return

      void (async () => {
        try {
          const source = await deps.open(path, entry.controller.signal)
          for await (const event of source) {
            entry.state = reduce(entry.state, event)
            notify(entry)
          }
        } catch (cause) {
          // Cancelar no es fallar: si el usuario cambió de consulta, aquí no hay
          // nada que contar.
          if (!entry.controller.signal.aborted) {
            entry.state = {
              ...entry.state,
              pending: [],
              done: true,
              failed: describirFallo(cause),
            }
            notify(entry)
          }
        } finally {
          if (entry.listeners.size === 0) retirar(path, entry)
        }
      })()
    })

    return entry
  }

  return {
    subscribe(path, active, listener) {
      const entry = entries.get(path) ?? start(path, active)
      entry.listeners.add(listener)

      return () => {
        entry.listeners.delete(listener)
        if (entry.listeners.size === 0) {
          entry.controller.abort()
          retirar(path, entry)
        }
      }
    },
    read(path) {
      return entries.get(path)?.state ?? initialState([])
    },
  }
}

async function openSearch(
  path: string,
  signal: AbortSignal,
): Promise<AsyncIterable<SearchEventPayload>> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { accept: 'text/event-stream' },
    signal,
  })

  if (!response.ok) throw new ApiError(response.status, `GET ${path} respondió ${response.status}`)

  return readEventStream(response)
}

const HUB = createSearchHub({ open: openSearch })

export interface SearchStreamResult {
  readonly state: SearchState
  /** Ids de los proveedores activos, para los esqueletos. */
  readonly active: readonly string[]
  readonly labels: ReadonlyMap<string, string>
  readonly providersLoaded: boolean
}

const PROVIDERS = createDedupe<readonly ProviderSummary[]>()

export async function fetchProviders(signal: AbortSignal): Promise<readonly ProviderSummary[]> {
  const response = await fetch('/api/providers', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    throw new ApiError(response.status, `GET /api/providers respondió ${response.status}`)
  }

  return providersResponseSchema.parse(await response.json()).providers
}

/**
 * El orden de preferencia de proveedores, tal como lo guardan los ajustes.
 *
 * Va por `/api/settings` y no por `/api/providers`: la preferencia es un ajuste
 * del usuario, no una capacidad del plugin, y `GET /api/providers` describe lo
 * que cargó. Se pide aparte y sin bloquear: los resultados se pintan en cuanto
 * llegan, y si esta petición falla la búsqueda se queda sin preferencia, que es
 * exactamente lo que hacía antes de que existiera.
 */
/**
 * El mínimo que se usa de `fetch`: una URL, unas opciones y una respuesta.
 *
 * Se inyecta en las pruebas en vez de tocar el `fetch` global: es el mismo
 * contrato que usan el cliente (`api/client.ts`) y el distribuidor, y no deja una
 * prueba dependiendo del orden de otras.
 */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

export async function fetchProviderPriority(
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<readonly string[]> {
  const response = await fetcher('/api/settings', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    throw new ApiError(response.status, `GET /api/settings respondió ${response.status}`)
  }

  return settingsResponseSchema.parse(await response.json()).providerPriority
}

const PRIORITY = createDedupe<readonly string[]>()

/** El orden guardado, una sola vez por montaje, y vacío si no se pudo leer. */
export function useProviderPriority(): readonly string[] {
  const [priority, setPriority] = useState<readonly string[]>([])

  useEffect(() => {
    const controller = new AbortController()

    PRIORITY.run('/api/settings', () => fetchProviderPriority(controller.signal)).then(
      (orden) => {
        if (!controller.signal.aborted) setPriority(orden)
      },
      () => {
        // Sin ajustes legibles no hay preferencia: la regla de siempre decide.
      },
    )

    return () => controller.abort()
  }, [])

  return priority
}

/**
 * Los proveedores cargados, una sola vez.
 *
 * La deduplicación importa aquí: dos componentes que monten a la vez —la
 * búsqueda y el panel de la home— comparten la petición en lugar de pedir dos
 * veces lo mismo.
 *
 * `failed` distingue «la lista está vacía» de «no se pudo leer la lista». El
 * primer arranque de la home sólo puede decir que no hay proveedores cuando la
 * lectura terminó bien; sobre una lectura fallida, afirmarlo sería mentir.
 */
export function useProviders(): {
  readonly summaries: readonly ProviderSummary[]
  readonly loaded: boolean
  readonly failed: boolean
} {
  const [summaries, setSummaries] = useState<readonly ProviderSummary[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    PROVIDERS.run('/api/providers', () => fetchProviders(controller.signal)).then(
      (resultado) => {
        if (controller.signal.aborted) return
        setSummaries(resultado)
        setFailed(false)
        setLoaded(true)
      },
      () => {
        if (controller.signal.aborted) return
        setFailed(true)
        setLoaded(true)
      },
    )

    return () => controller.abort()
  }, [])

  return { summaries, loaded, failed }
}

export interface PrefetchOptions {
  readonly fetchDetail: (providerId: string, ref: string, signal: AbortSignal) => Promise<unknown>
  /** Tope de precargas distintas. Nunca el catálogo: unas pocas tarjetas. */
  readonly max?: number
}

export interface Prefetcher {
  /** El puntero entró en una tarjeta. */
  hover(providerId: string, ref: string): void
  /** Salió: se cancela lo que estuviera en vuelo. */
  leave(): void
  /** Cuántas precargas distintas se han lanzado. */
  started(): number
}

/**
 * Precarga del detalle de las tarjetas visibles.
 *
 * Tres límites, y los tres importan: sólo se pide lo que el usuario señala, sólo
 * hay una petición en vuelo —la siguiente cancela la anterior— y hay un tope de
 * tarjetas distintas. Sin el tope, recorrer la rejilla con el puntero pediría el
 * catálogo entero, que es justo lo que el spec prohíbe.
 */
export function createPrefetcher(options: PrefetchOptions): Prefetcher {
  const max = options.max ?? 6
  const pedidas = new Set<string>()
  let actual: AbortController | undefined

  return {
    hover(providerId, ref) {
      const key = `${providerId}:${ref}`
      if (pedidas.has(key) || pedidas.size >= max) return

      actual?.abort()
      const controller = new AbortController()
      actual = controller
      pedidas.add(key)

      void options.fetchDetail(providerId, ref, controller.signal).catch(() => {})
    },
    leave() {
      actual?.abort()
      actual = undefined
    },
    started: () => pedidas.size,
  }
}

/**
 * La precarga de producción: la misma que calienta la ficha.
 *
 * Antes hacía su propio `fetch` del detalle y calentaba una caché que la ficha no
 * miraba: al abrir la tarjeta se pedía todo otra vez. Ahora delega en
 * `prefetchDetail`, que escribe en la caché compartida, deduplica lo que está en
 * vuelo y espera 100 ms antes de disparar.
 *
 * El `signal` no se usa, y es a propósito. El precargador cancelaba su petición al
 * salir del puntero, pero pasar por encima de una tarjeta es intención de abrirla:
 * la lectura sirve para la navegación aunque el puntero siga de largo, y una
 * promesa abortada dejaría la ficha con la precarga rota en vez de con el dato.
 */
export function createDefaultPrefetcher(): Prefetcher {
  return createPrefetcher({
    fetchDetail: (providerId, ref) => prefetchDetail(providerId, ref),
  })
}

export function useSearchStream(
  query: string,
  filter: readonly string[],
  /** La mitad que se está mirando. Filtrar aquí no basta: ver `searchRequestPath`. */
  media: MediaFilter = 'anime',
  /** Inyectable en los tests; en producción, el distribuidor de siempre. */
  hub: SearchHub = HUB,
): SearchStreamResult {
  const { summaries, loaded } = useProviders()
  /*
    La selección es la intersección de los proveedores activos, el filtro de la
    dirección y el tipo. En la petición viaja el filtro de la **dirección**, no la
    selección: la lista de proveedores tarda en llegar, y pedir con la selección
    haría dos búsquedas, la primera contra todas las fuentes.
  */
  const selected = useMemo(
    () => proveedoresSeleccionados(summaries, filter, media),
    [summaries, filter, media],
  )
  const path = useMemo(() => searchRequestPath(query, filter, media), [query, filter, media])
  const clave = selected.join(',')
  const [state, setState] = useState<SearchState>(() => initialState([]))

  useEffect(() => {
    // Los esqueletos salen de los proveedores **seleccionados**, no de todos: si
    // el filtro deja uno fuera, no puede quedar un esqueleto esperándolo.
    const filtrados = clave === '' ? [] : clave.split(',')

    const unsubscribe = hub.subscribe(path, filtrados, () => setState(hub.read(path)))
    setState(hub.read(path))

    return unsubscribe
  }, [hub, path, clave])

  const labels = useMemo(
    () => new Map(summaries.map((summary) => [summary.id, summary.name])),
    [summaries],
  )

  return { state, active: selected, labels, providersLoaded: loaded }
}
