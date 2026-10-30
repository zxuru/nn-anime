/**
 * La lectura de una ficha, en dos tiempos.
 *
 * Antes vivía dentro de `useDetail`; ahora vive aquí porque la piden dos sitios
 * con el mismo contrato: la pantalla, al abrirse, y la **precarga**, al pasar el
 * puntero por una tarjeta. Con dos copias de las lecturas, la precarga calentaría
 * una caché con otra forma que la que la pantalla sabe leer.
 *
 * **El orden no es un detalle de rendimiento: es parte del contrato del
 * servidor.** El enriquecimiento, los metadatos y las relaciones de AniList
 * preguntan primero qué obra local es, leyendo la fila que escribe la lectura del
 * detalle. Pedirlas a la vez que el detalle —como se hacía— las hacía leer una
 * base vacía en una ficha que nadie había abierto todavía, así que la ficha se
 * quedaba sin banner y sin relacionados hasta recargar. Por eso la carga va en
 * dos tiempos:
 *
 * 1. `loadDetailCore`: detalle, relacionados, franquicia, fuentes, vistos y
 *    proveedores, en paralelo. Ninguna necesita a las otras y con esto la ficha
 *    se puede pintar entera.
 * 2. `loadDetailAdornos`: enriquecimiento, metadatos y relaciones de AniList, ya
 *    con la fila escrita, y también en paralelo entre ellos.
 *
 * `cargarFicha` encadena los dos tiempos y devuelve las dos promesas: la pantalla
 * pinta el núcleo sin esperar a ningún tercero y los adornos llegan cuando
 * llegan. **Ningún adorno puede tumbar la ficha**: si falla, la ficha se queda
 * sin él en vez de en la pantalla de error.
 *
 * El tiempo límite es el de la ficha —20 s, el «timeout duro»— y no el de la
 * petición suelta: el proveedor puede contestar en 9 s y todavía estar dentro de
 * lo razonable. Lo aplica la pantalla al núcleo; cada adorno lleva además el suyo
 * por petición, porque una lectura de un tercero no puede dejar el reloj de la
 * ficha andando para siempre.
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

/** Lo que la ficha sabe sin preguntar a ningún tercero. Con esto ya se pinta. */
export interface DetailCore {
  readonly detail: AnimeDetail
  readonly related: readonly AnimeSummary[]
  readonly franchise: readonly AnimeSummary[]
  readonly sources: readonly AnimeSummary[]
  readonly watched: readonly WatchedEpisodePayload[]
  readonly capabilities: ProviderCapabilities | undefined
  readonly providerNames: ReadonlyMap<string, string>
}

/** Lo que añaden los terceros. Llega después del núcleo y no lo bloquea. */
export interface DetailAdornos {
  /** `null` es «no hay nada nuevo»; el fallo del tercero también cae aquí. */
  readonly enrichment: Enrichment | null
  readonly metadata: TmdbMetadata | null
  readonly anilistRelated: readonly AniListRelatedItem[]
}

/**
 * Lo que la caché guarda de una ficha.
 *
 * Los tres adornos son opcionales porque pueden no haberse preguntado todavía:
 * la entrada nace con el núcleo —es lo que permite pintar la ficha al instante
 * en la siguiente visita— y se completa cuando llegan. `undefined` es «no se ha
 * preguntado», que se pinta igual que `null` («no hay nada») pero no es lo mismo
 * para la caché: lo que no se preguntó no se da por sabido.
 */
export interface DetailBundle extends DetailCore {
  readonly enrichment?: Enrichment | null
  readonly metadata?: TmdbMetadata | null
  readonly anilistRelated?: readonly AniListRelatedItem[]
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

/** La base de las rutas de una ficha: proveedor y referencia, sin consulta. */
function baseDe(providerId: string, ref: string): string {
  return `/api/anime/${encodeURIComponent(providerId)}/${encodeURIComponent(ref)}`
}

/**
 * El primer tiempo: todo lo que la ficha sabe sin terceros.
 *
 * **El detalle va primero.** Relacionados, franquicia y fuentes leen la fila
 * local del anime para saber de qué obra hablan, y en una ficha que nadie abrió
 * todavía no hay fila hasta que el detalle responde: pedirlas en la misma tanda
 * las hacía contestar `[]`, y la primera apertura se quedaba sin rail de saga y
 * sin «también en» hasta recargar. Después del detalle las tres salen en
 * paralelo, que ya son lecturas locales de una fila que existe. Vistos y
 * proveedores no dependen de la fila y aprovechan la primera tanda.
 *
 * Lanza cuando falla la lectura principal o cualquiera de las que la ficha
 * necesita.
 */
export async function loadDetailCore(
  providerId: string,
  ref: string,
  options: DetailLoadOptions = {},
): Promise<DetailCore> {
  /*
    La consulta sólo viaja en la lectura del detalle: es la que el servidor anota
    como rastro de la búsqueda. Las subrutas —vistos, enriquecimiento, metadatos—
    se componen sobre la **base** y no sobre esa dirección: con la consulta dentro,
    el sufijo caía detrás del `?` y la ruta pedida dejaba de existir.
  */
  const base = baseDe(providerId, ref)
  const ruta = conLaConsulta(base, options.consulta)
  const deps = options.deps
  const opts = opciones(options)

  const [detalle, vistos, proveedores] = await Promise.all([
    apiGet(ruta, animeResponseSchema, opts, deps),
    apiGet(`${base}/watched`, watchedResponseSchema, opts, deps),
    apiGet('/api/providers', providersResponseSchema, opts, deps),
  ])

  const [hermanos, franquicia, fuentes] = await Promise.all([
    apiGet(relatedPath(providerId, ref), relatedResponseSchema, opts, deps),
    apiGet(relatedPath(providerId, ref, 'franchise'), relatedResponseSchema, opts, deps),
    apiGet(sourcesPath(providerId, ref), sourcesResponseSchema, opts, deps),
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
  }
}

/**
 * Las relaciones de AniList, aparte y sin bloquear.
 *
 * Su consulta al tercero está espaciada —una cada dos segundos—, así que la ficha
 * no la espera: la sección aparece cuando llega. Este cargador **sí lanza** para
 * que `loadDetailAdornos` pueda contar el fallo como lista vacía; un tercero
 * caído no es un fallo de esta pantalla.
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
 * El plazo de los adornos.
 *
 * `apiGet` no arma su propio tiempo límite cuando recibe una señal —la de la
 * pantalla manda, porque es la que decide cuándo se va—, así que el plazo del
 * adorno se compone aquí: la señal de la ficha, si la hay, y una cuenta propia
 * que empieza cuando se pide el adorno y no cuando se abrió la pantalla. Sin
 * esto, una consulta colgada a un tercero se quedaba sin cota: la pantalla ya
 * apagó su reloj al pintar el núcleo.
 */
function opcionesDeAdornos(options: DetailLoadOptions): { readonly signal: AbortSignal } {
  const plazo = AbortSignal.timeout(DETAIL_TIMEOUT_MS)

  return {
    signal: options.signal === undefined ? plazo : AbortSignal.any([options.signal, plazo]),
  }
}

/**
 * El segundo tiempo: lo que añaden los terceros a una ficha que ya está escrita.
 *
 * Va después del núcleo a propósito, y no es una preferencia de orden: las tres
 * rutas leen la fila local del anime para saber con qué obra emparejar. Con el
 * núcleo ya escrito, la ficha fría deja de quedarse sin banner y sin
 * relacionados. Las tres van en paralelo entre sí y **ninguna puede tumbar la
 * ficha**: un tercero caído se queda en «no hay nada nuevo».
 *
 * La de AniList es la más lenta (su consulta está espaciada) y por eso no
 * retrasa a las otras dos: van en la misma tanda, no en serie.
 */
export async function loadDetailAdornos(
  providerId: string,
  ref: string,
  options: DetailLoadOptions = {},
): Promise<DetailAdornos> {
  const base = baseDe(providerId, ref)
  const deps = options.deps
  const opts = opcionesDeAdornos(options)

  const [enriquecido, metadatos, relacionadas] = await Promise.all([
    // El enriquecimiento **no puede tumbar la ficha**: su fallo se queda en «no
    // hay nada nuevo».
    apiGet(`${base}/enrichment`, enrichmentResponseSchema, opts, deps).catch(() => ({
      enrichment: null,
    })),
    // Los metadatos de TMDB tampoco: sin clave la ruta ya devuelve `null`.
    apiGet(`${base}/metadata`, tmdbMetadataResponseSchema, opts, deps).catch(() => ({
      metadata: null,
    })),
    // Sin relaciones, sin emparejamiento o con AniList caído, lista vacía: la
    // sección no se pinta y la ficha sigue entera.
    loadAnilistRelated(providerId, ref, { ...options, signal: opts.signal }).catch(
      (): readonly AniListRelatedItem[] => [],
    ),
  ])

  return {
    enrichment: enriquecido.enrichment,
    metadata: metadatos.metadata,
    anilistRelated: relacionadas,
  }
}

/**
 * La carga de una ficha, con sus dos tiempos a la vista de quien pide.
 *
 * `nucleo` es «ya se puede pintar» y `adornos` es «llegó lo de los terceros».
 * Encadenarlas aquí y no en la pantalla tiene un motivo: la precarga y la ficha
 * comparten la carga, y con dos cadenas distintas una de las dos volvería a
 * pedir los adornos antes de tiempo —que es justo el fallo que esto arregla—.
 *
 * `adornos` se resuelve como `undefined` cuando el núcleo falló: no se pregunta
 * por lo accesorio de una ficha que no se pudo leer. Un fallo de los adornos no
 * se propaga: nunca rechaza.
 */
export interface CargaDeFicha {
  readonly nucleo: Promise<DetailCore>
  readonly adornos: Promise<DetailAdornos | undefined>
}

export function cargarFicha(
  providerId: string,
  ref: string,
  options: DetailLoadOptions = {},
): CargaDeFicha {
  const nucleo = loadDetailCore(providerId, ref, options)
  const adornos = nucleo
    .then(
      () => loadDetailAdornos(providerId, ref, options),
      () => undefined,
    )
    // Un adorno que rechaza sin nadie escuchando sale por consola como rechazo
    // no gestionado y parece un fallo de la aplicación; y la ficha ya está
    // pintada, así que tampoco hay a quién avisar.
    .catch(() => undefined)

  return { nucleo, adornos }
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
