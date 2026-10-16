/**
 * Búsqueda agregada sobre todos los proveedores activos.
 *
 * La regla es que **un proveedor no puede retrasar ni romper a los demás**. Un
 * plugin lento, uno que lanza y uno que se cuelga son casos normales, no
 * excepciones: la búsqueda emite lo que cada proveedor dé, en cuanto lo dé, y
 * cierra cuando todos han terminado o se han agotado.
 *
 * Por eso esto es un generador de eventos y no una función que devuelve una
 * lista: con la lista habría que esperar al más lento para poder pintar el
 * primero, que es justo lo que el spec prohíbe. El server convierte estos eventos
 * en SSE (T13); aquí no hay nada de HTTP.
 *
 * Cada proveedor recibe **su propia señal de tiempo límite**. Una compartida
 * haría que el más rápido ampliara el plazo del más lento, que es lo contrario
 * de lo que se quiere medir.
 */

import {
  type DiscoverItem,
  normalizeQuery,
  type ProviderError,
  type Result,
  type SearchResult,
} from '@nn-anime/core'
import {
  type CallOptions,
  classifyThrow,
  failureKindOf,
  type Provider,
  type ProviderFailureKind,
  search as searchProvider,
} from '@nn-anime/provider-sdk'

export { normalizeQuery }

/** Tiempo límite por proveedor, del spec. */
export const SEARCH_TIMEOUT_MS = 8000

export type SearchEvent =
  /** Lo que devolvió un proveedor, cuando lo devolvió. */
  | {
      readonly type: 'results'
      readonly providerId: string
      readonly results: readonly SearchResult[]
    }
  /** Un proveedor que no pudo responder, con el motivo. */
  | {
      readonly type: 'error'
      readonly providerId: string
      readonly kind: ProviderFailureKind
      readonly message: string
    }
  /**
   * Lo que AniList tiene de este término como estudio o como género.
   *
   * No es la respuesta de un proveedor y por eso lleva piezas de descubrimiento
   * —con su id de AniList y la referencia local cuando la base la conoce—: es la
   * mitad que ninguna fuente puede contestar y sale como evento propio para que la
   * rejilla de proveedores siga contando lo suyo.
   */
  | { readonly type: 'anilist'; readonly items: readonly DiscoverItem[] }
  /** Se acabó: han respondido todos, o se han agotado. */
  | { readonly type: 'done'; readonly providers: number }

export interface AggregateOptions {
  /** Tiempo límite por proveedor. Se acorta en los tests. */
  readonly timeoutMs?: number
  /**
   * Cómo se consulta a un proveedor. Por defecto, el SDK sin caché.
   *
   * Existe para que la ruta pueda meter la caché en medio sin que el agregado
   * sepa de tablas: quien llama decide de dónde salen los resultados.
   */
  readonly call?: (
    provider: Provider,
    query: string,
    callOptions: CallOptions,
  ) => Promise<Result<readonly SearchResult[], ProviderError>>
  /**
   * Cancelación del consumidor.
   *
   * Cuando el cliente corta la conexión hay que abortar también las peticiones a
   * los proveedores: sin esto, cada búsqueda abandonada seguiría trabajando
   * contra sitios de terceros.
   */
  readonly signal?: AbortSignal
}

/**
 * Cola con un solo consumidor: el generador empuja desde las promesas y espera
 * cuando no hay nada.
 *
 * Un generador no puede recibir valores de fuera, así que el productor escribe
 * aquí y el consumidor drena. `close` es lo que garantiza que el flujo termina
 * aunque un proveedor no responda nunca.
 */
function createQueue<T>() {
  const items: T[] = []
  let waiting: (() => void) | undefined
  let closed = false

  return {
    push(item: T): void {
      items.push(item)
      waiting?.()
      waiting = undefined
    },
    close(): void {
      closed = true
      waiting?.()
      waiting = undefined
    },
    async *drain(): AsyncGenerator<T> {
      while (true) {
        const item = items.shift()
        if (item !== undefined) {
          yield item
          continue
        }

        if (closed) return

        await new Promise<void>((resolve) => {
          waiting = resolve
        })
      }
    },
  }
}

/**
 * Consulta un proveedor y devuelve el evento que le corresponde.
 *
 * Nunca lanza: el SDK ya convierte la excepción en `Result`, y aquí se traduce a
 * evento. Es lo que hace que un plugin roto no pueda tumbar la búsqueda entera.
 */
/** La consulta por defecto: el SDK del proveedor, sin caché. */
async function callProvider(
  provider: Provider,
  query: string,
  callOptions: CallOptions,
): Promise<Result<readonly SearchResult[], ProviderError>> {
  return searchProvider(provider, query, callOptions)
}

async function searchOne(
  provider: Provider,
  query: string,
  timeoutMs: number,
  external?: AbortSignal,
  call: AggregateOptions['call'] = callProvider,
): Promise<SearchEvent> {
  const plazo = AbortSignal.timeout(timeoutMs)
  const signal = external === undefined ? plazo : AbortSignal.any([plazo, external])

  const consulta = call(provider, query, { signal, timeoutMs }).then((result): SearchEvent => {
    if (result.ok) {
      return { type: 'results', providerId: provider.id, results: result.value }
    }

    return {
      type: 'error',
      providerId: provider.id,
      kind: failureKindOf(result.error) ?? 'threw',
      message: result.error.message,
    }
  })

  // Si gana el tiempo límite, esta promesa se queda sin nadie que la escuche:
  // sin este `catch`, un rechazo tardío saldría por consola como rechazo no
  // gestionado y parecería un fallo de la aplicación.
  void consulta.catch(() => {})

  /**
   * El plazo lo cierra **este módulo**, no el proveedor.
   *
   * Pasar la señal no basta: un plugin que la ignore —o que esté haciendo una
   * llamada de red sin mirarla— mantendría la búsqueda abierta para siempre, y
   * el spec dice que su ausencia no puede bloquear la respuesta. La carrera
   * garantiza el cierre aunque el plugin no colabore.
   */
  const limite = new Promise<SearchEvent>((resolve) => {
    // El plazo se mide con su propia señal: una cancelación del cliente no es un
    // tiempo agotado, y decir «no respondió en 8000 ms» cuando el usuario cerró
    // la pestaña sería mentir en el único sitio donde se puede saber la verdad.
    plazo.addEventListener(
      'abort',
      () =>
        resolve({
          type: 'error',
          providerId: provider.id,
          kind: 'timeout',
          message: `el proveedor '${provider.id}' no respondió en ${timeoutMs} ms`,
        }),
      { once: true },
    )
  })

  return Promise.race([consulta, limite])
}

/**
 * Un evento extra —el de la búsqueda cruzada— mezclado con los de los proveedores.
 *
 * La regla es la misma que la de dentro de `searchAll`, ahora con una fuente más:
 * **ninguna espera a la otra**. El evento de AniList sale cuando llega, sin
 * retrasar a un proveedor, y los proveedores salen cuando responden sin retrasar a
 * AniList.
 *
 * `esCierre` marca el evento con el que la fuente da la búsqueda por terminada —el
 * `done`— y **se retiene hasta que el extra haya hablado**. Sin esa retención el
 * cierre sale antes que la cruzada y la pantalla concluye «nada coincide» mientras
 * la lista de AniList todavía está en camino: el orden de los eventos es una
 * promesa, y esa promesa es justo la que se mide.
 *
 * El extra es una promesa y no un generador porque es **un** evento: la búsqueda
 * cruzada es una consulta, no un flujo. Un extra que no llega a nada —sin lista,
 * con AniList caído o sin catálogo— se resuelve a `undefined` y no emite nada.
 */
export async function* mergeEvents<T>(
  fuente: AsyncGenerator<T>,
  extra: Promise<T | undefined>,
  esCierre: (evento: T) => boolean = () => false,
): AsyncGenerator<T> {
  type Ganador =
    | { readonly de: 'extra'; readonly evento: T | undefined }
    | { readonly de: 'fuente'; readonly paso: IteratorResult<T> }

  let pendienteExtra: Promise<Ganador> | undefined = extra.then((evento) => ({
    de: 'extra',
    evento,
  }))
  let pendienteFuente: Promise<Ganador> | undefined = fuente.next().then((paso) => ({
    de: 'fuente',
    paso,
  }))
  let fuenteViva = true
  let cierre: T | undefined

  while (fuenteViva || pendienteExtra !== undefined) {
    const esperas: Promise<Ganador>[] = []
    if (pendienteFuente !== undefined) esperas.push(pendienteFuente)
    if (pendienteExtra !== undefined) esperas.push(pendienteExtra)

    const ganador = await Promise.race(esperas)

    if (ganador.de === 'extra') {
      pendienteExtra = undefined
      if (ganador.evento !== undefined) yield ganador.evento
      continue
    }

    if (ganador.paso.done === true) {
      // La fuente agotada no se vuelve a pedir: su promesa ya resolvió y volver a
      // `next()` sería un turno por nada.
      fuenteViva = false
      pendienteFuente = undefined
      continue
    }

    // El cierre se guarda y se sigue drenando la fuente: lo que quede por salir
    // —nada, porque `searchAll` cierra con él— se leería después de un evento que
    // ya da la búsqueda por terminada.
    if (esCierre(ganador.paso.value)) {
      cierre = ganador.paso.value
    } else {
      yield ganador.paso.value
    }

    pendienteFuente = fuente.next().then((paso) => ({ de: 'fuente', paso }))
  }

  // Aquí las dos fuentes callaron: el cierre sale ya con la cruzada dicha.
  if (cierre !== undefined) yield cierre
}

/**
 * Consulta todos los proveedores en paralelo y emite según van llegando.
 *
 * El orden de los eventos es el orden en que responden, no el de la lista: eso
 * es lo que permite pintar resultados mientras los demás siguen trabajando.
 */
export async function* searchAll(
  providers: readonly Provider[],
  query: string,
  options: AggregateOptions = {},
): AsyncGenerator<SearchEvent> {
  const normalized = normalizeQuery(query)
  const timeoutMs = options.timeoutMs ?? SEARCH_TIMEOUT_MS
  const queue = createQueue<SearchEvent>()
  const external = options.signal

  if (external?.aborted === true) return

  // El cierre por cancelación no emite evento: no queda nadie a quien contarlo.
  external?.addEventListener('abort', () => queue.close(), { once: true })

  // Sin proveedores no hay nada que esperar, y esperar sería colgarse.
  if (providers.length === 0) {
    yield { type: 'done', providers: 0 }
    return
  }

  for (const provider of providers) {
    // El `catch` no es por si acaso: convierte en dato cualquier cosa que se
    // escape de la cadena, y así «esto nunca lanza» deja de ser una promesa del
    // comentario y pasa a ser una propiedad del código.
    void searchOne(provider, normalized, timeoutMs, external, options.call)
      .catch(
        (cause: unknown): SearchEvent => ({
          type: 'error',
          providerId: provider.id,
          kind: classifyThrow(cause),
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      )
      .then((event) => queue.push(event))
  }

  let pending = providers.length
  for await (const event of queue.drain()) {
    yield event

    pending -= 1
    if (pending === 0) {
      queue.close()
      yield { type: 'done', providers: providers.length }
      return
    }
  }
}
