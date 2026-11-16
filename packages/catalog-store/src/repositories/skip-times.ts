/**
 * Caché de los intervalos saltables que publica AniSkip, por episodio.
 *
 * La clave la construye quien llama —`malId:episodio:duración`— y aquí no se
 * reinterpreta: el repositorio no sabe de dónde sale el id de MAL ni qué
 * duración es la del reproductor, y componerla en dos sitios sería componerla
 * distinto. Lo que sí es de este módulo es la forma de la fila: un JSON con la
 * lista ya normalizada del contrato y el TTL con el que se escribió.
 *
 * `found` se guarda junto a la lista y **manda en la lectura**. Una fila marcada
 * como «no hay» no devuelve intervalos aunque el JSON traiga alguno: el escritor
 * mantiene las dos mitades juntas en el mismo `upsert`, así que sólo una edición
 * a mano las separaría, y ante la duda no se enciende un botón que saltaría la
 * intro de un episodio que el índice dice que no tiene. La lista vacía es una
 * respuesta que se cachea —con su TTL corto— para no preguntar lo mismo en cada
 * carga; por eso una fila de «no hay» no es un MISS.
 *
 * La lectura valida con `skipIntervalSchema`. La caché es otra frontera: lo que
 * entra viene de un tercero, y una fila que no cumple el contrato no puede salir
 * como si fuera una lista de intervalos.
 */

import type { Database } from 'bun:sqlite'
import { type CacheHit, type SkipInterval, StoreError, skipIntervalSchema } from '@nn-anime/core'
import { z } from 'zod'
import { cacheHit } from '../cache-policy'

/** La lista tal y como viaja a la interfaz: el schema del contrato, no una copia. */
const INTERVALOS = z.array(skipIntervalSchema)

interface SkipRow {
  readonly intervals_json: string
  readonly found: number
  readonly fetched_at: number
  readonly ttl_s: number
}

/**
 * La lista de intervalos de una fila, ya validada.
 *
 * El `JSON.parse` se envuelve aquí y no se deja salir como `SyntaxError`: una
 * fila corrupta es el mismo tipo de fallo que una con otra forma —un dato que no
 * se entiende— y quien lee la caché ya sabe tratar un `StoreError`. El detalle
 * del parseo queda como causa para que el registro no diga sólo «JSON inválido».
 */
function parseIntervalos(fila: SkipRow, key: string): readonly SkipInterval[] {
  let crudo: unknown

  try {
    crudo = JSON.parse(fila.intervals_json)
  } catch (cause) {
    throw new StoreError({
      message: `los intervalos cacheados de ${key} no son JSON`,
      context: { key },
      op: 'readSkipTimes',
      cause,
    })
  }

  const intervalos = INTERVALOS.safeParse(crudo)
  if (!intervalos.success) {
    throw new StoreError({
      message: `los intervalos cacheados de ${key} tienen una forma que no se entiende`,
      context: { key },
      op: 'readSkipTimes',
    })
  }

  return intervalos.data
}

export interface SkipTimesRepository {
  /**
   * Lo que hay cacheado de una clave: la lista y su caducidad, o `null` si nunca
   * se preguntó.
   *
   * `null` es «no se ha preguntado» y se pregunta ahora; una lista vacía **con
   * fila** es «se preguntó y no había» y espera a su TTL. La diferencia es la que
   * evita volver a preguntar en cada carga lo que ya se sabe que no hay.
   */
  read(key: string, now?: number): CacheHit<readonly SkipInterval[]> | null
  /**
   * Guarda la lista con el TTL que decidió quien llama.
   *
   * El TTL no lo elige este módulo porque no sabe si la lista es un acierto, un
   * «no hay» o el resultado de un fallo: los tres se responden con la misma forma
   * al reproductor y con vidas muy distintas en la caché. `found` se deriva de la
   * lista —con intervalos es un acierto— y se guarda para que la fila diga qué es.
   */
  write(key: string, intervals: readonly SkipInterval[], ttlS: number, now?: number): void
}

export function createSkipTimesRepository(db: Database): SkipTimesRepository {
  const select = db.query<SkipRow, [string]>(
    'SELECT intervals_json, found, fetched_at, ttl_s FROM aniskip_cache WHERE cache_key = ?',
  )
  const upsert = db.query(
    `INSERT INTO aniskip_cache (cache_key, intervals_json, found, fetched_at, ttl_s)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (cache_key) DO UPDATE SET
       intervals_json = excluded.intervals_json,
       found          = excluded.found,
       fetched_at     = excluded.fetched_at,
       ttl_s          = excluded.ttl_s`,
  )

  return {
    read(key, now = Date.now()) {
      const fila = select.get(key)
      if (fila === null) return null

      // Se valida el JSON siempre, también en las filas de «no hay»: una fila
      // corrupta tiene que denunciarse, no quedarse sin leer.
      const intervalos = parseIntervalos(fila, key)

      return cacheHit(fila.found === 1 ? intervalos : [], fila.fetched_at, fila.ttl_s, now)
    },

    write(key, intervals, ttlS, now = Date.now()) {
      upsert.run(key, JSON.stringify(intervals), intervals.length > 0 ? 1 : 0, now, ttlS)
    },
  }
}
