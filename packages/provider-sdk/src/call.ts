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

import type {
  AnimeDetail,
  Episode,
  ProviderError,
  ProviderRef,
  Result,
  SearchResult,
  StreamRequest,
  StreamSource,
} from '@nn-anime/core'
import { err, ok } from '@nn-anime/core'
import type { z } from 'zod'
import { classifyThrow, describeProblems, providerFailure } from './errors'
import {
  providerAnimeDetailSchema,
  providerEpisodesSchema,
  providerSearchResultsSchema,
  providerStreamSourcesSchema,
} from './schema'
import type { CallOptions, Provider, ProviderMethod } from './types'

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
    provider.search(query, options),
  )

  return parse(provider, 'search', providerSearchResultsSchema, raw)
}

export async function getAnime(
  provider: Provider,
  ref: ProviderRef,
  options: CallOptions,
): Promise<Result<AnimeDetail, ProviderError>> {
  const raw = await execute(provider, 'getAnime', true, () => provider.getAnime(ref, options))

  return parse(provider, 'getAnime', providerAnimeDetailSchema, raw)
}

export async function getEpisodes(
  provider: Provider,
  ref: ProviderRef,
  options: CallOptions,
): Promise<Result<readonly Episode[], ProviderError>> {
  const raw = await execute(provider, 'getEpisodes', true, () => provider.getEpisodes(ref, options))

  return parse(provider, 'getEpisodes', providerEpisodesSchema, raw)
}

export async function resolveStream(
  provider: Provider,
  request: StreamRequest,
  options: CallOptions,
): Promise<Result<readonly StreamSource[], ProviderError>> {
  const raw = await execute(provider, 'resolveStream', true, () =>
    provider.resolveStream(request, options),
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

  const raw = await execute(provider, 'getTrending', true, () => invoke(options))

  return parse(provider, 'getTrending', providerSearchResultsSchema, raw)
}
