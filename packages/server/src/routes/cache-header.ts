/**
 * El `X-Cache` de una fila que consultó a varias fuentes.
 *
 * Una respuesta de tendencias o del feed puede mezclar fuentes: una contesta de
 * la caché y otra acaba de salir a la red. El encabezado es uno, así que la
 * regla es la del peor caso: si algo hubo que pedirlo, la fila es `miss`; si no
 * pero algo estaba caducado, `stale`; sólo si todo salió fresco de la caché es
 * `hit`.
 *
 * No es un capricho de agregación: quien mide la home con `X-Cache: hit` está
 * afirmando que ninguna de sus lecturas salió a un tercero, y un `hit` con una
 * fuente en `miss` sería exactamente la mentira que el encabezado evita.
 */

import type { CacheSource } from '../cache-read'

/** El peor de los orígenes, o nada si no se consultó ninguna fuente. */
export function cacheHeader(sources: readonly CacheSource[]): CacheSource | undefined {
  if (sources.length === 0) return undefined
  if (sources.includes('miss')) return 'miss'
  if (sources.includes('stale')) return 'stale'

  return 'hit'
}
