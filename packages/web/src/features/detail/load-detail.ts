/**
 * La lectura completa de una ficha.
 *
 * Antes vivía dentro de `useDetail`; ahora vive aquí porque la piden dos sitios
 * con el mismo contrato: la pantalla, al abrirse, y la **precarga**, al pasar el
 * puntero por una tarjeta. Con dos copias de las siete peticiones, la precarga
 * calentaría una caché con otra forma que la que la pantalla sabe leer.
 *
 * Ocho lecturas en paralelo —detalle, relacionados, franquicia, fuentes, vistos,
 * proveedores, enriquecimiento y metadatos— porque ninguna necesita a las otras;
 * en serie, la ficha tardaría la suma de las ocho latencias. La novena, las
 * relaciones de AniList, va aparte: es un tercero con su propio espaciado y no
 * puede retrasar la ficha.
 *
 * **Dos lecturas no pueden tumbar la ficha.** El enriquecimiento de AniList y los
 * metadatos de TMDB son adornos de terceros: si fallan, la ficha se queda sin
 * ellos en vez de en la pantalla de error.
 *
 * El tiempo límite es el de la ficha entera —20 s, el «timeout duro»— y no el de
 * la petición suelta: el proveedor puede contestar en 9 s y todavía estar dentro
 * de lo razonable. `fetch` corta a los 20 s y la pantalla enseña su tarjeta de
 * error.
 */

import type {
  AniListRelatedItem,
  Enrichment,
  TmdbMetadata,
  WatchedEpisodePayload,
} from '@nn-anime/core/api'
import {
  anilistRelatedResponseSchema,
  animeResponseSchema,
  enrichmentResponseSchema,
  providersResponseSchema,
  relatedResponseSchema,
  sourcesResponseSchema,
  tmdbMetadataResponseSchema,
  watchedResponseSchema,
} from '@nn-anime/core/api'
import type { AnimeDetail, AnimeSummary, ProviderCapabilities } from '@nn-anime/core/models'
import { apiGet, type RequestDeps } from '../../api/client'
import { DetailCache, detailCacheKey } from '../../api/detail-cache'
import { conLaConsulta } from './direccion'
import { anilistRelatedPath, relatedPath, sourcesPath } from './paths'

/** El tiempo límite de la ficha: veinte segundos, el que declara el contrato. */
export const DETAIL_TIMEOUT_MS = 20_000

/** Lo que la ficha sabe cuando termina de cargar. */
export interface DetailBundle {
  readonly detail: AnimeDetail
  readonly related: readonly AnimeSummary[]
  readonly franchise: readonly AnimeSummary[]
  readonly sources: readonly AnimeSummary[]
  readonly watched: readonly WatchedEpisodePayload[]
  readonly capabilities: ProviderCapabilities | undefined
  readonly providerNames: ReadonlyMap<string, string>
  /** `null` es «no hay nada nuevo»; el fallo del tercero también cae aquí. */
  readonly enrichment: Enrichment | null
  readonly metadata: TmdbMetadata | null
}

export interface DetailLoadOptions {
  readonly signal?: AbortSignal
  /**
   * La búsqueda de la que viene la ficha, si viene de una.
   *
   * Sólo la petición del detalle la lleva: es lo que el servidor anota en
   * `search_history`, la señal con la que el motor recomienda lo que el usuario
   * está buscando. Las otras lecturas de la ficha no la necesitan y pedírsela al
   * proveedor no cambiaría nada.
   */
  readonly consulta?: string | undefined
  /** Se inyecta en los tests; en producción, el `fetch` del navegador. */
  readonly deps?: RequestDeps
}

function opciones(options: DetailLoadOptions): {
  readonly signal?: AbortSignal
  readonly timeoutMs: number
} {
  return {
    timeoutMs: DETAIL_TIMEOUT_MS,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
}

/**
 * Las ocho lecturas de la ficha, ya con su forma validada.
 *
 * Lanza cuando falla la lectura principal o cualquiera de las que la ficha
 * necesita; los dos adornos de terceros se tragan su fallo. Es responsabilidad de
 * quien llama comprobar `signal.aborted` antes de pintar.
 */
export async function loadDetailBundle(
  providerId: string,
  ref: string,
  options: DetailLoadOptions = {},
): Promise<DetailBundle> {
  /*
    La consulta sólo viaja en la lectura del detalle: es la que el servidor anota
    como rastro de la búsqueda. Las subrutas —vistos, enriquecimiento, metadatos—
    se componen sobre la **base** y no sobre esa dirección: con la consulta dentro,
    el sufijo caía detrás del `?` y la ruta pedida dejaba de existir.
  */
  const base = `/api/anime/${encodeURIComponent(providerId)}/${encodeURIComponent(ref)}`
  const ruta = conLaConsulta(base, options.consulta)
  const deps = options.deps
  const opts = opciones(options)

  const [detalle, hermanos, franquicia, fuentes, vistos, proveedores, enriquecido, metadatos] =
    await Promise.all([
      apiGet(ruta, animeResponseSchema, opts, deps),
      apiGet(relatedPath(providerId, ref), relatedResponseSchema, opts, deps),
      apiGet(relatedPath(providerId, ref, 'franchise'), relatedResponseSchema, opts, deps),
      apiGet(sourcesPath(providerId, ref), sourcesResponseSchema, opts, deps),
      apiGet(`${base}/watched`, watchedResponseSchema, opts, deps),
      apiGet('/api/providers', providersResponseSchema, opts, deps),
      // El enriquecimiento **no puede tumbar la ficha**: su fallo se queda en «no
      // hay nada nuevo».
      apiGet(`${base}/enrichment`, enrichmentResponseSchema, opts, deps).catch(() => ({
        enrichment: null,
      })),
      // Los metadatos de TMDB tampoco: sin clave la ruta ya devuelve `null`.
      apiGet(`${base}/metadata`, tmdbMetadataResponseSchema, opts, deps).catch(() => ({
        metadata: null,
      })),
    ])

  return {
    detail: detalle,
    related: hermanos.items,
    franchise: franquicia.items,
    sources: fuentes.items,
    watched: vistos.episodes,
    capabilities: proveedores.providers.find((provider) => provider.id === providerId)
      ?.capabilities,
    providerNames: new Map(
      proveedores.providers.map((provider) => [provider.id, provider.name] as const),
    ),
    enrichment: enriquecido.enrichment,
    metadata: metadatos.metadata,
  }
}

/**
 * Las relaciones de AniList, aparte y sin bloquear.
 *
 * Su consulta al tercero está espaciada —una cada dos segundos—, así que la ficha
 * no la espera: la sección aparece cuando llega. El fallo se traga a propósito:
 * un tercero caído no es un fallo de esta pantalla.
 */
export async function loadAnilistRelated(
  providerId: string,
  ref: string,
  options: DetailLoadOptions = {},
): Promise<readonly AniListRelatedItem[]> {
  const respuesta = await apiGet(
    anilistRelatedPath(providerId, ref),
    anilistRelatedResponseSchema,
    opciones(options),
    options.deps,
  )

  return respuesta.items
}

/**
 * La caché de las fichas: una sola para toda la aplicación.
 *
 * Cinco minutos de frescura y cincuenta fichas. La comparten el cargador, la
 * precarga y la pantalla, y por eso vive aquí: `useDetail` no tiene por qué saber
 * que existe una caché para leer una ficha.
 */
export const detailCache = new DetailCache<DetailBundle>()

/** La clave de una ficha en esa caché. */
export function claveDeFicha(providerId: string, ref: string): string {
  return detailCacheKey(providerId, ref)
}
