/**
 * Pantalla de reproducción.
 *
 * Resuelve el stream por la API —el cliente nunca ve la URL del upstream, sólo
 * el ticket— y monta el reproductor con la primera fuente. Si la resolución
 * falla, se dice qué pasó y se ofrece reintentar: una pantalla en negro sin
 * explicación es lo peor que puede hacer un reproductor.
 *
 * La elección de sub o dub, la pista de subtítulos y el guardado de la posición
 * son de T32; aquí está la reproducción.
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
 * La pantalla se compone en **dos columnas**: el reproductor y sus mandos a la
 * izquierda, la lista de episodios a la derecha. El encabezado, el video y el pie
 * comparten el mismo borde porque viven en la misma columna: antes el título
 * llegaba hasta el ancho de la página y el video se quedaba en la mitad, con un
 * hueco vacío al lado.
 */

import {
  animeResponseSchema,
  type EpisodesResponse,
  streamResolveResponseSchema,
} from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { Episode } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, apiPostJson } from '../../api/client'
import { describirFallo, FALLO_SIN_CAUSA, type Fallo, falloSinFuente } from '../../api/fallo'
import { ErrorNotice } from '../../components/ErrorNotice'
import { t } from '../../i18n'
import {
  composeTitle,
  episodeLabel,
  useDocumentTitle,
  watchTitleParts,
} from '../../lib/document-title'
import { buildPath, Link, useNavigate, usePath } from '../../router'
import {
  type EpisodeLookup,
  type EpisodeReads,
  loadEpisodeByNumber,
  loadEpisodesPage,
} from '../detail/useDetail'
import { coverPath } from '../search/ResultCard'
import { AudioModeSwitch } from './AudioModeSwitch'
import { Player } from './Player'
import {
  almacenLocal,
  claveDeProgreso,
  guardarAutoplay,
  guardarProgreso,
  leerAutoplay,
  leerProgreso,
  olvidarProgreso,
  reanudarEn,
} from './storage'
import { type SubtitleCandidate, toSafeTracks, tracksFromSource } from './subtitle-tracks'
import { useMpvHandoff } from './useMpvHandoff'
import { useWatchEvents } from './useWatchEvents'
import { WatchEpisodes } from './WatchEpisodes'
import {
  animeRefFromPath,
  animeRefOf,
  type EpisodeRef,
  modeFromPath,
  numberFromPath,
  seasonFromPath,
  startAtFromPath,
  type WatchPathOptions,
  watchPath,
} from './watch-route'

export interface WatchPageProps {
  readonly providerId: string
  readonly ref: string
}

type Estado = 'loading' | 'ready' | 'error'

/** Cada cuánto se apunta por dónde va, como mucho. */
const GUARDADO_MS = 5000

/** Los segundos que se espera antes de pasar solo al episodio siguiente. */
const SEGUNDOS_DEL_SIGUIENTE = 5

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
export function shouldLoadNeighbours(estado: Estado): boolean {
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
 * Los vecinos cuando la dirección trae el número.
 *
 * La primera página se pide **siempre**, y su fallo no se cuenta: sin ella se
 * pierde el total que hace decir «de 26», no el episodio. El total no se inventa
 * —un «de 26» que el proveedor no dio es peor que no decir de cuántos—, así que
 * sin total la pantalla se queda en «Episodio 2» como antes.
 */
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
    const { previous, next, total } = await neighboursInPage(
      propios,
      indice,
      pagina,
      providerId,
      titleRef,
      reads,
      suya,
    )

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
  const { previous, next, total } = await neighboursInPage(
    propios,
    indice,
    pagina,
    providerId,
    titleRef,
    reads,
    actual.season ?? season,
  )

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

/**
 * La flecha de episodio.
 *
 * Es un dibujo y no el glifo `←` de la tipografía. El glifo se apoya en la línea
 * de base, así que dentro de una caja de 56 px queda descentrado —y se ve
 * distinto en cada máquina, porque cada una resuelve la flecha con la fuente que
 * tenga—. Un bloque con contorno, como el resto de la interfaz, se centra solo y
 * se ve igual en todas partes.
 *
 * La de la izquierda es la misma, espejada: un solo dibujo, dos direcciones.
 */
function EpisodeArrow(props: { readonly towards: 'previous' | 'next' }): ReactNode {
  return (
    <svg
      className="watch__nav-arrow"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-towards={props.towards}
    >
      <path d="M2 9H13V4.5L21.5 12 13 19.5V15H2Z" />
    </svg>
  )
}

export function WatchPage(props: WatchPageProps): ReactNode {
  const [fuente, setFuente] = useState<
    { url: string; kind: string; subtitles?: readonly SubtitleCandidate[] } | undefined
  >(undefined)
  // El modo se elige aquí y volver a resolver el stream con el nuevo modo
  // reanuda en la misma posición: cambiar de subtitulado a doblado no debería
  // devolver a nadie al principio del episodio.
  //
  // El modo de arranque es el que la ficha puso en la dirección: quien eligió
  // doblado allí ya lo dijo, y volver a preguntarlo aquí sería hacerle repetir
  // una elección que acaba de hacer. Dentro de la pantalla manda este selector.
  const path = usePath()
  const [modo, setModo] = useState<'sub' | 'dub'>(() => modeFromPath(path) ?? 'sub')

  /**
   * El segundo por el que se empieza.
   *
   * Tres fuentes, por orden: lo que la dirección pide —la tarjeta de «continuar
   * viendo» lo escribe en el enlace—, lo que la pantalla apuntó la última vez que
   * se vio este episodio y, si no hay nada, el principio.
   *
   * Se lee en el arranque y no en un efecto: el reproductor monta con la fuente ya
   * resuelta y su posición de reanudación se decide una sola vez por fuente, así
   * que llegar tarde es llegar al segundo cero.
   */
  const [posicion, setPosicion] = useState(() => {
    const deLaDireccion = startAtFromPath(path)
    if (deLaDireccion !== undefined) return deLaDireccion

    return (
      reanudarEn(leerProgreso(almacenLocal(), claveDeProgreso(props.providerId, props.ref))) ?? 0
    )
  })

  /**
   * Lo último que se supo de la reproducción, en una referencia.
   *
   * El guardado final ocurre al desmontar, y ahí el cierre del efecto ve el estado
   * del primer render: la posición que hay que apuntar es la de ahora, no la del
   * principio.
   */
  const viva = useRef({ positionS: 0, durationS: 0, ultimoGuardado: 0 })

  /**
   * Si el siguiente episodio empieza solo.
   *
   * Lo guardado manda y el valor de fábrica es que sí: quien ve una serie espera
   * que siga. Se puede apagar desde los ajustes del reproductor.
   */
  const [autoplay, setAutoplay] = useState(() => leerAutoplay(almacenLocal()))
  const cambiarAutoplay = useCallback((valor: boolean) => {
    setAutoplay(valor)
    guardarAutoplay(almacenLocal(), valor)
  }, [])

  // El registro del visionado: alta al reproducir de verdad, avance cada 15 s y
  // al pausar, y la posición final al desmontar o cerrar la pestaña.
  //
  // El título y el episodio son dos referencias distintas. La del episodio es la
  // de la dirección; la del título viene escrita en la consulta, puesta ahí por
  // quien construyó el enlace —la ficha, que la tiene en `Episode.animeRef`—.
  // Deducirla del episodio queda como último recurso para un enlace viejo o una
  // dirección escrita a mano, y con la convención equivocada escribía en la base
  // la ficha del episodio como si fuera un título.
  const animeValue = animeRefFromPath(path) ?? animeRefOf(props.ref)
  const animeRef = { providerId: props.providerId, value: animeValue }
  const episodeRef = { providerId: props.providerId, value: props.ref }
  const visionado = useWatchEvents({
    animeRef,
    episodeRef,
    mode: modo,
    startAtS: posicion,
  })
  // El reproductor externo: el botón y lo que contestó el servidor. Va aquí y no
  // dentro de `Player` porque es una forma de ver el episodio, no un control del
  // elemento de video.
  const mpv = useMpvHandoff({
    providerId: props.providerId,
    ref: props.ref,
    mode: modo,
    startAtS: posicion,
  })
  const [estado, setEstado] = useState<Estado>('loading')
  const [error, setError] = useState<Fallo | undefined>(undefined)
  const [vecinos, setVecinos] = useState<WatchNeighbours | undefined>(undefined)
  // El nombre del título. La dirección del reproductor sólo lleva la referencia
  // del episodio, así que sin esta petición la pantalla no sabe cómo se llama lo
  // que está reproduciendo y la pestaña sólo puede decir «Ep. 3».
  const [tituloAnime, setTituloAnime] = useState<string | undefined>(undefined)
  // La portada del título, si el proveedor dio una. No se pasa la dirección del
  // proveedor —que puede ser de fuera y la CSP no la admitiría—: se pide al
  // proxy, que es el único que habla con el upstream. Sin portada no se inventa
  // ninguna: el `<video>` se queda con su fondo, que es lo que había antes.
  const [portada, setPortada] = useState<string | undefined>(undefined)

  // El número que la dirección trae escrito. Es lo que decide si se piden dos
  // vecinos puntuales o la primera página; sin él no se deduce nada.
  const numero = numberFromPath(path)
  // La temporada, cuando la ficha la escribió. Sin ella, los vecinos buscan en la
  // lista entera y pueden caer en otra temporada.
  const temporada = seasonFromPath(path)

  /**
   * Los vecinos, cuando la pantalla ya está pintada.
   *
   * El fallo no se pinta: una flecha que no aparece es una molestia, un error
   * encima del video que sí se ve es otra cosa. Y no se pide nada mientras el
   * stream se resuelve —`shouldLoadNeighbours`—, porque entonces no hay flechas
   * que dibujar y serían peticiones a fondo perdido.
   */
  useEffect(() => {
    if (!shouldLoadNeighbours(estado)) return

    let vivo = true

    void loadWatchNeighbours({
      providerId: props.providerId,
      titleRef: animeRef.value,
      episodeRef: props.ref,
      number: numero,
      ...(temporada === undefined ? {} : { season: temporada }),
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
  }, [props.providerId, props.ref, animeRef.value, numero, temporada, estado])

  // El nombre del título, que es lo que la pestaña necesita para distinguirse de
  // las demás. Si falla, la reproducción no se entera: se pierde el nombre, no el
  // episodio.
  useEffect(() => {
    let vivo = true

    void apiGet(
      `/api/anime/${encodeURIComponent(props.providerId)}/${encodeURIComponent(animeRef.value)}`,
      animeResponseSchema,
    ).then(
      (detalle) => {
        if (!vivo) return

        setTituloAnime(detalle.title)
        setPortada(
          detalle.coverUrl === undefined ? undefined : coverPath(props.providerId, animeRef.value),
        )
      },
      () => undefined,
    )

    return () => {
      vivo = false
    }
  }, [props.providerId, animeRef.value])

  /**
   * Resolver el stream del episodio y el modo actuales.
   *
   * Es una función y no el cuerpo del efecto porque «reintentar» tiene que hacer
   * exactamente lo mismo: pedirlo otra vez. Con un contador en las dependencias el
   * efecto se volvía a montar, pero el contador no se leía en ninguna parte, así
   * que el motivo de la repetición vivía fuera del código que la ejecuta.
   *
   * La petición anterior se aborta: reintentar dos veces seguidas dejaba viva la
   * primera, y su respuesta podía llegar después y pintar una fuente que ya no
   * corresponde al modo elegido.
   */
  const resolver = useCallback(() => {
    const controlador = new AbortController()

    void apiPostJson(
      '/api/stream/resolve',
      { episodeRef: { providerId: props.providerId, value: props.ref }, mode: modo },
      streamResolveResponseSchema,
      { signal: controlador.signal },
    ).then(
      (salida) => {
        if (controlador.signal.aborted) return

        const primera = salida.sources[0]
        if (primera === undefined) {
          // Un proveedor que contesta sin fuentes no es un fallo de red: es que
          // ese sitio no tiene el episodio, y se cuenta como tal.
          setError(falloSinFuente(t(DEFAULT_LOCALE, 'player.noSource')))
          setEstado('error')

          return
        }

        setFuente({
          url: primera.url,
          kind: primera.kind,
          ...(primera.subtitles === undefined
            ? {}
            : { subtitles: primera.subtitles as readonly SubtitleCandidate[] }),
        })
        setEstado('ready')
      },
      (cause: unknown) => {
        if (controlador.signal.aborted) return

        setError(describirFallo(cause))
        setEstado('error')
      },
    )

    return controlador
  }, [props.providerId, props.ref, modo])

  useEffect(() => {
    const controlador = resolver()

    return () => controlador.abort()
  }, [resolver])

  const recargar = useCallback(() => {
    setEstado('loading')
    setError(undefined)
    resolver()
  }, [resolver])

  const posicionEpisodio = vecinos?.position

  /** Dónde se apunta el progreso de este episodio. */
  const claveProgreso = claveDeProgreso(props.providerId, props.ref)
  const navegar = useNavigate()

  /**
   * Apuntar por dónde va, sin apuntarlo en cada aviso.
   *
   * El elemento avisa cuatro veces por segundo: escribir el progreso con cada uno
   * serían cuatro escrituras por segundo en el almacén del navegador para un dato
   * que sólo hace falta cuando se vuelve. Se escribe cada cinco segundos, al
   * pausar y al salir, que es cuando de verdad importa.
   */
  const anotarProgreso = useCallback(
    (positionS: number, durationS: number, forzar: boolean) => {
      viva.current = { ...viva.current, positionS, durationS }

      const ahora = Date.now()
      if (!forzar && ahora - viva.current.ultimoGuardado < GUARDADO_MS) return

      viva.current = { ...viva.current, ultimoGuardado: ahora }
      guardarProgreso(almacenLocal(), claveProgreso, { positionS, durationS })
    },
    [claveProgreso],
  )

  // Al salir de la pantalla —o al cambiar de episodio— se apunta dónde se quedó:
  // es el momento en el que el dato sirve, y el último aviso puede ser de hace
  // cinco segundos.
  useEffect(() => {
    const referencia = viva

    return () => {
      const { positionS, durationS } = referencia.current
      if (durationS > 0) guardarProgreso(almacenLocal(), claveProgreso, { positionS, durationS })
    }
  }, [claveProgreso])

  /**
   * El episodio siguiente, cuando el actual termina.
   *
   * La tarjeta se ofrece con cuenta atrás y se puede parar: pasar solo al
   * siguiente es lo que se espera de una serie, pero sin preguntar sería quitarle
   * a alguien el mando. Y se puede apagar del todo desde los ajustes.
   */
  const [cuenta, setCuenta] = useState<number | undefined>(undefined)

  const opcionesDePaso: WatchPathOptions = { mode: modo, anime: animeValue }
  const siguiente = vecinos?.next
  const rutaSiguiente =
    siguiente === undefined
      ? undefined
      : watchPath(props.providerId, siguiente.ref.value, {
          ...opcionesDePaso,
          n: siguiente.number,
          ...(siguiente.season === undefined ? {} : { s: siguiente.season }),
        })

  const alTerminar = useCallback(() => {
    // El episodio está visto: lo apuntado a medias ya no sirve para reanudar.
    olvidarProgreso(almacenLocal(), claveProgreso)

    if (siguiente === undefined || !autoplay) return

    setCuenta(SEGUNDOS_DEL_SIGUIENTE)
  }, [autoplay, claveProgreso, siguiente])

  useEffect(() => {
    if (cuenta === undefined) return

    if (cuenta <= 0) {
      if (rutaSiguiente !== undefined) navegar.push(rutaSiguiente)

      return
    }

    const reloj = setTimeout(() => setCuenta((valor) => (valor ?? 1) - 1), 1000)

    return () => clearTimeout(reloj)
  }, [cuenta, rutaSiguiente, navegar])

  /**
   * El título propio del episodio, si lo trae.
   *
   * Hay proveedores cuyo nombre de episodio es otra vez el número —«Episodio 3»—,
   * así que repetirlo daría un «Episodio 3 de 12 · Episodio 3». Cuando el nombre ya
   * dice lo mismo que la etiqueta, no se pinta.
   */
  const tituloEpisodio = posicionEpisodio?.title?.trim() ?? ''
  const tituloUtil =
    tituloEpisodio === '' ||
    tituloEpisodio ===
      t(DEFAULT_LOCALE, 'player.episode', { number: posicionEpisodio?.number ?? 0 })
      ? undefined
      : tituloEpisodio

  /**
   * Cómo se llama el episodio que se está viendo.
   *
   * El número sale de los vecinos: con `?n=` es el de la dirección, y sin él el
   * que traía la primera página. Si esa lectura falla, la pantalla sigue
   * reproduciendo y la etiqueta se queda sin número: el episodio es un adorno del
   * título, no al revés.
   */
  const etiquetaEpisodio = episodeLabel(posicionEpisodio?.number, tituloUtil)

  /**
   * La línea del episodio, con el número una sola vez.
   *
   * Antes eran dos textos —«Episodio 3» encima y «Episodio 3 de 12» en medio de
   * las flechas— y el número se leía dos veces. Ahora es una línea: el episodio,
   * de cuántos es —si el proveedor lo dijo— y su título, si lo trae.
   */
  const lineaEpisodio =
    posicionEpisodio === undefined
      ? etiquetaEpisodio
      : composeTitle([
          posicionEpisodio.total === undefined
            ? t(DEFAULT_LOCALE, 'player.episode', { number: posicionEpisodio.number })
            : t(DEFAULT_LOCALE, 'player.episodeOf', {
                number: posicionEpisodio.number,
                total: posicionEpisodio.total,
              }),
          tituloUtil,
        ])

  // La pestaña y el encabezado dicen lo mismo: el nombre del título y por qué
  // episodio va. Es lo que distingue dos pestañas de la misma aplicación.
  useDocumentTitle(watchTitleParts(tituloAnime, etiquetaEpisodio))

  /**
   * El encabezado de la pantalla.
   *
   * Antes la pantalla de reproducción era el video y nada más: quien tenía dos
   * episodios abiertos no veía en ninguna parte qué estaba viendo. Va también en
   * los estados de carga y de error, que son justo en los que más falta hace
   * saber qué es lo que no se pudo abrir.
   *
   * El regreso a la ficha va aquí, con el encabezado, por la misma razón: es la
   * salida de la pantalla y tiene que estar en los tres estados. La cabecera de la
   * aplicación lleva a la home, no al título, así que sin este enlace la única
   * vuelta era el botón de atrás del navegador —que no se ve en una pantalla
   * pensada para verse a pantalla completa—. El título de la ficha es la
   * referencia que la dirección trae o la que se deduce del episodio: es la misma
   * que usa el registro del visionado, no una segunda conjetura.
   *
   * El nombre del título va en **una línea con puntos suspensivos**: es un
   * encabezado, no el contenido de la pantalla, y creciendo con el nombre más
   * largo empujaba el video fuera de la ventana.
   */
  const encabezado = (
    <header className="watch__head">
      <Link
        className="watch__back"
        to={buildPath('detail', { providerId: props.providerId, ref: animeRef.value })}
      >
        {t(DEFAULT_LOCALE, 'player.backToDetail')}
      </Link>
      <h1>{tituloAnime ?? t(DEFAULT_LOCALE, 'title.loading')}</h1>
      {lineaEpisodio === undefined ? null : <p className="watch__episode">{lineaEpisodio}</p>}
    </header>
  )

  /** El nombre del título y el episodio, para lo que no es texto de interfaz. */
  const nombreCompleto = composeTitle([tituloAnime, etiquetaEpisodio])

  /**
   * Las flechas de episodio.
   *
   * Van **debajo del video**, en la misma fila que el selector de audio: el salto
   * al episodio de al lado sigue estando a la vista al terminar uno, y el
   * encabezado se queda con lo que sólo se lee una vez.
   *
   * Cada una sólo es un enlace cuando existe ese episodio: en el primero no hay
   * flecha a la izquierda y en el último no la hay a la derecha. Cuando no existe,
   * el sitio no se queda con una flecha suelta: se pinta el mismo rótulo, apagado,
   * con `aria-disabled` y el `title` diciendo por qué no lleva a ninguna parte.
   *
   * El modo con el que se está viendo viaja en la dirección: si alguien cambió a
   * doblado, el episodio siguiente se abre doblado y no vuelve a preguntarlo. Y el
   * número viaja también, para que la pantalla que se abra no tenga que pedir la
   * lista entera para saber cuáles son **sus** vecinos.
   */
  const pasos = (
    <div className="watch__steps">
      {vecinos?.previous === undefined ? (
        <span
          className="watch__nav-off"
          aria-disabled="true"
          title={t(DEFAULT_LOCALE, 'player.firstEpisode')}
        >
          <EpisodeArrow towards="previous" />
          {t(DEFAULT_LOCALE, 'player.previous')}
        </span>
      ) : (
        <Link
          className="watch__nav-link"
          ariaLabel={t(DEFAULT_LOCALE, 'player.previousEpisode')}
          title={t(DEFAULT_LOCALE, 'player.previousEpisode')}
          to={watchPath(props.providerId, vecinos.previous.ref.value, {
            ...opcionesDePaso,
            n: vecinos.previous.number,
          })}
        >
          <EpisodeArrow towards="previous" />
          {t(DEFAULT_LOCALE, 'player.previous')}
        </Link>
      )}

      {vecinos?.next === undefined ? (
        <span
          className="watch__nav-off"
          aria-disabled="true"
          title={t(DEFAULT_LOCALE, 'player.lastEpisode')}
        >
          {t(DEFAULT_LOCALE, 'player.next')}
          <EpisodeArrow towards="next" />
        </span>
      ) : (
        <Link
          className="watch__nav-link"
          ariaLabel={t(DEFAULT_LOCALE, 'player.nextEpisode')}
          title={t(DEFAULT_LOCALE, 'player.nextEpisode')}
          to={watchPath(props.providerId, vecinos.next.ref.value, {
            ...opcionesDePaso,
            n: vecinos.next.number,
            ...(vecinos.next.season === undefined ? {} : { s: vecinos.next.season }),
          })}
        >
          {t(DEFAULT_LOCALE, 'player.next')}
          <EpisodeArrow towards="next" />
        </Link>
      )}
    </div>
  )

  /**
   * La fila de mandos bajo el reproductor.
   *
   * A la izquierda el salto de episodio y a la derecha la elección de audio, que
   * es lo que se cambia a menudo y por eso no vive dentro del menú de ajustes.
   * En la carga y en el error sólo van las flechas: el modo no resuelve nada
   * cuando no hay fuente.
   */
  const filaDeMandos = (conAudio: boolean): ReactNode => (
    <nav className="watch__nav" aria-label={t(DEFAULT_LOCALE, 'player.episodes')}>
      {pasos}
      {conAudio ? <AudioModeSwitch mode={modo} onMode={setModo} /> : null}
    </nav>
  )

  /**
   * La lista de episodios, en su columna.
   *
   * Va en los dos estados en los que hay algo que elegir: en el error es justo
   * cuando más falta hace —el episodio que no abre tiene al lado los que sí— y en
   * la reproducción es la forma de cambiar sin volver a la ficha. Pide sus páginas
   * ella misma, de cien en cien: esta pantalla no descarga la lista entera para
   * pintarla, que es lo que T92 vino a quitar.
   */
  const listaDeEpisodios = (
    <aside className="watch__aside">
      <WatchEpisodes
        providerId={props.providerId}
        titleRef={animeValue}
        currentRef={props.ref}
        mode={modo}
        actual={posicionEpisodio}
        // La temporada de la dirección, para que la fila del episodio suelto y
        // sus enlaces no pierdan la temporada que se está viendo.
        season={temporada}
        // El nombre del título, que es el respaldo del renglón cuando el
        // proveedor no nombra sus episodios: esta columna no tiene al lado el
        // encabezado de la pantalla, así que un renglón con sólo el número no
        // dice de qué serie es.
        animeTitle={tituloAnime}
      />
    </aside>
  )

  if (estado === 'loading') {
    return (
      <section className="watch">
        <div className="watch__layout">
          <div className="watch__main">
            {encabezado}
            <p className="empty">{t(DEFAULT_LOCALE, 'player.loading')}</p>
          </div>
        </div>
      </section>
    )
  }

  if (estado === 'error' || fuente === undefined) {
    return (
      <section className="watch">
        <div className="watch__layout">
          <div className="watch__main">
            {encabezado}
            <ErrorNotice fallo={error ?? FALLO_SIN_CAUSA} onRetry={recargar} />
            {filaDeMandos(false)}
          </div>
          {listaDeEpisodios}
        </div>
      </section>
    )
  }

  const pistas = toSafeTracks(tracksFromSource(fuente))

  return (
    <section className="watch">
      <div className="watch__layout">
        <div className="watch__main">
          {encabezado}

          {mpv.estado.kind === 'abierto' ? (
            <p className="watch__episode">{t(DEFAULT_LOCALE, 'player.mpv.opened')}</p>
          ) : null}

          {mpv.estado.kind === 'error' ? (
            <p className="search__error">
              {t(DEFAULT_LOCALE, 'player.mpv.error', { message: mpv.estado.mensaje })}
            </p>
          ) : null}

          <Player
            url={fuente.url}
            kind={fuente.kind}
            // El nombre del título, y no la referencia del episodio: `title` es la
            // etiqueta que lee un lector de pantalla y `aurora-nocturna#3` no es
            // cómo se llama nada. Sin nombre, `Player` pone la suya.
            title={nombreCompleto === '' ? undefined : nombreCompleto}
            poster={portada}
            tracks={pistas}
            // El modo de audio y el reproductor externo son de la pantalla, no
            // del elemento de video: el menú de ajustes del reproductor los
            // recibe para no tener una segunda copia del estado.
            mode={modo}
            onMode={setModo}
            onMpv={mpv.abrir}
            autoplay={autoplay}
            onAutoplay={cambiarAutoplay}
            startAtS={posicion}
            onPlay={visionado.onPlay}
            // Pausar es el otro momento en el que el dato importa —quien pausa
            // suele estar a punto de irse—, así que aquí se apunta sin esperar al
            // turno del guardado periódico.
            onPause={() => {
              anotarProgreso(viva.current.positionS, viva.current.durationS, true)
              visionado.onPause()
            }}
            onEnded={alTerminar}
            // La duración viaja al registro además de la posición: el servidor
            // calcula con ella la proporción vista, y sin duración todo visionado
            // valía cero y la fila de «continuar viendo» los descartaba a todos.
            onProgress={(positionS, durationS) => {
              setPosicion(positionS)
              visionado.onProgress(positionS, durationS)
              anotarProgreso(positionS, durationS, false)
            }}
          />

          {filaDeMandos(true)}

          {cuenta === undefined || rutaSiguiente === undefined ? null : (
            <div className="watch__next">
              <p className="watch__next-text">
                {t(DEFAULT_LOCALE, 'player.next.in', { seconds: cuenta })}
              </p>
              <Link className="button button--primary" to={rutaSiguiente}>
                {t(DEFAULT_LOCALE, 'player.next.now')}
              </Link>
              <button type="button" className="button" onClick={() => setCuenta(undefined)}>
                {t(DEFAULT_LOCALE, 'player.next.cancel')}
              </button>
            </div>
          )}
        </div>

        {listaDeEpisodios}
      </div>
    </section>
  )
}
