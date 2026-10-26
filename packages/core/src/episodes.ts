/**
 * La temporada que una fuente escribe en el título del episodio.
 *
 * El contrato de `Episode` no tiene campo de temporada y hay fuentes que sí la
 * saben: cuevana3 la saca de TMDB, pelisplushd de la ruta del capítulo y las dos
 * la escriben en el título —`T2 E1 · Ruptura`—, que es lo único que la trae. Se
 * lee de ahí en lugar de deducirla del número global: una serie de nueve
 * temporadas con 91 episodios no dice en qué temporada está el 42.
 *
 * El marcador es `T<n> E<m>`, con el nombre detrás separado por ` · ` —espacio,
 * U+00B7, espacio—, **tal y como lo escriben los plugins**. La forma se exige
 * entera y anclada: la `E` forma parte del marcador —«T2 · Ruptura» no dice el
 * episodio, y un título no es un marcador por empezar con `T`— y uno que lo lleve
 * en medio no cuenta. Los falsos negativos, declarados: otro separador, otra
 * convención (`1x02`) o un nombre de episodio que empiece por `T`. Adivinar esas
 * variantes sería adivinar por quien escribe el plugin, que es quien tiene el
 * dato; el hueco se ve como una lista sin temporadas, no como una temporada mal
 * puesta.
 */

import type { EpisodeSeason } from './api'

/**
 * El marcador, cerrado y anclado.
 *
 * `·` es el punto medio que separa el nombre, y el nombre es opcional: hay
 * fuentes que sólo numeran. El resto del título no se captura porque nadie lo
 * pide: lo que la fila pinta es el título tal como lo dio la fuente.
 */
const MARCADOR = /^T(\d+) E(\d+)(?: · .*)?$/

/**
 * La temporada del título del episodio, si la lleva escrita.
 *
 * `undefined` cuando no la lleva: no se asume 1. Una fuente que no marca la
 * temporada puede tener los episodios de temporadas distintas mezclados, y
 * devolver 1 los agruparía bajo una temporada que nadie declaró.
 */
export function episodeSeasonOf(title: string | undefined): number | undefined {
  const limpio = title?.trim()
  if (limpio === undefined) return undefined

  const encontrado = MARCADOR.exec(limpio)
  if (encontrado === null) return undefined

  return Number(encontrado[1])
}

/**
 * La temporada de un episodio: la que declara, o la que lleva en el título.
 *
 * La explícita gana porque es el dato de la fuente y no una heurística sobre su
 * texto. El marcador `T<n> E<m>` queda para los plugins que ya existían, que no
 * mandan `season`. `undefined` significa «no se sabe», nunca «temporada 1».
 */
export function seasonOf(episode: {
  readonly season?: number | undefined
  readonly title?: string | undefined
}): number | undefined {
  return episode.season ?? episodeSeasonOf(episode.title)
}

/**
 * Las temporadas de una lista de episodios, con cuántos tiene cada una.
 *
 * Se cuentan **todos** los episodios de cada temporada, estén donde estén en la
 * lista: quien pide una temporada recibe los suyos, y que la fuente los
 * intercale no cambia cuáles son. El orden es el de la primera aparición, que es
 * el de la fuente.
 *
 * `undefined` cuando la lista no se puede agrupar, y las tres razones importan:
 *
 * 1. Algún episodio sin temporada. Agrupar esconde lo que no la tiene, y una
 *    temporada que se lleve por delante a los episodios que no la declaran es
 *    peor que no agrupar.
 * 2. Una sola temporada. Con una no hay nada que elegir: el selector sería una
 *    fila de un botón y la lista, la de siempre.
 * 3. Una lista vacía no tiene temporadas que contar.
 */
export function episodeSeasons(
  episodes: readonly {
    readonly season?: number | undefined
    readonly title?: string | undefined
  }[],
): readonly EpisodeSeason[] | undefined {
  const cuenta = new Map<number, number>()

  for (const episode of episodes) {
    const season = seasonOf(episode)
    if (season === undefined) return undefined

    cuenta.set(season, (cuenta.get(season) ?? 0) + 1)
  }

  if (cuenta.size < 2) return undefined

  return [...cuenta].map(([season, count]) => ({ season, count }))
}
