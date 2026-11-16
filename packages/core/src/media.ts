/**
 * Qué sirve un proveedor y a qué familia y formato pertenece un título.
 *
 * Son dos ejes y no uno: la **familia** dice de qué está hecha la obra —anime,
 * animación que no es anime o imagen real— y el **formato** cómo está contada
 * —serie o película—. La partición vieja («anime» contra «películas») mezclaba
 * los dos: una película de anime no tenía sitio y una serie de imagen real caía
 * del lado del anime.
 *
 * La regla vive aquí una sola vez porque la usan el servidor —para filtrar lo que
 * pide a las fuentes—, el motor de recomendaciones y la interfaz. Con dos copias,
 * la misma obra caería en una pestaña u otra según quién hubiera filtrado.
 */

import type { z } from 'zod'
import type { MediaFamily, MediaFormat, MediaType, ProviderCapabilities, TitleKind } from './models'
import type { providerMediaSchema } from './schema'

export type ProviderMedia = z.infer<typeof providerMediaSchema>

/**
 * Lo que sirve un proveedor que no lo declara.
 *
 * Es `anime` y no `both` a propósito: los plugins que ya existen son de anime, y
 * un defecto que los metiera en las dos pestañas llenaría la de películas de
 * títulos que no lo son. Un plugin que sirva otra cosa lo dice.
 */
export const DEFAULT_MEDIA: ProviderMedia = 'anime'

/**
 * Lo que se pide a una lectura: un conjunto de familias y un formato.
 *
 * Los dos ejes son ortogonales y los dos son opcionales: sin familias se piden
 * todas y sin formato se piden los dos. Un array vacío de familias no pide nada
 * —no es lo mismo que no pedir—, y el filtro de formato es un valor, no un
 * conjunto: una obra es una serie o una película.
 */
export interface MediaFilter {
  readonly families?: readonly MediaFamily[] | undefined
  readonly format?: MediaFormat | undefined
}

/**
 * Lo mínimo para clasificar un título.
 *
 * Es un subconjunto de `SearchResult`, `AnimeSummary` y `Candidate`: los campos
 * que la fuente puede declarar y los dos que la regla sabe leer en su lugar.
 */
export interface Clasificable {
  readonly family?: MediaFamily | undefined
  readonly format?: MediaFormat | undefined
  readonly mediaType?: MediaType | undefined
  readonly kind?: TitleKind | undefined
}

const FAMILIES_ANIME: readonly MediaFamily[] = ['anime']
const FAMILIES_NO_ANIME: readonly MediaFamily[] = ['animation', 'live']
const FAMILIES_TODAS: readonly MediaFamily[] = ['anime', 'animation', 'live']

/** Lo que declara un proveedor, con el defecto aplicado. */
export function mediaOf(capabilities: Pick<ProviderCapabilities, 'media'>): ProviderMedia {
  return capabilities.media ?? DEFAULT_MEDIA
}

/**
 * Las familias que sirve un proveedor.
 *
 * `families` gana cuando está: es la declaración nueva y `media` es el legado. El
 * mapeo del legado es el que conserva el comportamiento publicado: `movies`
 * significa «todo lo que no es anime» y por eso son dos familias, no una.
 */
export function familiesOf(
  capabilities: Pick<ProviderCapabilities, 'media' | 'families'>,
): readonly MediaFamily[] {
  if (capabilities.families !== undefined) return capabilities.families

  const media = capabilities.media ?? DEFAULT_MEDIA
  if (media === 'movies') return FAMILIES_NO_ANIME
  if (media === 'both') return FAMILIES_TODAS

  return FAMILIES_ANIME
}

/**
 * La familia de un título, con la precedencia del contrato.
 *
 * Primero lo declarado por título; después la compatibilidad con `mediaType`; y
 * sólo cuando no hay dato, lo que sirve el proveedor y el `kind`. Declarada la
 * familia, el formato no la mueve: una película de anime es anime.
 *
 * La penúltima fila es la regla vieja generalizada: en una fuente que sirve varias
 * familias y no clasifica sus títulos, un `movie` cae en imagen real —o en
 * animación, si no hay— y cualquier otro `kind` en anime. Un proveedor mixto que
 * no clasifique sigue comportándose como hoy; lo que cambia es que ahora puede
 * clasificar.
 *
 * `manga` no tiene pestaña de vídeo y esta función no puede decir «ninguna»: cae
 * en la respuesta del conjunto, y quien de verdad lo descarta es `pasaElFiltro`,
 * que lo mira antes. Se conserva el `mediaType` en el dato.
 */
export function familyOf(item: Clasificable, familias: readonly MediaFamily[]): MediaFamily {
  if (item.family !== undefined) return item.family
  if (item.mediaType === 'anime') return 'anime'

  return familiaPorElConjunto(item.kind, familias)
}

function familiaPorElConjunto(
  kind: TitleKind | undefined,
  familias: readonly MediaFamily[],
): MediaFamily {
  // Sin proveedor —una fila huérfana— es anime, el mismo defecto que `media`.
  const primera = familias[0]
  if (primera === undefined) return 'anime'
  if (familias.length === 1) return primera

  if (kind === 'movie') {
    if (familias.includes('live')) return 'live'
    if (familias.includes('animation')) return 'animation'

    return 'anime'
  }

  if (familias.includes('anime')) return 'anime'
  if (familias.includes('animation')) return 'animation'

  return 'live'
}

/**
 * El formato de un título, con la precedencia del contrato.
 *
 * `mediaType` gana a `kind` porque es la declaración de la aplicación y `kind` es
 * la etiqueta del proveedor. `ova`, `ona` y `special` son series a los efectos de
 * la navegación: un OVA no es una película y nadie pide «sólo OVAs». Sin nada,
 * `series`: un título sin formato no es una película.
 */
export function formatOf(item: Clasificable): MediaFormat {
  if (item.format !== undefined) return item.format
  if (item.mediaType === 'movie') return 'movie'
  if (item.mediaType === 'series' || item.mediaType === 'anime') return 'series'
  // El manga no tiene formato de vídeo; `series` es la lectura que no afirma que
  // sea una película. `pasaElFiltro` lo descarta antes de preguntar.
  if (item.mediaType === 'manga') return 'series'
  if (item.kind === 'movie') return 'movie'

  return 'series'
}

/**
 * Si una familia entra en el conjunto pedido.
 *
 * Sin filtro entran todas. Un conjunto vacío no admite ninguna: es una petición
 * que no pide nada, no la ausencia de petición.
 */
export function esDeFamilia(
  filtro: readonly MediaFamily[] | undefined,
  familia: MediaFamily,
): boolean {
  return filtro === undefined || filtro.includes(familia)
}

/**
 * Si merece la pena preguntarle a un proveedor por esas familias.
 *
 * Es distinto de `esDeFamilia`, y la diferencia importa: a una fuente que sirve
 * varias familias **hay que preguntarle** aunque el filtro pida una, y sólo
 * después se sabe cuáles de sus títulos lo son. Descartarla por proveedor dejaría
 * la pestaña vacía sin haber preguntado. Basta con que una familia del filtro
 * esté entre las que sirve.
 */
export function puedeServirFamilia(
  filtro: readonly MediaFamily[] | undefined,
  familias: readonly MediaFamily[],
): boolean {
  return filtro === undefined || filtro.some((familia) => familias.includes(familia))
}

/**
 * Si un título entra en lo pedido, con los dos ejes.
 *
 * `familias` son las del proveedor, porque sin dato por título la familia se
 * deduce de ellas. El manga se descarta siempre: no es una pestaña de vídeo y su
 * soporte tiene su propia fase.
 */
export function pasaElFiltro(
  filtro: MediaFilter,
  item: Clasificable,
  familias: readonly MediaFamily[],
): boolean {
  if (item.mediaType === 'manga') return false
  if (!esDeFamilia(filtro.families, familyOf(item, familias))) return false

  return filtro.format === undefined || formatOf(item) === filtro.format
}

/*
 * Lo de abajo es la mitad vieja, la que parte el catálogo en «anime» y «lo que no
 * es anime». Se conserva porque el servidor y la interfaz publicados la usan y
 * retirarla es la fase 3, no ésta; no se le añade nada nuevo.
 */

/**
 * La mitad pedida por la interfaz de dos pestañas.
 *
 * `movies` no es un formato: es «todo lo que no es anime». Vive aquí sólo para que
 * los consumidores actuales compilen; la fase 3 los pasa a `MediaFilter`.
 */
export type MediaHalf = 'anime' | 'movies'

/**
 * Qué es un título para la partición vieja, a partir de la fuente y del `kind`.
 *
 * Se conserva tal cual, con su comportamiento: `mediaTypeOf` deduce una cosa de la
 * otra, y por eso la sustituyen `familyOf` y `formatOf`. No se usa en la regla
 * nueva.
 */
export function mediaTypeOf(
  item: { readonly kind?: TitleKind; readonly mediaType?: MediaType },
  proveedor: ProviderMedia,
): MediaType {
  if (item.mediaType !== undefined) return item.mediaType

  if (proveedor === 'movies') return item.kind === 'movie' ? 'movie' : 'series'

  // `both` reparte por el `kind`, y lo que no es película sigue siendo anime: es
  // la compatibilidad con las fuentes mixtas que ya existen.
  if (proveedor === 'both') return item.kind === 'movie' ? 'movie' : 'anime'

  return 'anime'
}

/** Si un título entra en la mitad pedida, con la regla vieja. */
export function esDeMedia(
  filtro: MediaHalf,
  proveedor: ProviderMedia,
  kind: TitleKind | undefined,
  mediaType?: MediaType,
): boolean {
  const tipo = mediaType ?? mediaTypeOf({ ...(kind === undefined ? {} : { kind }) }, proveedor)

  return filtro === 'movies' ? tipo === 'movie' || tipo === 'series' : tipo === 'anime'
}

/** Si merece la pena preguntarle a un proveedor por esa mitad. */
export function puedeServir(filtro: ProviderMedia | undefined, proveedor: ProviderMedia): boolean {
  if (filtro === undefined || filtro === 'both') return true

  return proveedor === 'both' || proveedor === filtro
}

/**
 * Si un título entra en lo pedido, con la mitad vieja y admitiendo que no se pida
 * nada.
 *
 * `both` y la ausencia significan lo mismo —traer lo que haya— y se admiten los
 * dos: uno es «no lo he pedido», que es lo que manda un cliente que no conoce el
 * parámetro, y el otro «lo quiero entero», que es lo que sirve una fuente mixta.
 */
export function pasaElFiltroDeMedia(
  filtro: ProviderMedia | undefined,
  proveedor: ProviderMedia,
  kind: TitleKind | undefined,
  mediaType?: MediaType,
): boolean {
  if (filtro === undefined || filtro === 'both') return true

  return esDeMedia(filtro, proveedor, kind, mediaType)
}
