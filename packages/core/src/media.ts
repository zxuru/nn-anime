/**
 * Cómo se reparte el catálogo: una sola partición, el **formato**.
 *
 * T372 retiró la familia de contenido (`anime` / `animation` / `live`): la
 * aplicación sirve anime y películas de anime, así que el eje que separaba
 * animación occidental e imagen real no tenía nada que separar.
 *
 * La regla vive aquí una sola vez porque la usan el servidor —para filtrar lo
 * que pide a las fuentes—, el motor de recomendaciones y la interfaz. Con dos
 * copias, la misma obra caería en una lista u otra según quién hubiera filtrado.
 */

import type { z } from 'zod'
import type { MediaFormat, MediaType, TitleKind } from './models'
import type { providerMediaSchema } from './schema'

/**
 * El vocabulario heredado de `capabilities.media`.
 *
 * **Se acepta y no se lee.** Formaba parte del eje de familias y T372 lo retiró;
 * un manifiesto que todavía lo declare tiene que cargar sin romper el arranque,
 * así que el schema lo admite y el loader avisa. Ningún filtro lo consulta.
 */
export type ProviderMedia = z.infer<typeof providerMediaSchema>

/** Lo que se pide a una lectura: un formato. Sin él se piden los dos. */
export interface MediaFilter {
  readonly format?: MediaFormat | undefined
}

/**
 * Lo mínimo para clasificar un título.
 *
 * Es un subconjunto de `SearchResult`, `AnimeSummary` y `Candidate`: los campos
 * que la fuente puede declarar y el que la regla sabe leer en su lugar.
 */
export interface Clasificable {
  readonly format?: MediaFormat | undefined
  readonly mediaType?: MediaType | undefined
  readonly kind?: TitleKind | undefined
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
 * Si un título entra en lo pedido.
 *
 * El manga se descarta siempre: no es una lista de vídeo y su soporte tiene su
 * propia fase. Sin formato pedido entran los dos.
 */
export function pasaElFiltro(filtro: MediaFilter, item: Clasificable): boolean {
  if (item.mediaType === 'manga') return false

  return filtro.format === undefined || formatOf(item) === filtro.format
}
