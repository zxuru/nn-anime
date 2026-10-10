/**
 * Contenedor del server: composición de las dependencias que antes se pasaban
 * sueltas.
 *
 * Aquí se juntan la base, la fachada del store, la cola de escritura y la cola
 * de revalidación, y se expone lo que las rutas necesitan de verdad: consultar
 * un proveedor **con caché**. La ruta no sabe de tablas ni de TTL; sabe pedir
 * resultados.
 *
 * La política de caché vive en un solo sitio a propósito. Repetida en cada ruta
 * —búsqueda ahora, detalle y episodios en T23— acabaría con tres versiones del
 * mismo cálculo y una de ellas mal.
 */

import {
  type CatalogStore,
  clearRevalidateError,
  createCatalogStore,
  createRevalidator,
  createWriteQueue,
  markRevalidateError,
  type RevalidateResource,
  type Revalidator,
  type StoreConnection,
  type WriteQueue,
} from '@nn-anime/catalog-store'
import {
  err,
  normalizeQuery,
  ok,
  ProviderError,
  type Result,
  type SearchResult,
} from '@nn-anime/core'
import { type CallOptions, type Provider, search as searchProvider } from '@nn-anime/provider-sdk'
import { type CacheOutcome, readThrough } from './cache-read'

/** Clave de caché de una búsqueda: el proveedor y la consulta normalizada. */
export function searchKey(providerId: string, query: string): string {
  return `${providerId}#${normalizeQuery(query)}`
}

export interface ServerContainer {
  readonly store: CatalogStore
  readonly revalidator: Revalidator
  readonly queue: WriteQueue
  /** Resultados de un proveedor, con caché y refresco por detrás si toca. */
  searchProvider(
    provider: Provider,
    query: string,
    callOptions: CallOptions,
  ): Promise<Result<CacheOutcome<readonly SearchResult[]>, ProviderError>>
  close(): Promise<void>
}

export interface ContainerOptions {
  readonly db: StoreConnection
  readonly queue?: WriteQueue
  readonly revalidator?: Revalidator
}

export function createContainer(options: ContainerOptions): ServerContainer {
  const queue = options.queue ?? createWriteQueue()
  const revalidator = options.revalidator ?? createRevalidator({ concurrency: 2 })
  const resource: RevalidateResource = 'search'

  // El store comparte la cola y el revalidador: con uno distinto en cada sitio,
  // el cierre tendría que acordarse de todos y las escrituras de fondo podrían
  // solaparse con las de la ruta.
  const store = createCatalogStore(options.db, { queue, revalidator })

  return {
    store,
    revalidator,
    queue,

    async searchProvider(provider, query, callOptions) {
      const key = searchKey(provider.id, query)

      try {
        const outcome = await readThrough<readonly SearchResult[]>({
          key,
          resource,
          revalidator,
          read: () => store.readSearch(provider.id, query),
          fetch: async () => {
            const resultado = await searchProvider(provider, query, callOptions)
            if (!resultado.ok) throw resultado.error

            return resultado.value
          },
          write: async (results) => {
            await store.writeSearch(provider.id, query, results)
          },
          onError: (clave, message) => {
            markRevalidateError(options.db, resource, clave, message)
          },
          onSuccess: (clave) => {
            clearRevalidateError(options.db, resource, clave)
          },
        })

        return ok(outcome)
      } catch (cause) {
        // La ruta no tiene que saber si falló el proveedor o la escritura: aquí
        // se convierte en un `Result` y el agregado decide qué evento emitir.
        return err(
          cause instanceof ProviderError
            ? cause
            : new ProviderError({
                message: cause instanceof Error ? cause.message : String(cause),
                scope: provider.id,
                op: 'search',
                cause,
              }),
        )
      }
    },

    async close() {
      await store.close()
    },
  }
}
