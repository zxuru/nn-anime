/**
 * El tipo de contenido que se pide por la dirección, y el filtro que sale de él.
 *
 * Vive aparte de las rutas porque cuatro lo comparten —tendencias, novedades,
 * último añadido y recomendaciones— y la regla tiene que ser la misma en las
 * cuatro: una pestaña que filtrara distinto en una fila que en otra se leería como
 * un fallo de la aplicación, no como dos listas.
 *
 * El parámetro es **opcional y aditivo**: sin él la respuesta es la de siempre,
 * que es lo que mantiene funcionando a quien ya la pedía sin conocerlo.
 */

import {
  DEFAULT_MEDIA,
  mediaOf,
  type ProviderMedia,
  type ProviderRef,
  pasaElFiltro,
  providerMediaSchema,
  type TitleKind,
} from '@nn-anime/core'
import type { Provider } from '@nn-anime/provider-sdk'

/**
 * Lo que pedía la dirección.
 *
 * `ok: false` no es un valor por defecto silencioso: un `?media=anime-y-peliculas`
 * es una petición mal escrita —el vocabulario es cerrado— y devolver todo sin
 * decir nada haría que el filtro pareciera roto desde la interfaz.
 */
export type MediaPedida =
  | { readonly ok: true; readonly media: ProviderMedia | undefined }
  | { readonly ok: false; readonly error: string }

export function mediaFrom(raw: string | undefined): MediaPedida {
  if (raw === undefined || raw === '') return { ok: true, media: undefined }

  const parsed = providerMediaSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: `tipo inválido: «${raw}»; se esperaba anime, movies o both` }
  }

  return { ok: true, media: parsed.data }
}

/** La media declarada por cada proveedor cargado, por su id. */
export function mediaPorProveedor(
  providers: readonly Provider[],
): ReadonlyMap<string, ProviderMedia> {
  return new Map(providers.map((provider) => [provider.id, mediaOf(provider.capabilities)]))
}

/** Un título de una lista, con lo que hace falta para repartirlo. */
export interface ConTipo {
  readonly ref: ProviderRef
  readonly kind?: TitleKind | undefined
}

/**
 * Los títulos que entran en el tipo pedido, por la media de su fuente.
 *
 * Se usa para lo que ya está en la base —«último añadido» y los candidatos del
 * motor—, que no viene de un proveedor concreto en el momento de leerlo: la fuente
 * del título es la que dice de qué es. Una referencia de una fuente que ya no está
 * instalada cuenta como anime, que es el defecto del contrato.
 */
export function enMedia<T extends ConTipo>(
  items: readonly T[],
  media: ProviderMedia | undefined,
  medias: ReadonlyMap<string, ProviderMedia>,
): readonly T[] {
  return items.filter((item) =>
    pasaElFiltro(media, medias.get(item.ref.providerId) ?? DEFAULT_MEDIA, item.kind),
  )
}
