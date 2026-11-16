/**
 * El servicio de saltos: resuelve el id de MAL, mira la caché y, si toca, pregunta
 * a AniSkip.
 *
 * La regla de oro de esta pieza es una sola: **un fallo de AniSkip nunca se ve**.
 * Ni un 500, ni una excepción, ni una reproducción que espera. Cualquier camino
 * que no acabe en intervalos acaba en una lista vacía, que es exactamente lo que
 * el reproductor entiende por «aquí no hay nada que saltar».
 *
 * La caché es persistente y vive en `catalog-store`: una respuesta buena dura
 * treinta días —los saltos de un episodio no cambian—, un «no hay datos» seis
 * horas y un fallo quince minutos. Distinguir los tres importa: cachear un fallo
 * de red como si fuera «no hay datos» dejaría al episodio sin botones durante un
 * mes, y no cachear nada convertiría cada reproducción en una petición al tercero.
 */

import { TTL_SECONDS } from '@nn-anime/catalog-store'
import type { CacheHit, SkipInterval } from '@nn-anime/core'
import type { AniSkipClient } from './client'
import { normalizeSkipTimes } from './normalize'

/**
 * Lo que el servicio necesita del store.
 *
 * Es un subconjunto estructural de la fachada `CatalogStore`, no un tipo aparte:
 * así el store real encaja sin conversión y una prueba puede pasar un doble de
 * tres métodos sin montar SQLite.
 */
export interface SkipTimesStore {
  /** El id de MAL de una obra de AniList; `undefined` si no se conoce o no tiene. */
  readMalId(anilistId: number): Promise<number | undefined>
  readSkipTimes(key: string): Promise<CacheHit<readonly SkipInterval[]> | null>
  writeSkipTimes(key: string, intervals: readonly SkipInterval[], ttlS: number): Promise<void>
}

/** Lo que se pide: una obra de AniList, un episodio y, si se sabe, su duración. */
export interface SkipTimesRequest {
  readonly anilistId: number
  readonly episode: number
  /**
   * La duración del episodio. Si falta no se consulta: AniSkip la exige y la usa
   * para elegir la entrada, así que sin ella no hay nada que preguntar.
   */
  readonly length?: number | undefined
}

export interface SkipTimesServiceOptions {
  readonly store: SkipTimesStore
  readonly client: AniSkipClient
}

export interface SkipTimesService {
  /** Nunca lanza y nunca devuelve un error: o hay intervalos o hay lista vacía. */
  skipTimes(request: SkipTimesRequest): Promise<readonly SkipInterval[]>
}

/**
 * La clave de caché: el id de MAL, el episodio y la duración redondeada.
 *
 * La duración va en la clave porque **selecciona la entrada**: AniSkip elige la
 * fila cuyo `episodeLength` se parece al pedido, y dos duraciones del mismo
 * episodio pueden devolver saltos en segundos distintos. Compartir fila sería
 * servir los saltos de otro montaje. Se redondea al segundo porque la sensibilidad
 * medida es de decenas de segundos (1440 y 1450 dan respuestas distintas; ±0.5 s
 * no) y dos medidas del mismo episodio no deben partir la caché en dos.
 */
export function skipTimesCacheKey(malId: number, episode: number, length: number): string {
  return `${malId}:${episode}:${Math.round(length)}`
}

/**
 * El servicio.
 *
 * Las peticiones simultáneas del mismo episodio comparten una sola consulta: dos
 * pestañas abiertas en el mismo capítulo no deben gastar dos peticiones del
 * tercero. La deduplicación vive aquí, en memoria, y no en el store: es una prisa
 * de segundos, no un dato que merezca una tabla.
 */
export function createSkipTimesService(options: SkipTimesServiceOptions): SkipTimesService {
  const enVuelo = new Map<string, Promise<readonly SkipInterval[]>>()

  /**
   * Escribe la caché, sin dejar que su fallo suba.
   *
   * No poder cachear es peor rendimiento, no un fallo de la reproducción: la
   * respuesta ya está calculada y devolverla es lo correcto. Un store caído no
   * puede quitarle los botones a un episodio.
   */
  async function recordar(
    key: string,
    intervals: readonly SkipInterval[],
    ttlS: number,
  ): Promise<void> {
    try {
      await options.store.writeSkipTimes(key, intervals, ttlS)
    } catch {
      // Se ignora a propósito: ver el comentario de arriba.
    }
  }

  /** Una consulta: caché, red y escritura. Nunca lanza. */
  async function resolver(
    request: SkipTimesRequest,
    malId: number,
    length: number,
    key: string,
  ): Promise<readonly SkipInterval[]> {
    try {
      const cached = await options.store.readSkipTimes(key)
      if (cached !== null && !cached.stale) return cached.value

      const respuesta = await options.client.fetch({
        malId,
        episode: request.episode,
        length,
      })

      if (!respuesta.ok) {
        await recordar(key, [], TTL_SECONDS.aniskipError)

        return []
      }

      const normalizada = normalizeSkipTimes(respuesta.payload)
      if (normalizada.kind === 'malformed') {
        await recordar(key, [], TTL_SECONDS.aniskipError)

        return []
      }

      if (normalizada.kind === 'empty') {
        await recordar(key, [], TTL_SECONDS.aniskipMiss)

        return []
      }

      await recordar(key, normalizada.intervals, TTL_SECONDS.aniskip)

      return normalizada.intervals
    } catch {
      // Red, store o normalización: cualquier fallo es lista vacía. La
      // reproducción no se entera.
      return []
    }
  }

  return {
    async skipTimes(request: SkipTimesRequest): Promise<readonly SkipInterval[]> {
      const { length } = request
      // Sin duración no se sale a la red. AniSkip exige `episodeLength` y la usa
      // para **elegir la entrada**; mandar `0` devolvería una entrada de cada
      // tipo, de la duración que sea, que no es lo que se está reproduciendo.
      // El reproductor siempre manda la duración: esta rama es para clientes
      // raros, y para ellos la respuesta honesta es «no hay saltos».
      if (length === undefined || !Number.isFinite(length) || length <= 0) return []

      let malId: number | undefined
      try {
        malId = await options.store.readMalId(request.anilistId)
      } catch {
        return []
      }

      // Sin ficha de MAL no hay a quién preguntar. No es un error: es una obra
      // para la que AniSkip no puede tener datos.
      if (malId === undefined) return []

      const key = skipTimesCacheKey(malId, request.episode, length)
      const previa = enVuelo.get(key)
      if (previa !== undefined) return previa

      const tarea = resolver(request, malId, length, key).finally(() => {
        enVuelo.delete(key)
      })
      enVuelo.set(key, tarea)

      return tarea
    },
  }
}
