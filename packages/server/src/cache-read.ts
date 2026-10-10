/**
 * Lectura con caché: el patrón `cache-aside` del spec.
 *
 * La regla es corta y tiene tres caminos:
 *
 * ```
 * read(ref):
 *   sin fila                -> MISS  -> pedir al proveedor, escribir, servir
 *   dentro del TTL          -> HIT   -> servir sin red
 *   fuera del TTL           -> STALE -> servir ya, y refrescar por detrás
 * ```
 *
 * Lo que no es tan corto es el STALE: la respuesta sale **ya** y el refresco
 * ocurre por detrás, en la cola de revalidación, deduplicado por clave. El
 * usuario no espera por un dato que ya existía, y dos pestañas abiertas en el
 * mismo título no piden dos veces lo mismo a un sitio de terceros.
 *
 * Un refresco que falla no borra nada: se anota el error y la fila vieja se
 * queda. Cambiar un dato viejo por ninguno es empeorar.
 */

import type { RevalidateResource, Revalidator } from '@nn-anime/catalog-store'
import type { CacheHit } from '@nn-anime/core'

/** De dónde salió lo que se sirve. Es lo que viaja en `X-Cache`. */
export type CacheSource = 'hit' | 'miss' | 'stale'

export interface CacheOutcome<T> {
  readonly value: T
  readonly source: CacheSource
}

export interface ReadThroughOptions<T> {
  /** Clave de deduplicación del refresco. */
  readonly key: string
  readonly resource: RevalidateResource
  readonly read: () => Promise<CacheHit<T> | null>
  readonly fetch: () => Promise<T>
  readonly write: (value: T) => Promise<void>
  readonly revalidator: Revalidator
  /** Se llama cuando el refresco de fondo falla. Lo normal: anotar el error. */
  readonly onError?: (key: string, message: string) => void
  /** Se llama cuando el refresco de fondo funciona. Lo normal: limpiar el error. */
  readonly onSuccess?: (key: string) => void
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export async function readThrough<T>(options: ReadThroughOptions<T>): Promise<CacheOutcome<T>> {
  const cached = await options.read()

  if (cached === null) {
    const value = await options.fetch()
    await options.write(value)

    return { value, source: 'miss' }
  }

  if (!cached.stale) return { value: cached.value, source: 'hit' }

  // Fuera del TTL: se sirve lo que hay y se refresca por detrás. El `catch` no
  // es decorativo: una tarea de fondo que rechaza sin nadie escuchando sale por
  // consola como rechazo no gestionado y parece un fallo de la aplicación.
  options.revalidator.schedule(options.key, async () => {
    try {
      const value = await options.fetch()
      await options.write(value)
      options.onSuccess?.(options.key)
    } catch (cause) {
      // No se relanza: el error se anota aquí y el trabajo se da por terminado.
      // Relanzarlo lo contaría dos veces si el revalidador tuviera su propio
      // manejador, y el fallo de un refresco de fondo no tiene a quién avisar.
      options.onError?.(options.key, describe(cause))
    }
  })

  return { value: cached.value, source: 'stale' }
}

/** El resumen de varios orígenes, para la cabecera de una respuesta agregada. */
export function summarizeSources(sources: readonly CacheSource[]): CacheSource {
  if (sources.includes('miss')) return 'miss'
  if (sources.includes('stale')) return 'stale'

  return 'hit'
}
