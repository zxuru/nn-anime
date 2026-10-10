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

import type { SearchResult } from '@nn-anime/core'
import {
  classifyThrow,
  failureKindOf,
  type Provider,
  type ProviderFailureKind,
  search as searchProvider,
} from '@nn-anime/provider-sdk'

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
  /** Se acabó: han respondido todos, o se han agotado. */
  | { readonly type: 'done'; readonly providers: number }

/**
 * Clave de una consulta: sin espacios de sobra, en minúsculas y en NFC.
 *
 * Las tres cosas juntas porque las tres cambian el resultado de comparar textos
 * que el usuario ve iguales: `" Naruto "` y `"naruto"` son la misma búsqueda, y
 * una `é` compuesta y una descompuesta también. Sin NFC, la misma consulta
 * escrita en un teclado u otro llenaría dos entradas de caché distintas.
 */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().normalize('NFC')
}

export interface AggregateOptions {
  /** Tiempo límite por proveedor. Se acorta en los tests. */
  readonly timeoutMs?: number
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
async function searchOne(
  provider: Provider,
  query: string,
  timeoutMs: number,
): Promise<SearchEvent> {
  const signal = AbortSignal.timeout(timeoutMs)

  const consulta = searchProvider(provider, query, { signal, timeoutMs }).then(
    (result): SearchEvent => {
      if (result.ok) {
        return { type: 'results', providerId: provider.id, results: result.value }
      }

      return {
        type: 'error',
        providerId: provider.id,
        kind: failureKindOf(result.error) ?? 'threw',
        message: result.error.message,
      }
    },
  )

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
    signal.addEventListener(
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

  // Sin proveedores no hay nada que esperar, y esperar sería colgarse.
  if (providers.length === 0) {
    yield { type: 'done', providers: 0 }
    return
  }

  for (const provider of providers) {
    // El `catch` no es por si acaso: convierte en dato cualquier cosa que se
    // escape de la cadena, y así «esto nunca lanza» deja de ser una promesa del
    // comentario y pasa a ser una propiedad del código.
    void searchOne(provider, normalized, timeoutMs)
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
