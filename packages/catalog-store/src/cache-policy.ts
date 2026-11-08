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
  // Las tendencias cambian más que un detalle y menos que una búsqueda: quince
  // minutos. No estaban en la tabla del spec; las añadió la auditoría de T47.
  trending: 900,
  // El feed cambia como mucho a diario —lo publica el sitio, no el usuario— y
  // cada consulta es una petición a un tercero: media hora. Lo añade T49, con su
  // fila en la tabla del spec.
  feed: 1800,
  // Una página del selector se mira ahora mismo, no es el catálogo del título:
  // cinco minutos. La ventana corta es la que hace que una página pedida durante
  // una ráfaga no se sirva durante horas. La añade T87.
  episodePage: 300,
  // El emparejamiento de una obra con AniList: un mes. El título, la portada y
  // la sinopsis de una obra no cambian; lo que caduca es el próximo episodio, y
  // eso lo refresca la parrilla, que es otra tabla.
  anilistMedia: 2592000,
  // «Esta obra se buscó y no tiene equivalente»: una semana. Es una pregunta que
  // se hizo y se respondió que no, y repetirla cada carga gastaría del presupuesto
  // de un tercero por nada.
  anilistMiss: 604800,
  // El ranking y lo recién emitido: seis horas y media hora.
  anilistTop: 21600,
  anilistSchedule: 1800,
  // Las relaciones de una obra —su secuela, su precuela—: una semana. Es la
  // estructura de una franquicia, y una secuela aparece cuando se anuncia, no
  // cada día. La añade T124.
  anilistRelated: 604800,
  // Lo que AniList tiene de un término como estudio o como género: seis horas,
  // como el ranking. Un estudio estrena como mucho una vez por temporada y su
  // lista cambia cuando se anuncia la obra, no cada día. La añade T138.
  anilistSearch: 21600,
  // Los intervalos saltable de un episodio, de AniSkip: un mes. Una vez que la
  // comunidad los publica no cambian —son los segundos en los que empieza y acaba
  // la intro de un capítulo que ya se emitió—, y cada consulta es una petición a
  // un servicio gratuito que se sostiene con donaciones. La añade T60.
  aniskip: 2592000,
  // «Este episodio no tiene intervalos» —o AniSkip no conoce la obra—: seis
  // horas. No es un dato definitivo como el emparejamiento: los intervalos se
  // publican cuando alguien los mide, así que un episodio recién emitido puede
  // pasar de «no hay» a «hay» el mismo día, y una espera de un mes dejaría el
  // botón apagado toda la temporada. Seis horas es lo que se tarda en volver a
  // preguntar sin gastar el presupuesto del servicio.
  aniskipMiss: 21600,
  // La consulta falló o la respuesta no se entendió: quince minutos. Un fallo de
  // red se reintenta solo en cuanto el usuario vuelve a abrir el episodio, pero no
  // en cada carga: el cuarto de hora es lo que distingue un corte pasajero de un
  // servicio caído sin machacarlo mientras tanto. La añade T60.
  aniskipError: 900,
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
