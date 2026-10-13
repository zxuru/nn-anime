/**
 * Llamadas a un plugin que nunca lanzan.
 *
 * Un plugin puede lanzar lo que quiera, en cualquier momento. Si esa excepción
 * sube, se lleva por delante la respuesta que se estaba componiendo: el usuario
 * ve un error de la aplicación por culpa de un plugin ajeno. Aquí se convierte
 * en un `Result` con proveedor, método y causa, y quien llama decide qué hacer.
 *
 * Y la respuesta **se valida antes de salir**: un plugin que devuelve una forma
 * distinta de la prometida es tan peligroso como uno que lanza, porque el error
 * aparecería tres capas más arriba, sin relación con su origen. Se valida con
 * los schemas de `schema.ts`, que nombran el campo y el header que fallan.
 *
 * Lo que no se comprueba aquí es que el método exista: `validateProvider` lo
 * rechaza al cargar el plugin. Lo que sí se comprueba es la capacidad, que es
 * una promesa de contenido: un proveedor sin `dub` no tiene por qué recibir una
 * petición de doblaje.
 */

import {
  type AnimeDetail,
  type Episode,
  episodeSchema,
  err,
  type FeedEntry,
  ok,
  ProviderError,
  type ProviderRef,
  type Result,
  type SearchResult,
  type StreamRequest,
  type StreamSource,
} from '@nn-anime/core'
import type { z } from 'zod'
import { classifyThrow, describeProblems, providerFailure } from './errors'
import { pluginFetchFor } from './network'
import {
  providerAnimeDetailSchema,
  providerEpisodePageSchema,
  providerEpisodesSchema,
  providerFeedSchema,
  providerSearchResultsSchema,
  providerStreamSourcesSchema,
} from './schema'
import type { CallOptions, EpisodePage, Provider, ProviderMethod } from './types'

/**
 * Las opciones que ve el plugin: las de la llamada, con la capacidad de red puesta.
 *
 * `fetch` es opcional en el contrato —un miembro obligatorio rompería a todo lo
 * publicado y a la plantilla—, pero el motor la pone **siempre**: un plugin que
 * prefiera el `fetch` global se salta la política de destinos, y eso tiene que ser
 * una decisión visible y no un descuido. Si no hay ninguna capacidad registrada no
 * se pone nada, y el plugin que la use falla cerrado con un mensaje claro.
 */
function conCapacidad(options: CallOptions): CallOptions {
  if (options.fetch !== undefined) return options

  const fetch = pluginFetchFor({ signal: options.signal, timeoutMs: options.timeoutMs })

  return fetch === undefined ? options : { ...options, fetch }
}

/**
 * Ejecuta y convierte la excepción en `Result`.
 *
 * El `catch` no filtra por tipo: cualquier cosa que un plugin lance —un `Error`,
 * un `string`, un objeto suelto— se convierte. Un `catch` que sólo mirara `Error`
 * dejaría escapar el resto, y el resto existe: `throw 'algo'` es legal.
 */
async function execute(
  provider: Provider,
  method: ProviderMethod,
  capability: boolean,
  invoke: () => Promise<unknown>,
): Promise<Result<unknown, ProviderError>> {
  if (!capability) {
    return err(providerFailure({ providerId: provider.id, method, kind: 'unsupported' }))
  }

  try {
    return ok(await invoke())
  } catch (cause) {
    // Un `ProviderError` ya viene clasificado por el plugin, y puede traer datos
    // que aquí no se pueden reconstruir —el estado HTTP del upstream, por
    // ejemplo—. Envolverlo otra vez los perdería y convertiría un 404 del sitio
    // en un fallo genérico.
    if (cause instanceof ProviderError) return err(cause)

    return err(
      providerFailure({
        providerId: provider.id,
        method,
        kind: classifyThrow(cause),
        cause,
      }),
    )
  }
}

/**
 * Valida una respuesta ya obtenida.
 *
 * El schema se pasa explícito en vez de mirarlo por el nombre del método: así el
 * tipo de salida lo infiere el compilador del propio schema y no hay ninguna
 * conversión de tipo por el medio.
 */
function parse<T>(
  provider: Provider,
  method: ProviderMethod,
  schema: z.ZodType<T>,
  raw: Result<unknown, ProviderError>,
): Result<T, ProviderError> {
  if (!raw.ok) return raw

  const parsed = schema.safeParse(raw.value)
  if (parsed.success) return ok(parsed.data)

  return err(
    providerFailure({
      providerId: provider.id,
      method,
      kind: 'invalid-shape',
      detail: describeProblems(parsed.error.issues),
    }),
  )
}

export async function search(
  provider: Provider,
  query: string,
  options: CallOptions,
): Promise<Result<readonly SearchResult[], ProviderError>> {
  const raw = await execute(provider, 'search', provider.capabilities.search, () =>
    provider.search(query, conCapacidad(options)),
  )

  return parse(provider, 'search', providerSearchResultsSchema, raw)
}

export async function getAnime(
  provider: Provider,
  ref: ProviderRef,
  options: CallOptions,
): Promise<Result<AnimeDetail, ProviderError>> {
  const raw = await execute(provider, 'getAnime', true, () =>
    provider.getAnime(ref, conCapacidad(options)),
  )

  return parse(provider, 'getAnime', providerAnimeDetailSchema, raw)
}

export async function getEpisodes(
  provider: Provider,
  ref: ProviderRef,
  options: CallOptions,
): Promise<Result<readonly Episode[], ProviderError>> {
  const raw = await execute(provider, 'getEpisodes', true, () =>
    provider.getEpisodes(ref, conCapacidad(options)),
  )

  return parse(provider, 'getEpisodes', providerEpisodesSchema, raw)
}

/**
 * Una página de episodios.
 *
 * Igual que `getFeed`: la capacidad declarada manda y la respuesta se valida
 * antes de salir. Un plugin que devuelve la página 0, o un episodio que no
 * cumple el schema, se rechaza nombrando el campo en vez de llegar a la caché.
 */
export async function getEpisodesPage(
  provider: Provider,
  ref: ProviderRef,
  page: number,
  options: CallOptions,
): Promise<Result<EpisodePage, ProviderError>> {
  const invoke = provider.getEpisodesPage
  if (provider.capabilities.episodePages !== true || invoke === undefined) {
    return err(
      providerFailure({ providerId: provider.id, method: 'getEpisodesPage', kind: 'unsupported' }),
    )
  }

  const raw = await execute(provider, 'getEpisodesPage', true, () =>
    invoke(ref, page, conCapacidad(options)),
  )

  return parse(provider, 'getEpisodesPage', providerEpisodePageSchema, raw)
}

/**
 * Un episodio concreto.
 *
 * La misma capacidad que la página: un plugin que sabe numerar sus episodios
 * sabe devolver uno, y declarar una mitad ofrecería un salto que no lleva a
 * ninguna parte.
 */
export async function getEpisode(
  provider: Provider,
  ref: ProviderRef,
  number: number,
  options: CallOptions,
): Promise<Result<Episode, ProviderError>> {
  const invoke = provider.getEpisode
  if (provider.capabilities.episodePages !== true || invoke === undefined) {
    return err(
      providerFailure({ providerId: provider.id, method: 'getEpisode', kind: 'unsupported' }),
    )
  }

  const raw = await execute(provider, 'getEpisode', true, () =>
    invoke(ref, number, conCapacidad(options)),
  )

  return parse(provider, 'getEpisode', episodeSchema, raw)
}

/** El último episodio del título, sin pedir la lista entera para averiguarlo. */
export async function getLatestEpisode(
  provider: Provider,
  ref: ProviderRef,
  options: CallOptions,
): Promise<Result<Episode, ProviderError>> {
  const invoke = provider.getLatestEpisode
  if (provider.capabilities.episodePages !== true || invoke === undefined) {
    return err(
      providerFailure({ providerId: provider.id, method: 'getLatestEpisode', kind: 'unsupported' }),
    )
  }

  const raw = await execute(provider, 'getLatestEpisode', true, () =>
    invoke(ref, conCapacidad(options)),
  )

  return parse(provider, 'getLatestEpisode', episodeSchema, raw)
}

export async function resolveStream(
  provider: Provider,
  request: StreamRequest,
  options: CallOptions,
): Promise<Result<readonly StreamSource[], ProviderError>> {
  const raw = await execute(provider, 'resolveStream', true, () =>
    provider.resolveStream(request, conCapacidad(options)),
  )

  return parse(provider, 'resolveStream', providerStreamSourcesSchema, raw)
}

export async function getTrending(
  provider: Provider,
  options: CallOptions,
): Promise<Result<readonly SearchResult[], ProviderError>> {
  const invoke = provider.getTrending
  if (!provider.capabilities.trending || invoke === undefined) {
    return err(
      providerFailure({ providerId: provider.id, method: 'getTrending', kind: 'unsupported' }),
    )
  }

  const raw = await execute(provider, 'getTrending', true, () => invoke(conCapacidad(options)))

  return parse(provider, 'getTrending', providerSearchResultsSchema, raw)
}

/**
 * Las novedades de la fuente.
 *
 * Igual que `getTrending`: la capacidad declarada manda, y la respuesta se valida
 * antes de salir. Un feed que devuelve una fecha que no es ISO-8601 se rechaza
 * nombrando el campo, en vez de llegar a la caché y envenenarla.
 */
export async function getFeed(
  provider: Provider,
  options: CallOptions,
): Promise<Result<readonly FeedEntry[], ProviderError>> {
  const invoke = provider.getFeed
  if (!provider.capabilities.feed || invoke === undefined) {
    return err(providerFailure({ providerId: provider.id, method: 'getFeed', kind: 'unsupported' }))
  }

  const raw = await execute(provider, 'getFeed', true, () => invoke(conCapacidad(options)))

  return parse(provider, 'getFeed', providerFeedSchema, raw)
}
