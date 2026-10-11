/**
 * Los hermanos de saga de un título, leídos de la base.
 *
 * La fuente no declara relaciones, así que el emparejamiento es por **título
 * base** y dentro del mismo proveedor: «Sousou no Frieren 2nd Season» encuentra
 * a «Sousou no Frieren». Es una heurística y el módulo lo dice: una secuela
 * nombrada de otra forma no aparece, y entonces la sección se explica en vez de
 * rellenarse con otra cosa.
 *
 * **Una sola consulta.** Trae las filas del proveedor, busca entre ellas la que
 * se pidió —por referencia, no por título: dos títulos distintos pueden
 * llamarse igual— y compara en memoria. La normalización no se puede escribir
 * en SQL, y una consulta por candidato sería justo el patrón que el spec del
 * almacén prohíbe.
 *
 * Sólo relaciona lo que la base ya conoce. Rellenar la sección preguntando al
 * proveedor sería una petición de red por cada ficha abierta, y el spec prohíbe
 * la precarga especulativa.
 */

import type { Database } from 'bun:sqlite'
import { type AnimeSummary, baseTitle, type ProviderRef, titleKindSchema } from '@nn-anime/core'

/**
 * Tope de filas que se traen para comparar.
 *
 * La tabla `anime` sólo tiene lo que el usuario abrió o buscó, no el catálogo
 * del proveedor: el tope es la red de seguridad para una base que crezca mucho,
 * y evita que una lectura se lleve la tabla entera a memoria.
 */
export const RELATED_SCAN_LIMIT = 1000

interface RelatedRow {
  readonly provider_ref: string
  readonly title: string
  readonly cover_url: string | null
  readonly year: number | null
  readonly kind: string | null
}

/**
 * El tipo del título, validado.
 *
 * Vive en `raw_json` y podría no estar o no ser uno de los que la interfaz sabe
 * pintar; el schema lo comprueba y si no encaja se omite el campo en vez de
 * inventarlo.
 */
function kindOf(raw: string | null): AnimeSummary['kind'] {
  if (raw === null) return undefined

  const kind = titleKindSchema.safeParse(raw)

  return kind.success ? kind.data : undefined
}

/**
 * Ordena por cercanía al año pedido.
 *
 * Mismo año primero y después el más próximo: entre dos temporadas de la misma
 * saga, la de al lado es la que se busca. Sin año, al final; y con el mismo
 * año, la más reciente. El orden es estable, así que dos llamadas seguidas
 * pintan la misma fila en el mismo orden.
 */
export function byYearProximity(year: number | undefined) {
  return (a: AnimeSummary, b: AnimeSummary): number => {
    if (year === undefined) return (b.year ?? 0) - (a.year ?? 0)

    const distanciaA = a.year === undefined ? Number.POSITIVE_INFINITY : Math.abs(a.year - year)
    const distanciaB = b.year === undefined ? Number.POSITIVE_INFINITY : Math.abs(b.year - year)
    if (distanciaA !== distanciaB) return distanciaA - distanciaB

    return (b.year ?? 0) - (a.year ?? 0)
  }
}

export function createRelatedRepository(db: Database) {
  const select = db.query<RelatedRow, [string, number]>(
    `SELECT provider_ref, title, cover_url, year,
            json_extract(raw_json, '$.kind') AS kind
       FROM anime
      WHERE provider_id = ?
      ORDER BY year DESC, title
      LIMIT ?`,
  )

  return {
    /**
     * Los hermanos de saga de `ref`, sin él mismo.
     *
     * Lista vacía cuando no hay ninguno: «no hay» no es «no se pudo», y quien
     * pinta la sección necesita distinguirlo para explicarse.
     */
    list(ref: ProviderRef, limit: number): readonly AnimeSummary[] {
      const filas = select.all(ref.providerId, RELATED_SCAN_LIMIT)

      const propia = filas.find((fila) => fila.provider_ref === ref.value)
      // Sin la fila propia no hay título que normalizar: pasa cuando la
      // referencia no está en la base o cuando quedó fuera del tope. Devolver
      // vacío es la verdad, no un error.
      if (propia === undefined) return []

      const base = baseTitle(propia.title)
      if (base === '') return []

      const hermanos: AnimeSummary[] = []
      for (const fila of filas) {
        if (fila.provider_ref === ref.value) continue
        if (baseTitle(fila.title) !== base) continue

        const kind = kindOf(fila.kind)
        hermanos.push({
          ref: { providerId: ref.providerId, value: fila.provider_ref },
          title: fila.title,
          ...(fila.cover_url === null ? {} : { coverUrl: fila.cover_url }),
          ...(fila.year === null ? {} : { year: fila.year }),
          ...(kind === undefined ? {} : { kind }),
        })
      }

      return hermanos.sort(byYearProximity(propia.year ?? undefined)).slice(0, limit)
    },
  }
}

export type RelatedStore = ReturnType<typeof createRelatedRepository>
