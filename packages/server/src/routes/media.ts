/**
 * Lo que se pide por la dirección y a quién se le pregunta.
 *
 * Dos ejes —la familia de contenido y el formato— y un alias viejo. Vive aparte
 * de las rutas porque las ocho lecturas lo comparten y la regla tiene que ser la
 * misma en todas: una pestaña que filtrara distinto en una fila que en otra se
 * leería como un fallo de la aplicación, no como dos listas.
 *
 * `media` se sigue aceptando como alias de la versión anterior y se traduce aquí,
 * una sola vez: `anime` es la familia de anime; `movies` era «todo lo que no es
 * anime», que son dos familias —animación y acción real—; y `both` es no filtrar.
 * El filtro de `family` gana cuando llega: es la declaración nueva.
 *
 * Los parámetros son opcionales y aditivos: sin ellos la respuesta es la de
 * siempre, que es lo que mantiene funcionando a quien ya los pedía sin conocerlos.
 */

import {
  familiesOf,
  type MediaFamily,
  type MediaFilter,
  type MediaFormat,
  type MediaType,
  mediaFamilySchema,
  mediaFormatSchema,
  type ProviderMedia,
  type ProviderRef,
  pasaElFiltro,
  providerMediaSchema,
  puedeServirFamilia,
  type TitleKind,
} from '@rona/core'
import type { Provider } from '@rona/provider-sdk'

/** Lo que trae la consulta, tal cual. Cada ruta lee sus parámetros. */
export interface ConsultaDeMedia {
  readonly family?: string | undefined
  readonly format?: string | undefined
  readonly media?: string | undefined
}

/**
 * El filtro pedido, o el motivo de que no se pueda servir.
 *
 * `ok: false` no es un valor por defecto silencioso: un `?family=anime-y-live` es
 * una petición mal escrita —el vocabulario es cerrado— y devolver todo sin decir
 * nada haría que el filtro pareciera roto desde la interfaz.
 */
export type FiltroPedido =
  | { readonly ok: true; readonly filtro: MediaFilter }
  | { readonly ok: false; readonly error: string }

type FamiliasPedidas =
  | { readonly ok: true; readonly familias: readonly MediaFamily[] | undefined }
  | { readonly ok: false; readonly error: string }

type FormatoPedido =
  | { readonly ok: true; readonly format: MediaFormat | undefined }
  | { readonly ok: false; readonly error: string }

/**
 * El alias de la versión anterior, traducido una sola vez.
 *
 * `media` sólo se mira cuando no hay `family`: la declaración nueva gana, y una
 * dirección con las dos no puede acabar sirviendo la mitad que no se pidió.
 */
export function familiasDeMedia(
  media: ProviderMedia | undefined,
): readonly MediaFamily[] | undefined {
  if (media === 'anime') return ['anime']
  if (media === 'movies') return ['animation', 'live']

  return undefined
}

function familiasPedidas(consulta: ConsultaDeMedia): FamiliasPedidas {
  const family = consulta.family?.trim() ?? ''
  if (family !== '') {
    const parsed = mediaFamilySchema.safeParse(family)
    if (!parsed.success) {
      return {
        ok: false,
        error: `familia inválida: «${family}»; se esperaba anime, animation o live`,
      }
    }

    return { ok: true, familias: [parsed.data] }
  }

  const media = consulta.media
  if (media === undefined || media === '') return { ok: true, familias: undefined }

  const parsed = providerMediaSchema.safeParse(media)
  if (!parsed.success) {
    return { ok: false, error: `tipo inválido: «${media}»; se esperaba anime, movies o both` }
  }

  return { ok: true, familias: familiasDeMedia(parsed.data) }
}

function formatoPedido(raw: string | undefined): FormatoPedido {
  const format = raw?.trim() ?? ''
  if (format === '') return { ok: true, format: undefined }

  const parsed = mediaFormatSchema.safeParse(format)
  if (!parsed.success) {
    return { ok: false, error: `formato inválido: «${format}»; se esperaba series o movie` }
  }

  return { ok: true, format: parsed.data }
}

/** El filtro de los dos ejes, con el alias `media` ya traducido. */
export function filtroFrom(consulta: ConsultaDeMedia): FiltroPedido {
  const familias = familiasPedidas(consulta)
  if (!familias.ok) return familias

  const formato = formatoPedido(consulta.format)
  if (!formato.ok) return formato

  return {
    ok: true,
    filtro: {
      ...(familias.familias === undefined ? {} : { families: familias.familias }),
      ...(formato.format === undefined ? {} : { format: formato.format }),
    },
  }
}

/** Las familias que sirve cada proveedor cargado, por su id. */
export function familiasPorProveedor(
  providers: readonly Provider[],
): ReadonlyMap<string, readonly MediaFamily[]> {
  return new Map(providers.map((provider) => [provider.id, familiesOf(provider.capabilities)]))
}

/**
 * Si merece la pena preguntarle a un proveedor por ese filtro.
 *
 * Es distinto de filtrar sus títulos, y la diferencia importa: a una fuente mixta
 * hay que preguntarle aunque se pida una familia, y sólo después se sabe cuáles
 * de sus títulos lo son. Descartarla antes dejaría la pestaña vacía sin haber
 * preguntado.
 */
export function puedeServirElFiltro(filtro: MediaFilter, provider: Provider): boolean {
  return puedeServirFamilia(filtro.families, familiesOf(provider.capabilities))
}

/** Si un título de esa fuente entra en el filtro, con las familias del proveedor. */
export function pasaElFiltroDeProveedor<T extends ConTipo>(
  filtro: MediaFilter,
  item: T,
  provider: Provider,
): boolean {
  return pasaElFiltro(filtro, item, familiesOf(provider.capabilities))
}

/** Un título de una lista, con lo que hace falta para repartirlo. */
export interface ConTipo {
  readonly ref: ProviderRef
  readonly kind?: TitleKind | undefined
  readonly family?: MediaFamily | undefined
  readonly format?: MediaFormat | undefined
  readonly mediaType?: MediaType | undefined
}

/**
 * Los títulos que entran en el filtro, con las familias de su fuente.
 *
 * Se usa con lo que ya está en la base —«último añadido» y los candidatos del
 * motor—, que no viene de un proveedor concreto en el momento de leerlo: la
 * fuente del título es la que dice de qué es. Una referencia de una fuente que ya
 * no está instalada cuenta como anime, que es el defecto del contrato.
 */
export function enFiltro<T extends ConTipo>(
  items: readonly T[],
  filtro: MediaFilter,
  familias: ReadonlyMap<string, readonly MediaFamily[]>,
): readonly T[] {
  // Sin proveedor —una fila huérfana— es anime, el mismo defecto que `DEFAULT_MEDIA`.
  return items.filter((item) =>
    pasaElFiltro(filtro, item, familias.get(item.ref.providerId) ?? ['anime']),
  )
}
