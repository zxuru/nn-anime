/**
 * La portada de una referencia, tomada de un listado ya cacheado.
 *
 * La ruta de portadas sirve la de un título que ya se conoce, y hasta ahora sólo
 * contaba como «conocido» el detalle escrito en `anime`. Un resultado de búsqueda
 * también conoce el título —su `SearchResult` trae `coverUrl`—, pero se guardaba
 * sólo en `search_cache`, así que las tarjetas de la búsqueda pedían una portada
 * que la ruta contestaba con 404 hasta que alguien abría la ficha. En la
 * práctica: ninguna imagen en los resultados de búsqueda ni en las tendencias.
 *
 * Esto **no** descubre portadas: lee la URL de la lista que el proveedor ya
 * devolvió, que es la misma condición que exige el spec. Los listados cacheados
 * —búsquedas, tendencias y novedades— comparten forma, y la migración `0021`
 * crea `known_cover`; el `write` de cada caché la mantiene al día en su misma
 * transacción (`recordKnownTitles`).
 *
 * La consulta es una búsqueda por clave primaria, no un recorrido: la versión
 * anterior leía los listados del proveedor y cruzaba el array con `json_each`,
 * que con 10 000 búsquedas costaba 284 ms por portada. La fila de novedades es la
 * que más depende de esto: es la única de la home que sale entera de un listado,
 * sin detalle cacheado detrás, y sin esta vía se pintaba de huecos.
 *
 * Las filas ilegibles se saltan al escribir la caché (`json_valid`), y la URL que
 * sale se valida otra vez con `httpUrlSchema`: la tabla guarda lo que devolvió el
 * proveedor, no una dirección que se pueda servir sin mirar.
 */

import type { Database } from 'bun:sqlite'
import { httpUrlSchema, type ProviderRef } from '@rona/core'

/**
 * La portada de una referencia.
 *
 * Una sola fila por la clave primaria: lo que antes era un `UNION ALL` de tres
 * recorridos JSON es ahora un `WHERE` indexado.
 */
const LISTADOS = `
  SELECT url AS cover_url
    FROM known_cover
   WHERE provider_id = ?
     AND provider_ref = ?
`

interface FilaPortada {
  readonly cover_url: string | null
}

export function findCoverUrl(db: Database, ref: ProviderRef): string | undefined {
  const fila = db.query<FilaPortada, [string, string]>(LISTADOS).get(ref.providerId, ref.value)

  if (fila?.cover_url == null) return undefined

  // La tabla guarda lo que devolvió el proveedor al escribir la caché; antes de
  // servir la dirección se vuelve a validar el esquema. Un listado manipulado no
  // convierte la ruta de portadas en un proxy hacia `javascript:` o `file:`.
  const parsed = httpUrlSchema.safeParse(fila.cover_url)
  return parsed.success ? parsed.data : undefined
}
