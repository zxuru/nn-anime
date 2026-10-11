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
 * devolvió, que es la misma condición que exige el spec. Las dos cachés de
 * listados comparten forma —`provider_id` y `results_json` con `SearchResult[]`—,
 * así que una sola consulta con `UNION ALL` sirve para las dos.
 *
 * Las filas ilegibles se saltan en lugar de lanzar: una caché de búsqueda rota no
 * puede tumbar la portada de otra consulta, que es lo que haría leerla con
 * `readSearch`.
 */

import type { Database } from 'bun:sqlite'
import { type ProviderRef, searchResultSchema } from '@nn-anime/core'

/** Los listados cacheados de un proveedor: búsquedas y tendencias. */
const LISTADOS = `
  SELECT results_json FROM search_cache WHERE provider_id = ?
  UNION ALL
  SELECT results_json FROM trending_cache WHERE provider_id = ?
`

interface FilaListado {
  readonly results_json: string
}

/** La portada de una referencia dentro de un listado, o nada si no está. */
function portadaEn(resultsJson: string, ref: string): string | undefined {
  try {
    const parsed = searchResultSchema.array().safeParse(JSON.parse(resultsJson))
    if (!parsed.success) return undefined

    for (const item of parsed.data) {
      if (item.ref.value !== ref) continue
      if (item.coverUrl !== undefined) return item.coverUrl
    }

    return undefined
  } catch {
    // JSON roto: esta fila no sirve, la siguiente quizá sí.
    return undefined
  }
}

export function findCoverUrl(db: Database, ref: ProviderRef): string | undefined {
  const filas = db
    .query<FilaListado, [string, string]>(LISTADOS)
    .all(ref.providerId, ref.providerId)

  for (const fila of filas) {
    const portada = portadaEn(fila.results_json, ref.value)
    if (portada !== undefined) return portada
  }

  return undefined
}
