/**
 * Los vecinos del episodio que se ve: el anterior, el siguiente y dónde está.
 *
 * **Los vecinos se piden de a uno, y el total de la primera página.** Antes esta
 * pantalla descargaba la lista entera del título —mil ciento ochenta episodios de
 * One Piece— para saber quién iba antes, quién después y de cuántos era el título,
 * y lo hacía aunque la flecha no se llegara a usar. Con el número en la dirección
 * (`?n=`) se pide **una** página —la primera, que el servidor cachea cinco
 * minutos— por dos cosas: leer el total, para poder decir «Episodio 2 de 12», y
 * sacar de ahí los dos vecinos cuando el episodio está en ella, que es lo que
 * ahorra las dos lecturas puntuales. Si el episodio no está en esa página, se
 * vuelve a `number/n-1` y `number/n+1`, que es lo único que lo encuentra sin
 * descargar la lista entera. Y sólo cuando la pantalla ya está pintada: la
 * reproducción no depende de ninguna de estas lecturas, y si fallan el episodio se
 * ve igual y lo único que se pierde es el salto al de al lado y el total.
 *
 * Sin número —una dirección escrita a mano— se pide la primera página y los
 * vecinos salen de ahí: lo que no se hace nunca es suponer un `n-1` sobre una
 * referencia que puede no numerar nada.
 *
 * La lectura vive aquí, y no dentro de la pantalla, por dos razones: es lo que se
 * puede probar sin navegador —con las rutas que se piden— y es un bloque que no
 * depende de nada del reproductor.
 */

import type { EpisodesResponse } from '@nn-anime/core/api'
import type { Episode } from '@nn-anime/core/models'
import { useEffect, useState } from 'react'
import {
  type EpisodeLookup,
  type EpisodeReads,
  loadEpisodeByNumber,
  loadEpisodesPage,
  loadLatestEpisode,
} from '../detail/useDetail'
import type { EpisodeRef } from './watch-route'

/**
 * El estado de la pantalla de reproducción.
 *
 * Vive aquí porque los vecinos dependen de él: no se piden mientras la pantalla
 * carga, y esa regla —`shouldLoadNeighbours`— es la que la pone en marcha.
 */
export type WatchEstado = 'loading' | 'ready' | 'error'

/** Un vecino, con lo que hace falta para enlazarlo: a dónde va y con qué número. */
export interface WatchNeighbour {
  readonly ref: EpisodeRef
  readonly number: number
  /** La temporada, si el episodio la declara. Viaja al enlace del vecino. */
  readonly season?: number
}

/** Dónde está el episodio que se ve, con lo que el proveedor haya dicho. */
export interface WatchPosition {
  readonly number: number
  /** Cuántos episodios tiene el título, si la página trajo el total. */
  readonly total?: number
  /** El título del episodio, si venía en la lista. */
  readonly title?: string
}

export interface WatchNeighbours {
  /** El anterior, o nada si no lo hay o el proveedor no lo conoce. */
  readonly previous: WatchNeighbour | undefined
  /** El siguiente, o nada si no lo hay o el proveedor no lo conoce. */
  readonly next: WatchNeighbour | undefined
  readonly position: WatchPosition | undefined
}

/** Lo que hace falta saber para buscar los vecinos. */
export interface NeighbourLookup {
  readonly providerId: string
  /** La referencia del título, que es con la que se piden sus episodios. */
  readonly titleRef: string
  readonly episodeRef: string
  /** El número que la dirección trae escrito, si lo trae. */
  readonly number: number | undefined
  /** La temporada que la dirección trae escrita, si la trae. */
  readonly season?: number
}

/**
 * Si toca pedir los vecinos.
 *
 * No se piden en la carga inicial: mientras el stream se resuelve la pantalla
 * enseña que está cargando y ninguna flecha, así que pedir vecinos entonces es
 * gastar dos peticiones en botones que todavía no existen.
 */
export function shouldLoadNeighbours(estado: WatchEstado): boolean {
  return estado !== 'loading'
}

function aVecino(episode: Episode | undefined): WatchNeighbour | undefined {
  if (episode === undefined) return undefined

  return {
    ref: episode.ref,
    number: episode.number,
    ...(episode.season === undefined ? {} : { season: episode.season }),
  }
}

/**
 * El episodio del resultado de una búsqueda puntual, o nada.
 *
 * Para un vecino, no haberlo es no tenerlo: que el proveedor conteste que no está
 * o que conteste un error con su motivo da lo mismo aquí, porque la flecha se
 * apaga igual. El motivo se cuenta en el selector, donde sí importa.
 */
function hallado(lookup: EpisodeLookup | undefined): Episode | undefined {
  return lookup?.kind === 'found' ? lookup.episode : undefined
}

/** Sólo los episodios de este proveedor: la lista puede traer los de otro. */
function delProveedor(episodes: readonly Episode[], providerId: string): readonly Episode[] {
  return episodes.filter((episode) => episode.ref.providerId === providerId)
}

/**
 * Los vecinos que salen de una página ya leída.
 *
 * El siguiente del último de la página no está en ella: si el servidor dice que
 * queda más, se pide la segunda **una sola vez** y se toma el primero. El total de
 * la segunda vale igual que el de la primera: es el del título.
 */
async function neighboursInPage(
  propios: readonly Episode[],
  indice: number,
  pagina: EpisodesResponse,
  providerId: string,
  titleRef: string,
  reads: EpisodeReads,
  season?: number,
): Promise<{
  readonly previous: WatchNeighbour | undefined
  readonly next: WatchNeighbour | undefined
  readonly total: number | undefined
}> {
  let siguiente = propios[indice + 1]
  let total = pagina.total

  if (siguiente === undefined && pagina.hasMore) {
    const segunda = await loadEpisodesPage(
      providerId,
      titleRef,
      { page: 2, ...(season === undefined ? {} : { season }) },
      reads,
    )
    siguiente = delProveedor(segunda.episodes, providerId)[0]
    total = segunda.total ?? total
  }

  return { previous: aVecino(propios[indice - 1]), next: aVecino(siguiente), total }
}

/**
 * El vecino que está en la temporada de al lado.
 *
 * Al terminar la última parte de una temporada, la flecha siguiente no puede
 * apagarse: la serie continúa en la siguiente. El primero de la temporada que
 * viene (o el último de la anterior) se pide con la temporada delante, que es lo
 * que el servidor necesita para no devolver el de otra.
 */
async function neighbourInOtherSeason(
  direction: 'previous' | 'next',
  providerId: string,
  titleRef: string,
  season: number,
  seasons: readonly { readonly season: number }[],
  reads: EpisodeReads,
): Promise<WatchNeighbour | undefined> {
  const indice = seasons.findIndex((temporada) => temporada.season === season)
  if (indice === -1) return undefined

  const destino = seasons[indice + (direction === 'next' ? 1 : -1)]
  if (destino === undefined) return undefined

  if (direction === 'previous') {
    return aVecino(hallado(await loadLatestEpisode(providerId, titleRef, reads, destino.season)))
  }

  const pagina = await loadEpisodesPage(
    providerId,
    titleRef,
    { page: 1, season: destino.season },
    reads,
  )

  return aVecino(delProveedor(pagina.episodes, providerId)[0])
}

async function neighboursWithNumber(
  providerId: string,
  titleRef: string,
  episodeRef: string,
  number: number,
  reads: EpisodeReads,
  season?: number,
): Promise<WatchNeighbours> {
  const pagina = await loadEpisodesPage(
    providerId,
    titleRef,
    { page: 1, ...(season === undefined ? {} : { season }) },
    reads,
  ).catch(() => undefined)
  const propios = pagina === undefined ? [] : delProveedor(pagina.episodes, providerId)
  const actual = propios.find((episode) => episode.ref.value === episodeRef)

  // La temporada puede no venir en la dirección —un enlace viejo— y sí en el
  // episodio: se toma la suya para no pedir la temporada 1 de una serie en la 3.
  const suya = actual?.season ?? season

  if (pagina !== undefined && actual !== undefined) {
    const indice = propios.indexOf(actual)
    const enPagina = await neighboursInPage(
      propios,
      indice,
      pagina,
      providerId,
      titleRef,
      reads,
      suya,
    )
    let { previous, next } = enPagina
    const { total } = enPagina

    // El primero y el último de una temporada tienen vecino en la de al lado: la
    // serie no termina en el borde de la temporada.
    if (suya !== undefined && pagina.seasons !== undefined) {
      if (previous === undefined) {
        previous = await neighbourInOtherSeason(
          'previous',
          providerId,
          titleRef,
          suya,
          pagina.seasons,
          reads,
        )
      }

      if (next === undefined) {
        next = await neighbourInOtherSeason(
          'next',
          providerId,
          titleRef,
          suya,
          pagina.seasons,
          reads,
        )
      }
    }

    return {
      previous,
      next,
      position: {
        number: actual.number,
        ...(total === undefined ? {} : { total }),
        ...(actual.title === undefined ? {} : { title: actual.title }),
      },
    }
  }

  const [anterior, siguiente] = await Promise.all([
    number > 1 ? loadEpisodeByNumber(providerId, titleRef, number - 1, reads, suya) : undefined,
    loadEpisodeByNumber(providerId, titleRef, number + 1, reads, suya),
  ])

  return {
    previous: aVecino(hallado(anterior)),
    next: aVecino(hallado(siguiente)),
    // El número es el que traía la dirección: la página que se leyó es la primera
    // y este episodio no está en ella, así que no hay otro número que dar. Y si la
    // página falló, el total tampoco está.
    position: { number, ...(pagina?.total === undefined ? {} : { total: pagina.total }) },
  }
}

/**
 * Los vecinos del episodio que se ve.
 *
 * Con número en la dirección manda `neighboursWithNumber`; sin él se pide la
 * primera página y, si el episodio no está en ella, no se pintan flechas: es una
 * dirección escrita a mano y no hay nada que suponer.
 *
 * Un fallo en una lectura puntual significa «no hay vecino»: `number/0` es un 404
 * garantizado y se evita, y aquí da igual que el proveedor conteste 404 o 502
 * porque las dos cosas quieren decir que ese episodio no lo tiene. La flecha se
 * apaga y no hay error que contar.
 */
export async function loadWatchNeighbours(
  lookup: NeighbourLookup,
  reads: EpisodeReads = {},
): Promise<WatchNeighbours> {
  const { providerId, titleRef, episodeRef, number, season } = lookup

  if (number !== undefined) {
    return neighboursWithNumber(providerId, titleRef, episodeRef, number, reads, season)
  }

  const pagina = await loadEpisodesPage(
    providerId,
    titleRef,
    { page: 1, ...(season === undefined ? {} : { season }) },
    reads,
  )
  const propios = delProveedor(pagina.episodes, providerId)
  const actual = propios.find((episode) => episode.ref.value === episodeRef)

  if (actual === undefined) return { previous: undefined, next: undefined, position: undefined }

  const indice = propios.indexOf(actual)
  const enPagina = await neighboursInPage(
    propios,
    indice,
    pagina,
    providerId,
    titleRef,
    reads,
    actual.season ?? season,
  )
  let { previous, next } = enPagina
  const { total } = enPagina
  const suya = actual.season ?? season

  if (suya !== undefined && pagina.seasons !== undefined) {
    if (previous === undefined) {
      previous = await neighbourInOtherSeason(
        'previous',
        providerId,
        titleRef,
        suya,
        pagina.seasons,
        reads,
      )
    }

    if (next === undefined) {
      next = await neighbourInOtherSeason('next', providerId, titleRef, suya, pagina.seasons, reads)
    }
  }

  return {
    previous,
    next,
    position: {
      number: actual.number,
      ...(total === undefined ? {} : { total }),
      ...(actual.title === undefined ? {} : { title: actual.title }),
    },
  }
}

/** Lo que hace falta para pedir los vecinos de un episodio. */
export interface WatchNeighboursOptions {
  readonly providerId: string
  /** La referencia del título, que es con la que se piden sus episodios. */
  readonly titleRef: string
  readonly episodeRef: string
  /** El número que la dirección trae escrito, si lo trae. */
  readonly number: number | undefined
  /** La temporada que la dirección trae escrita, si la trae. */
  readonly season: number | undefined
  /** El estado de la pantalla: mientras carga, los vecinos no se piden. */
  readonly estado: WatchEstado
}

/**
 * Los vecinos, cuando la pantalla ya está pintada.
 *
 * El fallo no se pinta: una flecha que no aparece es una molestia, un error
 * encima del video que sí se ve es otra cosa. Y no se pide nada mientras el
 * stream se resuelve —`shouldLoadNeighbours`—, porque entonces no hay flechas
 * que dibujar y serían peticiones a fondo perdido.
 */
export function useWatchNeighbours(options: WatchNeighboursOptions): WatchNeighbours | undefined {
  const [vecinos, setVecinos] = useState<WatchNeighbours | undefined>(undefined)

  useEffect(() => {
    if (!shouldLoadNeighbours(options.estado)) return

    let vivo = true

    void loadWatchNeighbours({
      providerId: options.providerId,
      titleRef: options.titleRef,
      episodeRef: options.episodeRef,
      number: options.number,
      ...(options.season === undefined ? {} : { season: options.season }),
    }).then(
      (salida) => {
        if (vivo) setVecinos(salida)
      },
      () => {
        if (vivo) setVecinos(undefined)
      },
    )

    return () => {
      vivo = false
    }
  }, [
    options.providerId,
    options.titleRef,
    options.episodeRef,
    options.number,
    options.season,
    options.estado,
  ])

  return vecinos
}
