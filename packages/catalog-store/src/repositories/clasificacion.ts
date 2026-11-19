/**
 * La clasificación de un título guardado: formato y tipo de la fuente.
 *
 * Los dos viven en `raw_json` —el detalle entero que dejó el proveedor— y no en
 * columnas, así que cinco lecturas del almacén los sacaban cada una a su manera
 * —o no los sacaban—. Con la copia, el día que la regla cambie una lectura se
 * quedaría atrás y la misma obra caería en una lista u otra según por dónde se
 * llegara.
 *
 * T372 retiró la familia de contenido: una fila vieja puede traerla y se ignora.
 *
 * Se valida antes de devolverlo: la base guarda lo que le den, y un valor
 * inventado no puede viajar a la interfaz como si fuera del vocabulario. Lo que
 * no encaja se omite, que es como una fila vieja cae a la regla heredada.
 */

import { type MediaFormat, mediaFormatSchema, type TitleKind, titleKindSchema } from '@rona/core'

/** Los dos campos que reparten un título en el filtro. */
export interface Clasificacion {
  readonly kind?: TitleKind | undefined
  readonly format?: MediaFormat | undefined
}

function deValores(valores: { readonly kind?: unknown; readonly format?: unknown }): Clasificacion {
  const kind = titleKindSchema.safeParse(valores.kind)
  const format = mediaFormatSchema.safeParse(valores.format)

  return {
    ...(kind.success ? { kind: kind.data } : {}),
    ...(format.success ? { format: format.data } : {}),
  }
}

/**
 * La clasificación de un `raw_json` completo.
 *
 * Un JSON roto o sin los campos no es un error: es una fila vieja, y devuelve lo
 * que se pueda leer —posiblemente nada— para que la lectura siga.
 */
export function clasificacionDe(raw: string | null): Clasificacion {
  if (raw === null) return {}

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}

    return deValores({
      kind: Reflect.get(parsed, 'kind'),
      format: Reflect.get(parsed, 'format'),
    })
  } catch {
    return {}
  }
}

/**
 * La clasificación de las columnas que extrajo `json_extract`.
 *
 * Es el mismo contrato que `clasificacionDe` y por eso pasa por la misma
 * validación: la consulta puede traer `NULL` —una fila de `known_title`, que no
 * guarda el detalle— y entonces el campo se omite.
 */
export function clasificacionDeColumnas(valores: {
  readonly kind?: unknown
  readonly format?: unknown
}): Clasificacion {
  return deValores(valores)
}
