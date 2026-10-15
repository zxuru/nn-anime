/**
 * Qué sirve un proveedor y a qué mitad pertenece un título.
 *
 * Son dos decisiones, y las dos se toman en dos sitios: el servidor filtra lo que
 * le pide a las fuentes y la interfaz filtra lo que ya tiene en la mano. Con dos
 * copias de la regla, la misma obra caería en una pestaña u otra según quién
 * hubiera filtrado, así que vive aquí una sola vez.
 *
 * La partición es **anime contra lo demás** y no «anime contra películas» a
 * secas: las fuentes que no son de anime sirven películas, series y doramas por
 * el mismo camino, y para esta aplicación un dorama es una serie. Lo que decide
 * la fuente es su declaración (`media`), y dentro de una fuente que sirve las dos
 * cosas decide el `kind` del título.
 */

import type { z } from 'zod'
import type { ProviderCapabilities, TitleKind } from './models'
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

/** Lo que se puede pedir. «Las dos cosas» es lo que sirve una fuente, no un filtro. */
export type MediaFilter = 'anime' | 'movies'

/** Lo que declara un proveedor, con el defecto aplicado. */
export function mediaOf(capabilities: Pick<ProviderCapabilities, 'media'>): ProviderMedia {
  return capabilities.media ?? DEFAULT_MEDIA
}

/**
 * Si un título entra en la mitad pedida.
 *
 * Un proveedor de las dos cosas reparte por el `kind`, y ahí está la razón de que
 * el `kind` opcional del contrato se lea: sin él, todo lo que publica una fuente
 * mixta caería del lado del anime. Un título sin `kind` declarado cuenta como
 * anime, que es el mismo defecto que el proveedor sin `media`.
 */
export function esDeMedia(
  filtro: MediaFilter,
  proveedor: ProviderMedia,
  kind: TitleKind | undefined,
): boolean {
  if (proveedor === 'both') return (kind === 'movie') === (filtro === 'movies')

  return proveedor === filtro
}

/**
 * Si merece la pena preguntarle a un proveedor por esa mitad.
 *
 * Es distinto de `esDeMedia`, y la diferencia importa: a una fuente que sirve las
 * dos cosas **hay que preguntarle** por las películas, y sólo después se sabe
 * cuáles de sus títulos lo son. Descartarla por proveedor dejaría la pestaña vacía
 * sin haber preguntado.
 */
export function puedeServir(filtro: ProviderMedia | undefined, proveedor: ProviderMedia): boolean {
  if (filtro === undefined || filtro === 'both') return true

  return proveedor === 'both' || proveedor === filtro
}

/**
 * Si un título entra en lo pedido, admitiendo que no se pida nada.
 *
 * `both` y la ausencia significan lo mismo —traer lo que haya— y se admiten los
 * dos: uno es «no lo he pedido», que es lo que manda un cliente que no conoce el
 * parámetro, y el otro «lo quiero entero», que es lo que sirve una fuente mixta.
 * Rechazar `both` aquí obligaría a cada ruta a acordarse de traducirlo.
 */
export function pasaElFiltro(
  filtro: ProviderMedia | undefined,
  proveedor: ProviderMedia,
  kind: TitleKind | undefined,
): boolean {
  if (filtro === undefined || filtro === 'both') return true

  return esDeMedia(filtro, proveedor, kind)
}
