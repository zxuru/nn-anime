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
 */

import {
  animeResponseSchema,
  type EpisodesResponse,
  streamResolveResponseSchema,
} from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { Episode } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
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
import { buildPath, Link, usePath } from '../../router'
import {
  type EpisodeLookup,
  type EpisodeReads,
  loadEpisodeByNumber,
  loadEpisodesPage,
} from '../detail/useDetail'
import { Player } from './Player'
import { type SubtitleCandidate, toSafeTracks, tracksFromSource } from './subtitle-tracks'
import { useMpvHandoff } from './useMpvHandoff'
import { useWatchEvents } from './useWatchEvents'
import {
  animeRefFromPath,
  animeRefOf,
  type EpisodeRef,
  modeFromPath,
  numberFromPath,
  PLAY_MODES,
  startAtFromPath,
  watchPath,
} from './watch-route'

export interface WatchPageProps {
  readonly providerId: string
  readonly ref: string
}

type Estado = 'loading' | 'ready' | 'error'

/** Un vecino, con lo que hace falta para enlazarlo: a dónde va y con qué número. */
export interface WatchNeighbour {
  readonly ref: EpisodeRef
  readonly number: number
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
  return episode === undefined ? undefined : { ref: episode.ref, number: episode.number }
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
): Promise<{
  readonly previous: WatchNeighbour | undefined
  readonly next: WatchNeighbour | undefined
  readonly total: number | undefined
}> {
  let siguiente = propios[indice + 1]
  let total = pagina.total

  if (siguiente === undefined && pagina.hasMore) {
    const segunda = await loadEpisodesPage(providerId, titleRef, 2, reads)
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
): Promise<WatchNeighbours> {
  const pagina = await loadEpisodesPage(providerId, titleRef, 1, reads).catch(() => undefined)
  const propios = pagina === undefined ? [] : delProveedor(pagina.episodes, providerId)
  const actual = propios.find((episode) => episode.ref.value === episodeRef)

  if (pagina !== undefined && actual !== undefined) {
    const indice = propios.indexOf(actual)
    const { previous, next, total } = await neighboursInPage(
      propios,
      indice,
      pagina,
      providerId,
      titleRef,
      reads,
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
    number > 1 ? loadEpisodeByNumber(providerId, titleRef, number - 1, reads) : undefined,
    loadEpisodeByNumber(providerId, titleRef, number + 1, reads),
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
  const { providerId, titleRef, episodeRef, number } = lookup

  if (number !== undefined) {
    return neighboursWithNumber(providerId, titleRef, episodeRef, number, reads)
  }

  const pagina = await loadEpisodesPage(providerId, titleRef, 1, reads)
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
  // El segundo donde se dejó, si la dirección lo trae: la tarjeta de «continuar
  // viendo» lo pone en su enlace. Arrancar aquí y no en el cero es lo que hace
  // que la fila sirva para seguir viendo y no para volver a empezar.
  const [posicion, setPosicion] = useState(() => startAtFromPath(path) ?? 0)

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

  // El número que la dirección trae escrito. Es lo que decide si se piden dos
  // vecinos puntuales o la primera página; sin él no se deduce nada.
  const numero = numberFromPath(path)

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
  }, [props.providerId, props.ref, animeRef.value, numero, estado])

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
        if (vivo) setTituloAnime(detalle.title)
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

  /**
   * Cómo se llama el episodio que se está viendo.
   *
   * El número sale de los vecinos: con `?n=` es el de la dirección, y sin él el
   * que traía la primera página. Si esa lectura falla, la pantalla sigue
   * reproduciendo y la etiqueta se queda sin número: el episodio es un adorno del
   * título, no al revés.
   */
  const etiquetaEpisodio = episodeLabel(posicionEpisodio?.number, posicionEpisodio?.title)

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
   */
  const encabezado = (
    <header>
      <Link
        className="watch__back"
        to={buildPath('detail', { providerId: props.providerId, ref: animeRef.value })}
      >
        {t(DEFAULT_LOCALE, 'player.backToDetail')}
      </Link>
      <h1>{tituloAnime ?? t(DEFAULT_LOCALE, 'title.loading')}</h1>
      {etiquetaEpisodio === undefined ? null : <p className="card__meta">{etiquetaEpisodio}</p>}
    </header>
  )

  /** El nombre del título y el episodio, para lo que no es texto de interfaz. */
  const nombreCompleto = composeTitle([tituloAnime, etiquetaEpisodio])

  /**
   * Las flechas de episodio.
   *
   * Van **encima del video** para que se vean sin bajar, y cada una sólo es un
   * enlace cuando existe ese episodio: en el primero no hay flecha a la
   * izquierda y en el último no la hay a la derecha.
   *
   * Cuando no existe, el sitio no se queda con una flecha suelta: se pinta el
   * mismo rótulo, apagado y con el borde discontinuo, y el `title` dice por qué
   * no lleva a ninguna parte. Una flecha diminuta sin texto no explica nada, y
   * quien la ve por primera vez cree que la aplicación está rota.
   *
   * En medio va el episodio que se está viendo, de cuántos: es lo que convierte
   * dos botones en los extremos de una fila vacía en algo que se entiende de un
   * vistazo, y lo que hace evidente que la flecha apagada es un límite y no un
   * fallo.
   *
   * El modo con el que se está viendo viaja en la dirección: si alguien cambió a
   * doblado, el episodio siguiente se abre doblado y no vuelve a preguntarlo. Y el
   * número viaja también, para que la pantalla que se abra no tenga que pedir la
   * lista entera para saber cuáles son **sus** vecinos.
   */
  const navegacion = (
    <nav className="watch__nav" aria-label={t(DEFAULT_LOCALE, 'player.episodes')}>
      {vecinos?.previous === undefined ? (
        <span className="watch__nav-off" title={t(DEFAULT_LOCALE, 'player.firstEpisode')}>
          <EpisodeArrow towards="previous" />
          {t(DEFAULT_LOCALE, 'player.previousEpisode')}
        </span>
      ) : (
        <Link
          className="watch__nav-link"
          title={t(DEFAULT_LOCALE, 'player.previousEpisode')}
          to={watchPath(props.providerId, vecinos.previous.ref.value, {
            mode: modo,
            anime: animeValue,
            n: vecinos.previous.number,
          })}
        >
          <EpisodeArrow towards="previous" />
          {t(DEFAULT_LOCALE, 'player.previousEpisode')}
        </Link>
      )}

      {posicionEpisodio === undefined ? null : (
        <span className="watch__nav-pos">
          {/* Con total se dice «de 26»; sin él, sólo el número. El total de un
              episodio suelto no lo trae nadie, así que inventarlo sería mentir
              sobre cuánto queda. */}
          {posicionEpisodio.total === undefined
            ? t(DEFAULT_LOCALE, 'player.episode', { number: posicionEpisodio.number })
            : t(DEFAULT_LOCALE, 'player.episodeOf', {
                number: posicionEpisodio.number,
                total: posicionEpisodio.total,
              })}
        </span>
      )}

      {vecinos?.next === undefined ? (
        <span className="watch__nav-off" title={t(DEFAULT_LOCALE, 'player.lastEpisode')}>
          {t(DEFAULT_LOCALE, 'player.nextEpisode')}
          <EpisodeArrow towards="next" />
        </span>
      ) : (
        <Link
          className="watch__nav-link"
          title={t(DEFAULT_LOCALE, 'player.nextEpisode')}
          to={watchPath(props.providerId, vecinos.next.ref.value, {
            mode: modo,
            anime: animeValue,
            n: vecinos.next.number,
          })}
        >
          {t(DEFAULT_LOCALE, 'player.nextEpisode')}
          <EpisodeArrow towards="next" />
        </Link>
      )}
    </nav>
  )

  if (estado === 'loading') {
    return (
      <section className="watch">
        {encabezado}
        <p className="empty">{t(DEFAULT_LOCALE, 'player.loading')}</p>
      </section>
    )
  }

  if (estado === 'error' || fuente === undefined) {
    return (
      <section className="watch">
        {encabezado}
        {navegacion}
        <ErrorNotice fallo={error ?? FALLO_SIN_CAUSA} onRetry={recargar} />
      </section>
    )
  }

  const pistas = toSafeTracks(tracksFromSource(fuente))

  return (
    <section className="watch">
      {encabezado}
      {navegacion}

      <div className="watch__modes">
        <button type="button" className="button" onClick={mpv.abrir}>
          {t(DEFAULT_LOCALE, 'player.mpv')}
        </button>
        <span className="card__meta">{t(DEFAULT_LOCALE, 'player.mode')}</span>
        {PLAY_MODES.map((candidato) => (
          <button
            key={candidato}
            type="button"
            className="button"
            aria-pressed={modo === candidato}
            onClick={() => setModo(candidato)}
          >
            {t(DEFAULT_LOCALE, candidato === 'sub' ? 'player.mode.sub' : 'player.mode.dub')}
          </button>
        ))}
      </div>

      {mpv.estado.kind === 'abierto' ? (
        <p className="card__meta">{t(DEFAULT_LOCALE, 'player.mpv.opened')}</p>
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
        tracks={pistas}
        startAtS={posicion}
        onPlay={visionado.onPlay}
        onPause={visionado.onPause}
        // La duración viaja al registro además de la posición: el servidor
        // calcula con ella la proporción vista, y sin duración todo visionado
        // valía cero y la fila de «continuar viendo» los descartaba a todos.
        onProgress={(positionS, durationS) => {
          setPosicion(positionS)
          visionado.onProgress(positionS, durationS)
        }}
      />
    </section>
  )
}
