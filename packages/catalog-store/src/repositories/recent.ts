/**
 * Lo último que la aplicación ya conoce.
 *
 * Une dos tablas que guardan lo mismo desde sitios distintos: `anime` tiene los
 * títulos cuyo detalle se pidió —los que alguien abrió— y `search_cache` los que
 * aparecieron en una búsqueda, aunque nadie los abriera. Para quien lee la
 * página son la misma cosa, y separarlos en dos filas le pediría que entendiera
 * la diferencia entre una tabla y otra.
 *
 * Vive en su propio módulo y no dentro de `anime.ts` porque **no es una lectura
 * de una tabla**: cruza `anime` y `search_cache`, y meterla en el repositorio del
 * anime obligaría a ese módulo a saber cómo está guardada una búsqueda.
 *
 * Dos decisiones que se ven en el SQL:
 *
 * 1. **Una entrada por referencia, con la marca más nueva.** El mismo título puede
 *    estar en las dos tablas, y la que interesa es la última vez que se supo de
 *    él. Con `MAX(fetched_at)` y `GROUP BY`, la deduplicación la hace SQLite.
 * 2. **Una búsqueda caducada cuenta igual.** Esta lectura no dice «lo fresco»,
 *    dice «lo que la aplicación conoce»: esconder lo que ya está en disco sería
 *    lo contrario de lo que la fila existe para hacer.
 *
 * Lo que **no** hace es romperse por una fila mala: `json_valid` deja fuera un
 * `results_json` que no es JSON —`json_each` lanzaría— y las filas sin título ni
 * referencia se descartan, que es lo que un resultado con otra forma produce.
 */

import type { Database } from 'bun:sqlite'
import type { AnimeSummary, TitleKind } from '@nn-anime/core'
import { titleKindSchema } from '@nn-anime/core'

interface RecentRow {
  readonly provider_id: string
  readonly provider_ref: string
  readonly title: string
  readonly cover_url: string | null
  readonly year: number | null
  readonly kind: string | null
}

export interface RecentRepository {
  list(limit: number): readonly AnimeSummary[]
}

/**
 * `kind` se valida contra el schema: un valor que no es uno de los cinco del
 * contrato se descarta en vez de viajar a la interfaz como si lo fuera.
 *
 * Aquí hubo un `replace(/^"|"$/g, '')` que quitaba unas comillas del JSON. Se quitó
 * al medirlo: `json_extract` devuelve los escalares **sin** comillas —las pone sólo
 * para objetos y arrays—, así que ninguna mutación podía distinguirlo y era una
 * línea que no hacía nada.
 */
function kindOf(valor: string | null): TitleKind | undefined {
  const parsed = titleKindSchema.safeParse(valor)

  return parsed.success ? parsed.data : undefined
}

export function createRecentRepository(db: Database): RecentRepository {
  const select = db.query<RecentRow, [number]>(
    `WITH conocidos AS (
       SELECT a.provider_id        AS provider_id,
              a.provider_ref       AS provider_ref,
              a.title              AS title,
              a.cover_url          AS cover_url,
              a.year               AS year,
              json_extract(a.raw_json, '$.kind') AS kind,
              a.fetched_at         AS fetched_at
         FROM anime a

       UNION ALL

       SELECT sc.provider_id,
              json_extract(je.value, '$.ref.value'),
              json_extract(je.value, '$.title'),
              json_extract(je.value, '$.coverUrl'),
              json_extract(je.value, '$.year'),
              json_extract(je.value, '$.kind'),
              sc.fetched_at
         FROM search_cache sc, json_each(sc.results_json) je
        WHERE json_valid(sc.results_json)
     )
     SELECT provider_id,
            provider_ref,
            title,
            cover_url,
            year,
            kind,
            MAX(fetched_at) AS fetched_at
       FROM conocidos
      WHERE provider_id IS NOT NULL
        AND provider_ref IS NOT NULL
        AND title IS NOT NULL
      GROUP BY provider_id, provider_ref
      ORDER BY fetched_at DESC
      LIMIT ?`,
  )

  return {
    list(limit) {
      if (limit <= 0) return []

      return select.all(limit).map((fila) => ({
        ref: { providerId: fila.provider_id, value: fila.provider_ref },
        title: fila.title,
        ...(fila.cover_url === null ? {} : { coverUrl: fila.cover_url }),
        ...(fila.year === null ? {} : { year: fila.year }),
        ...(kindOf(fila.kind) === undefined ? {} : { kind: kindOf(fila.kind) }),
      }))
    },
  }
}
