/**
 * Lo último que la aplicación ya conoce.
 *
 * Une dos tablas que guardan lo mismo desde sitios distintos: `anime` tiene los
 * títulos cuyo detalle se pidió —los que alguien abrió— y `known_title` los que
 * aparecieron en un listado cacheado —búsqueda, tendencias o novedades—, aunque
 * nadie los abriera. Para quien lee la página son la misma cosa, y separarlos en
 * dos filas le pediría que entendiera la diferencia entre una tabla y otra.
 *
 * Vive en su propio módulo y no dentro de `anime.ts` porque **no es una lectura
 * de una tabla**: cruza `anime` y `known_title`, y meterla en el repositorio del
 * anime obligaría a ese módulo a saber cómo está guardado un listado.
 *
 * Tres decisiones que se ven en el SQL:
 *
 * 1. **Una entrada por referencia, con la marca más nueva.** El mismo título puede
 *    estar en las dos tablas, y la que interesa es la última vez que se supo de
 *    él. Con `MAX(fetched_at)` y `GROUP BY`, la deduplicación la hace SQLite.
 * 2. **Una búsqueda caducada cuenta igual.** Esta lectura no dice «lo fresco»,
 *    dice «lo que la aplicación conoce»: esconder lo que ya está en disco sería
 *    lo contrario de lo que la fila existe para hacer.
 * 3. **La caché no se recorre.** `known_title` resume las tres cachés en una fila
 *    por referencia desde que se escriben, en su misma transacción
 *    (`recordKnownTitles`). Antes esta consulta recorría `search_cache` entera con
 *    `json_each`: dentro de un array JSON no hay índice posible, y el coste
 *    crecía con el número de búsquedas aunque la fila sólo pinte seis tarjetas.
 *
 * Lo que **no** hace es romperse por una fila mala: `anime` puede tener un
 * `raw_json` que no sea JSON y `json_extract` devolvería la fila sin `kind`; las
 * filas sin título ni referencia se descartan, que es lo que un resultado con
 * otra forma produce. `known_title` no las admite: `recordKnownTitles` no apunta
 * una entrada sin referencia o sin título, así que el descarte se hizo al
 * escribir y la lectura sólo repite el filtro por si la tabla cambió de manos.
 */

import type { Database } from 'bun:sqlite'
import type { AnimeSummary } from '@rona/core'
import { clasificacionDeColumnas } from './clasificacion'

interface RecentRow {
  readonly provider_id: string
  readonly provider_ref: string
  readonly title: string
  readonly cover_url: string | null
  readonly year: number | null
  readonly kind: string | null
  readonly family: string | null
  readonly format: string | null
}

export interface RecentRepository {
  list(limit: number): readonly AnimeSummary[]
}

/**
 * La lectura, exportada para que la prueba mire el plan de ejecución.
 *
 * Se lee `known_title` y no `search_cache`: la tabla es el resumen que dejan las
 * tres cachés al escribirse, con una fila por referencia y una columna por campo,
 * así que la consulta no parsea ningún JSON ni su coste crece con las búsquedas.
 *
 * El `UNION ALL` —y no `UNION`— es a propósito: la deduplicación la hace el
 * `GROUP BY`, que además se queda con la marca más nueva y con los datos de esa
 * fila. Con `UNION`, SQLite compararía filas enteras y dos listados del mismo
 * título con fechas distintas seguirían siendo dos.
 */
export const ULTIMOS = `
  WITH conocidos AS (
    SELECT a.provider_id        AS provider_id,
           a.provider_ref       AS provider_ref,
           a.title              AS title,
           a.cover_url          AS cover_url,
           a.year               AS year,
           json_extract(a.raw_json, '$.kind')   AS kind,
           json_extract(a.raw_json, '$.family') AS family,
           json_extract(a.raw_json, '$.format') AS format,
           a.fetched_at         AS fetched_at
      FROM anime a

    UNION ALL

    SELECT provider_id,
           provider_ref,
           title,
           cover_url,
           year,
           kind,
           -- known_title es el resumen de las cachés y no guarda el detalle:
           -- estos dos se omiten y la fila cae a la regla heredada, que es lo
           -- mismo que hace una ficha abierta antes del contrato nuevo.
           NULL AS family,
           NULL AS format,
           updated_at AS fetched_at
      FROM known_title
  )
  SELECT provider_id,
         provider_ref,
         title,
         cover_url,
         year,
         kind,
         family,
         format,
         MAX(fetched_at) AS fetched_at
    FROM conocidos
   WHERE provider_id IS NOT NULL
     AND provider_ref IS NOT NULL
     AND title IS NOT NULL
   GROUP BY provider_id, provider_ref
   ORDER BY fetched_at DESC
   LIMIT ?`

export function createRecentRepository(db: Database): RecentRepository {
  const select = db.query<RecentRow, [number]>(ULTIMOS)

  return {
    list(limit) {
      if (limit <= 0) return []

      return select.all(limit).map((fila) => ({
        ref: { providerId: fila.provider_id, value: fila.provider_ref },
        title: fila.title,
        ...(fila.cover_url === null ? {} : { coverUrl: fila.cover_url }),
        ...(fila.year === null ? {} : { year: fila.year }),
        ...clasificacionDeColumnas({
          kind: fila.kind,
          family: fila.family,
          format: fila.format,
        }),
      }))
    },
  }
}
