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
import type { StreamRequest, StreamSource } from '@nn-anime/core'
import {
  type AnimeDetail,
  type Episode,
  err,
  normalizeQuery,
  ok,
  ProviderError,
  type ProviderRef,
  type Result,
  type SearchResult,
} from '@nn-anime/core'
import { createTicketStore, type TicketStore } from '@nn-anime/media-proxy'
import {
  type CallOptions,
  getAnime as fetchAnime,
  getEpisodes as fetchEpisodes,
  resolveStream as fetchStream,
  type Provider,
  search as searchProvider,
} from '@nn-anime/provider-sdk'
import { type CacheOutcome, readThrough } from './cache-read'

/** Clave de caché de una búsqueda: el proveedor y la consulta normalizada. */
export function searchKey(providerId: string, query: string): string {
  return `${providerId}#${normalizeQuery(query)}`
}

export interface ServerContainer {
  readonly store: CatalogStore
  readonly revalidator: Revalidator
  readonly queue: WriteQueue
  /** Tickets opacos: el cliente nunca ve una URL del upstream. */
  readonly tickets: TicketStore
  /** Resuelve el stream de un episodio, con la caché de URL corta. */
  resolveStream(
    provider: Provider,
    request: StreamRequest,
    callOptions: CallOptions,
  ): Promise<Result<CacheOutcome<readonly StreamSource[]>, ProviderError>>
  /** Detalle de un título, con caché y refresco por detrás si toca. */
  getAnime(
    provider: Provider,
    ref: ProviderRef,
    callOptions: CallOptions,
  ): Promise<Result<CacheOutcome<AnimeDetail>, ProviderError>>
  /** Lista de episodios, con caché. Deja el detalle escrito si hacía falta. */
  getEpisodes(
    provider: Provider,
    ref: ProviderRef,
    callOptions: CallOptions,
  ): Promise<Result<CacheOutcome<readonly Episode[]>, ProviderError>>
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
  /** Almacén de tickets. Se inyecta para poder fijar la capacidad en un test. */
  readonly tickets?: TicketStore
}

export function createContainer(options: ContainerOptions): ServerContainer {
  const queue = options.queue ?? createWriteQueue()
  const revalidator = options.revalidator ?? createRevalidator({ concurrency: 2 })
  const resource: RevalidateResource = 'search'

  // El store comparte la cola y el revalidador: con uno distinto en cada sitio,
  // el cierre tendría que acordarse de todos y las escrituras de fondo podrían
  // solaparse con las de la ruta.
  const store = createCatalogStore(options.db, { queue, revalidator })
  const tickets = options.tickets ?? createTicketStore()

  /**
   * El stream de un episodio, con su caché de URL corta.
   *
   * No pasa por `readThrough` porque aquí **no hay rama stale**: un enlace
   * vencido no se sirve «un poco viejo», se resuelve otra vez. La caché de
   * streams devuelve `null` en cuanto pasa el TTL, así que sólo hay acierto o
   * fallo, y refrescar por detrás no tiene sentido: nadie espera un enlace que
   * ya no vale.
   */
  const loadStream = async (
    provider: Provider,
    request: StreamRequest,
    callOptions: CallOptions,
  ): Promise<Result<CacheOutcome<readonly StreamSource[]>, ProviderError>> => {
    try {
      const cached = await store.readStream(request.episodeRef, request.mode)
      if (cached !== null) return ok({ value: [cached], source: 'hit' })

      const resultado = await fetchStream(provider, request, callOptions)
      if (!resultado.ok) return err(resultado.error)

      try {
        await store.writeStream(request, resultado.value)
      } catch {
        // No poder cachear es peor rendimiento, no un fallo: el episodio puede
        // no estar en la base porque nadie abrió su ficha. Devolver un error
        // aquí dejaría al usuario sin reproducir por un problema de caché.
      }

      return ok({ value: resultado.value, source: 'miss' })
    } catch (cause) {
      return err(asProviderError(cause, provider.id, 'resolveStream'))
    }
  }

  const loadAnime = async (
    provider: Provider,
    ref: ProviderRef,
    callOptions: CallOptions,
  ): Promise<Result<CacheOutcome<AnimeDetail>, ProviderError>> => {
    const clave = `${provider.id}#${ref.value}`

    try {
      const outcome = await readThrough<AnimeDetail>({
        key: clave,
        resource: 'anime',
        revalidator,
        read: () => store.readAnime(ref),
        fetch: async () => {
          const resultado = await fetchAnime(provider, ref, callOptions)
          if (!resultado.ok) throw resultado.error

          return resultado.value
        },
        write: (detalle) => store.writeAnime(ref, detalle),
        onError: (key, message) => {
          markRevalidateError(options.db, 'anime', key, message)
        },
        onSuccess: (key) => {
          clearRevalidateError(options.db, 'anime', key)
        },
      })

      return ok(outcome)
    } catch (cause) {
      return err(asProviderError(cause, provider.id, 'getAnime'))
    }
  }

  const loadEpisodes = async (
    provider: Provider,
    ref: ProviderRef,
    callOptions: CallOptions,
  ): Promise<Result<CacheOutcome<readonly Episode[]>, ProviderError>> => {
    const clave = `${provider.id}#${ref.value}`

    // La lista de episodios pertenece a un anime, y la clave foránea lo exige:
    // sin la fila del título, guardar episodios falla. Si no está, se pide el
    // detalle primero —una llamada más en el peor caso— en lugar de escribir
    // episodios huérfanos que no se podrían leer.
    if ((await store.readAnime(ref)) === null) {
      const detalle = await loadAnime(provider, ref, callOptions)
      if (!detalle.ok) return detalle
    }

    try {
      const outcome = await readThrough<readonly Episode[]>({
        key: clave,
        resource: 'episodes',
        revalidator,
        read: () => store.readEpisodes(ref),
        fetch: async () => {
          const resultado = await fetchEpisodes(provider, ref, callOptions)
          if (!resultado.ok) throw resultado.error

          return resultado.value
        },
        write: (lista) => store.writeEpisodes(ref, lista),
        onError: (key, message) => {
          markRevalidateError(options.db, 'episodes', key, message)
        },
        onSuccess: (key) => {
          clearRevalidateError(options.db, 'episodes', key)
        },
      })

      return ok(outcome)
    } catch (cause) {
      return err(asProviderError(cause, provider.id, 'getEpisodes'))
    }
  }

  return {
    store,
    revalidator,
    queue,
    tickets,
    getAnime: loadAnime,
    getEpisodes: loadEpisodes,
    resolveStream: loadStream,

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
        return err(asProviderError(cause, provider.id, 'search'))
      }
    },

    async close() {
      await store.close()
    },
  }
}

/** Cualquier fallo se convierte en el error del proveedor que lo causó. */
function asProviderError(cause: unknown, providerId: string, op: string): ProviderError {
  return cause instanceof ProviderError
    ? cause
    : new ProviderError({
        message: cause instanceof Error ? cause.message : String(cause),
        scope: providerId,
        op,
        cause,
      })
}
