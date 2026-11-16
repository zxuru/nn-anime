/**
 * La traducción de lo que publica AniSkip a la forma que consume el reproductor.
 *
 * AniSkip habla de `skipType` y de `interval.startTime`/`endTime`, y su
 * vocabulario incluye alias (`mixed-op`, `mixed-ed`) que para el reproductor son
 * el mismo salto que `op` y `ed`. La traducción se hace **una sola vez, aquí**:
 * el cliente web no tiene por qué conocer el vocabulario de un tercero.
 *
 * Es una función pura y no un método del cliente porque lo que hay que decidir no
 * es de red sino de datos: qué se descarta, qué se ordena y qué se deduplica. Un
 * `mixed-op` y un `op` pueden coexistir con tiempos distintos para el mismo
 * episodio —está medido—, así que deduplicar por tipo sería perder un salto real;
 * se deduplica por la terna completa.
 */

import { type SkipInterval, skipIntervalSchema } from '@rona/core'
import { z } from 'zod'

/**
 * Un número crudo, finito o no.
 *
 * El schema no exige finitud a propósito: un intervalo con `NaN` o `Infinity` es
 * un intervalo que se tira, no una respuesta ilegible. Marcarlo como
 * «malformado» cachearía un fallo por un dato suelto y perdería los demás saltos
 * del mismo episodio. Lo que sí exige es que sea un número y no una cadena.
 */
const rawNumberSchema = z.custom<number>(
  (value) => typeof value === 'number',
  'tiene que ser un número',
)

/**
 * La respuesta de AniSkip, con la forma que de verdad tiene.
 *
 * `results` puede faltar y puede venir `null`: en `found:false` la API no
 * promete nada, y tratar `null` como «lista rota» convertiría un «no hay datos»
 * en un error. El schema es tolerante con campos de más —es una respuesta ajena
 * y una columna nueva del tercero no puede romper la reproducción— pero estricto
 * con los que sí se leen.
 */
export const aniskipResponseSchema = z.object({
  found: z.boolean(),
  results: z
    .array(
      z.object({
        interval: z.object({
          startTime: rawNumberSchema,
          endTime: rawNumberSchema,
        }),
        skipType: z.string(),
      }),
    )
    .nullish(),
})

export type AniSkipRawResponse = z.infer<typeof aniskipResponseSchema>

/** Lo que se puede hacer con una respuesta: hay saltos, no hay, o no se entiende. */
export type NormalizedSkipTimes =
  | { readonly kind: 'found'; readonly intervals: readonly SkipInterval[] }
  | { readonly kind: 'empty' }
  | { readonly kind: 'malformed' }

/**
 * Los alias de AniSkip, en su forma canónica.
 *
 * Se compara en minúsculas: el tercero publica el tipo en minúsculas hoy, y no
 * hay motivo para que una mayúscula suya deje sin botón al reproductor.
 */
const TYPE_BY_SKIP_TYPE: Readonly<Record<string, SkipInterval['type']>> = {
  op: 'op',
  'mixed-op': 'op',
  ed: 'ed',
  'mixed-ed': 'ed',
  recap: 'recap',
}

/** Orden estable: por dónde empieza, y a igualdad por dónde acaba y qué es. */
function compareIntervals(a: SkipInterval, b: SkipInterval): number {
  if (a.start !== b.start) return a.start - b.start
  if (a.end !== b.end) return a.end - b.end

  return a.type.localeCompare(b.type)
}

/**
 * Normaliza la respuesta cruda.
 *
 * Descarta sin ruido lo que no se puede usar: un tipo que el reproductor no
 * conoce, un intervalo que no avanza o que no es finito. Un salto malo se tira;
 * no se arregla ni se inventa un final.
 */
export function normalizeSkipTimes(payload: unknown): NormalizedSkipTimes {
  const respuesta = aniskipResponseSchema.safeParse(payload)
  if (!respuesta.success) return { kind: 'malformed' }

  // `found:false` es una respuesta buena: se preguntó y no hay saltos.
  if (!respuesta.data.found) return { kind: 'empty' }

  const resultados = respuesta.data.results ?? []
  const porIdentidad = new Map<string, SkipInterval>()

  for (const resultado of resultados) {
    const type = TYPE_BY_SKIP_TYPE[resultado.skipType.toLowerCase()]
    if (type === undefined) continue

    const { startTime, endTime } = resultado.interval
    // Un intervalo que no avanza, que empieza antes del episodio o que no es un
    // número finito no es un salto: es basura de la fuente.
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) continue
    if (startTime < 0 || endTime <= startTime) continue

    // El schema del contrato es la última palabra: si la forma no es la que sale
    // por HTTP, no se sirve. Una sola definición para el servidor y el cliente.
    const valido = skipIntervalSchema.safeParse({ type, start: startTime, end: endTime })
    if (!valido.success) continue

    porIdentidad.set(`${type}:${startTime}:${endTime}`, valido.data)
  }

  const intervals = [...porIdentidad.values()].sort(compareIntervals)
  if (intervals.length === 0) return { kind: 'empty' }

  return { kind: 'found', intervals }
}
