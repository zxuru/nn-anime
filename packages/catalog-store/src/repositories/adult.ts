/**
 * La marca de contenido para adultos, por referencia.
 *
 * Lo que se guarda es **un booleano por referencia**, nunca la obra: saber que algo
 * es para adultos no exige quedarse con su portada ni con su sinopsis, y una caché
 * con metadatos de lo que el usuario ha pedido no ver es superficie de fuga a
 * cambio de nada.
 *
 * La tabla es propia y no una columna de `anime` porque la marca la aprende el
 * emparejamiento y la obra puede **no tener fila**: una novedad del feed de un
 * título que nadie ha abierto no la tiene, y marcarla no puede depender de que
 * exista un detalle. Ver `0010-adulto.sql`.
 */

import type { Database } from 'bun:sqlite'
import type { ProviderRef } from '@nn-anime/core'

/** Lo que devuelve la lectura: la referencia marcada, en columnas. */
interface MarkRow {
  readonly provider_id: string
  readonly provider_ref: string
}

export interface AdultRepository {
  /** Marca una referencia. Volver a marcarla no cambia nada. */
  mark(ref: ProviderRef): void
  /** De estas referencias, las que constan como para adultos. */
  list(refs: readonly ProviderRef[]): readonly ProviderRef[]
  /** Si esta referencia consta como para adultos. */
  isMarked(ref: ProviderRef): boolean
}

/**
 * Sin repetidos: dos veces la misma referencia añadiría una rama de más al `OR`, y
 * quien pregunta arma la lista con lo que tiene en pantalla, donde un título puede
 * venir de dos fuentes con la misma referencia.
 */
function sinRepetir(refs: readonly ProviderRef[]): readonly ProviderRef[] {
  const vistos = new Set<string>()
  const unicas: ProviderRef[] = []

  for (const ref of refs) {
    // El separador es un nulo para que «a» + «b» no se confunda con «ab» + «».
    const clave = `${ref.providerId}\u0000${ref.value}`
    if (vistos.has(clave)) continue

    vistos.add(clave)
    unicas.push(ref)
  }

  return unicas
}

export function createAdultRepository(db: Database): AdultRepository {
  const insert = db.query(
    'INSERT INTO adult_ref (provider_id, provider_ref) VALUES (?, ?) ON CONFLICT DO NOTHING',
  )
  const select = db.query<MarkRow, [string, string]>(
    'SELECT provider_id, provider_ref FROM adult_ref WHERE provider_id = ? AND provider_ref = ?',
  )

  return {
    mark(ref) {
      insert.run(ref.providerId, ref.value)
    },

    /**
     * Una consulta para todo el lote, no una por referencia.
     *
     * Las filas que se marcan salen de una pantalla —una fila de novedades, un lote
     * de enriquecimiento—, y una consulta por pieza es el N+1 que el spec prohíbe.
     * El `OR` de pares usa el índice de la clave primaria en cada rama, así que el
     * plan es una búsqueda por referencia y no un recorrido de la tabla.
     */
    list(refs) {
      const unicas = sinRepetir(refs)
      if (unicas.length === 0) return []

      const condiciones = unicas.map(() => '(provider_id = ? AND provider_ref = ?)').join(' OR ')
      const parametros = unicas.flatMap((ref) => [ref.providerId, ref.value])
      const filas = db
        .query<MarkRow, string[]>(
          `SELECT provider_id, provider_ref FROM adult_ref WHERE ${condiciones}`,
        )
        .all(...parametros)

      return filas.map((fila) => ({ providerId: fila.provider_id, value: fila.provider_ref }))
    },

    isMarked(ref) {
      return select.get(ref.providerId, ref.value) !== null
    },
  }
}

export type AdultStore = ReturnType<typeof createAdultRepository>
