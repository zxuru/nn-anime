/**
 * Lo que se pide por la dirección y a quién se le pregunta.
 *
 * Queda **un solo eje**: el formato (`series` / `movie`). T372 retiró la familia
 * de contenido, y los parámetros `family` y `media` se siguen aceptando —un
 * enlace guardado no puede dar 400— pero se ignoran.
 *
 * Vive aparte de las rutas porque las lecturas lo comparten y la regla tiene que
 * ser la misma en todas: una lista que filtrara distinto en una fila que en otra
 * se leería como un fallo de la aplicación, no como dos listas.
 *
 * Los parámetros son opcionales y aditivos: sin ellos la respuesta es la de
 * siempre.
 */

import {
  type MediaFilter,
  type MediaFormat,
  type MediaType,
  mediaFormatSchema,
  type ProviderRef,
  pasaElFiltro,
  type TitleKind,
} from '@rona/core'

/** Lo que trae la consulta, tal cual. Cada ruta lee sus parámetros. */
export interface ConsultaDeMedia {
  /** Retirado en T372: se acepta y se ignora. */
  readonly family?: string | undefined
  readonly format?: string | undefined
  /** Retirado en T372: se acepta y se ignora. */
  readonly media?: string | undefined
}

/**
 * El filtro pedido, o el motivo de que no se pueda servir.
 *
 * `ok: false` no es un valor por defecto silencioso: un `?format=miniserie` es
 * una petición mal escrita —el vocabulario es cerrado— y devolver todo sin decir
 * nada haría que el filtro pareciera roto desde la interfaz.
 */
export type FiltroPedido =
  | { readonly ok: true; readonly filtro: MediaFilter }
  | { readonly ok: false; readonly error: string }

type FormatoPedido =
  | { readonly ok: true; readonly format: MediaFormat | undefined }
  | { readonly ok: false; readonly error: string }

function formatoPedido(raw: string | undefined): FormatoPedido {
  const format = raw?.trim() ?? ''
  if (format === '') return { ok: true, format: undefined }

  const parsed = mediaFormatSchema.safeParse(format)
  if (!parsed.success) {
    return { ok: false, error: `formato inválido: «${format}»; se esperaba series o movie` }
  }

  return { ok: true, format: parsed.data }
}

/**
 * El filtro del formato.
 *
 * `family` y `media` no se miran: T372 retiró el eje que los leía. Se aceptan en
 * la firma para que una dirección vieja siga abriendo la misma pantalla en vez de
 * responder 400.
 */
export function filtroFrom(consulta: ConsultaDeMedia): FiltroPedido {
  const formato = formatoPedido(consulta.format)
  if (!formato.ok) return formato

  return {
    ok: true,
    filtro: formato.format === undefined ? {} : { format: formato.format },
  }
}

/** Un título de una lista, con lo que hace falta para repartirlo. */
export interface ConTipo {
  readonly ref: ProviderRef
  readonly kind?: TitleKind | undefined
  readonly format?: MediaFormat | undefined
  readonly mediaType?: MediaType | undefined
}

/** Si un título entra en el filtro. */
export function pasaElFiltroDeProveedor<T extends ConTipo>(filtro: MediaFilter, item: T): boolean {
  return pasaElFiltro(filtro, item)
}

/** Los títulos que entran en el filtro. */
export function enFiltro<T extends ConTipo>(
  items: readonly T[],
  filtro: MediaFilter,
): readonly T[] {
  return items.filter((item) => pasaElFiltro(filtro, item))
}
