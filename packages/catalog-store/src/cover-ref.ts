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
 * —búsquedas, tendencias y novedades— comparten forma, así que una sola consulta
 * con `UNION ALL` sirve para los tres.
 *
 * La lectura se hace con `json_each` **dentro de SQLite**: se recorren los
 * listados del proveedor y se cruza la referencia pedida sin materializar ni
 * parsear cada `results_json` en JS. La fila de novedades es la que más depende
 * de esto: es la única de la home que sale entera de un listado, sin detalle
 * cacheado detrás, y sin esta vía se pintaba de huecos.
 *
 * Las filas ilegibles se saltan en lugar de lanzar (`json_valid`), y la URL que
 * sale se valida otra vez con `httpUrlSchema`: la caché guarda lo que devolvió el
 * proveedor, no una dirección que se pueda servir sin mirar.
 */

import type { Database } from 'bun:sqlite'
import { httpUrlSchema, type ProviderRef } from '@rona/core'

/**
 * Los listados cacheados de un proveedor, filtrados **en SQL**.
 *
 * Antes se leían todas las filas del proveedor y se parseaba cada `results_json`
 * con Zod en JS: una página de 24 tarjetas podía recorrer cientos de miles de
 * entradas. Aquí `json_each` recorre el array dentro de SQLite y sólo cruza la
 * portada de la referencia pedida.
 */
const LISTADOS = `
  SELECT json_extract(je.value, '$.coverUrl') AS cover_url
    FROM search_cache sc, json_each(sc.results_json) je
   WHERE sc.provider_id = ?
     AND json_valid(sc.results_json)
     AND json_extract(je.value, '$.ref.value') = ?
     AND json_extract(je.value, '$.coverUrl') IS NOT NULL
  UNION ALL
  SELECT json_extract(je.value, '$.coverUrl') AS cover_url
    FROM trending_cache tc, json_each(tc.results_json) je
   WHERE tc.provider_id = ?
     AND json_valid(tc.results_json)
     AND json_extract(je.value, '$.ref.value') = ?
     AND json_extract(je.value, '$.coverUrl') IS NOT NULL
  UNION ALL
  SELECT json_extract(je.value, '$.coverUrl') AS cover_url
    FROM feed_cache fc, json_each(fc.results_json) je
   WHERE fc.provider_id = ?
     AND json_valid(fc.results_json)
     AND json_extract(je.value, '$.ref.value') = ?
     AND json_extract(je.value, '$.coverUrl') IS NOT NULL
  LIMIT 1
`

interface FilaPortada {
  readonly cover_url: string | null
}

export function findCoverUrl(db: Database, ref: ProviderRef): string | undefined {
  const fila = db
    .query<FilaPortada, [string, string, string, string, string, string]>(LISTADOS)
    .get(ref.providerId, ref.value, ref.providerId, ref.value, ref.providerId, ref.value)

  if (fila?.cover_url == null) return undefined

  // La caché guarda lo que devolvió el proveedor; antes de servir la dirección
  // se vuelve a validar el esquema. Un JSON manipulado no convierte la ruta de
  // portadas en un proxy hacia `javascript:` o `file:`.
  const parsed = httpUrlSchema.safeParse(fila.cover_url)
  return parsed.success ? parsed.data : undefined
}
