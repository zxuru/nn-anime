/**
 * Política de caché: cuánto dura cada recurso y cuándo un dato está viejo.
 *
 * Los TTL son los de la tabla del spec, ni uno más. Viven en un solo sitio
 * porque un TTL repetido en cada repositorio es un TTL que se cambia en tres de
 * los cuatro sitios, y el que se olvida es el que sirve datos de hace un mes
 * como si fueran frescos.
 *
 * El cálculo de `stale` es una función y no una comparación suelta para que se
 * pueda probar con un reloj inyectado: un test que dependa del reloj real mide
 * la hora a la que se ejecuta, no la lógica.
 */

import type { CacheHit } from '@nn-anime/core'

/** Segundos de vida por recurso, de la tabla del spec. */
export const TTL_SECONDS = {
  search: 900,
  anime: 86400,
  episodes: 21600,
  stream: 600,
  cover: 604800,
} as const

export type CacheResource = keyof typeof TTL_SECONDS

/** `fetchedAt` en milisegundos, como `Date.now()`. */
export function isStale(fetchedAt: number, ttlS: number, now: number = Date.now()): boolean {
  return fetchedAt + ttlS * 1000 <= now
}

/** Compone el resultado de una lectura de caché, con su caducidad calculada. */
export function cacheHit<T>(
  value: T,
  fetchedAt: number,
  ttlS: number,
  now: number = Date.now(),
): CacheHit<T> {
  return {
    value,
    fetchedAt: new Date(fetchedAt),
    stale: isStale(fetchedAt, ttlS, now),
    ttlS,
  }
}
