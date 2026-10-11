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
 * La lista de episodios se pide **sólo para saber quién va antes y quién
 * después**: sin ella no hay flechas, pero la reproducción no depende de esa
 * petición. Si falla, el episodio se ve igual y lo único que se pierde es el
 * salto al de al lado.
 */

import {
  animeResponseSchema,
  episodesResponseSchema,
  streamResolveResponseSchema,
} from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { Episode } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPostJson } from '../../api/client'
import { t } from '../../i18n'
import {
  composeTitle,
  episodeLabel,
  useDocumentTitle,
  watchTitleParts,
} from '../../lib/document-title'
import { Link, usePath } from '../../router'
import { Player } from './Player'
import { type SubtitleCandidate, toSafeTracks, tracksFromSource } from './subtitle-tracks'
import { useMpvHandoff } from './useMpvHandoff'
import { useWatchEvents } from './useWatchEvents'
import {
  animeRefFromPath,
  animeRefOf,
  episodePosition,
  modeFromPath,
  neighbourEpisodes,
  PLAY_MODES,
  startAtFromPath,
  watchPath,
} from './watch-route'

export interface WatchPageProps {
  readonly providerId: string
  readonly ref: string
}

type Estado = 'loading' | 'ready' | 'error'

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
  const [error, setError] = useState<string | undefined>(undefined)
  const [episodios, setEpisodios] = useState<readonly Episode[]>([])
  // El nombre del título. La dirección del reproductor sólo lleva la referencia
  // del episodio, así que sin esta petición la pantalla no sabe cómo se llama lo
  // que está reproduciendo y la pestaña sólo puede decir «Ep. 3».
  const [tituloAnime, setTituloAnime] = useState<string | undefined>(undefined)

  // Los episodios del título, para las flechas de al lado. La petición se
  // cancela al desmontar y su fallo no se pinta: una flecha que no aparece es
  // una molestia, un error encima del video que sí se ve es otra cosa.
  useEffect(() => {
    let vivo = true

    void apiGet(
      `/api/anime/${encodeURIComponent(props.providerId)}/${encodeURIComponent(animeRef.value)}/episodes`,
      episodesResponseSchema,
    ).then(
      (lista) => {
        if (vivo) setEpisodios(lista.episodes)
      },
      () => {
        if (vivo) setEpisodios([])
      },
    )

    return () => {
      vivo = false
    }
  }, [props.providerId, animeRef.value])

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
          setError('el proveedor no dio ninguna fuente')
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

        setError(cause instanceof Error ? cause.message : String(cause))
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

  const vecinos = neighbourEpisodes(episodios, props.providerId, props.ref)
  const posicionEpisodio = episodePosition(episodios, props.providerId, props.ref)

  /**
   * Cómo se llama el episodio que se está viendo.
   *
   * El número sale de la lista de episodios, que es la misma petición que dibuja
   * las flechas. Si esa petición falla, la pantalla sigue reproduciendo y la
   * etiqueta se queda con el nombre que el proveedor le haya dado: el episodio
   * es un adorno del título, no al revés.
   */
  const episodioActual = episodios.find((episodio) => episodio.ref.value === props.ref)
  const etiquetaEpisodio = episodeLabel(
    posicionEpisodio?.number ?? episodioActual?.number,
    episodioActual?.title,
  )

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
   */
  const encabezado = (
    <header>
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
   * doblado, el episodio siguiente se abre doblado y no vuelve a preguntarlo.
   */
  const navegacion = (
    <nav className="watch__nav" aria-label={t(DEFAULT_LOCALE, 'player.episodes')}>
      {vecinos.previous === undefined ? (
        <span className="watch__nav-off" title={t(DEFAULT_LOCALE, 'player.firstEpisode')}>
          <EpisodeArrow towards="previous" />
          {t(DEFAULT_LOCALE, 'player.previousEpisode')}
        </span>
      ) : (
        <Link
          className="watch__nav-link"
          title={t(DEFAULT_LOCALE, 'player.previousEpisode')}
          to={watchPath(props.providerId, vecinos.previous.value, {
            mode: modo,
            anime: animeValue,
          })}
        >
          <EpisodeArrow towards="previous" />
          {t(DEFAULT_LOCALE, 'player.previousEpisode')}
        </Link>
      )}

      {posicionEpisodio === undefined ? null : (
        <span className="watch__nav-pos">
          {t(DEFAULT_LOCALE, 'player.episodeOf', {
            number: posicionEpisodio.number,
            total: posicionEpisodio.total,
          })}
        </span>
      )}

      {vecinos.next === undefined ? (
        <span className="watch__nav-off" title={t(DEFAULT_LOCALE, 'player.lastEpisode')}>
          {t(DEFAULT_LOCALE, 'player.nextEpisode')}
          <EpisodeArrow towards="next" />
        </span>
      ) : (
        <Link
          className="watch__nav-link"
          title={t(DEFAULT_LOCALE, 'player.nextEpisode')}
          to={watchPath(props.providerId, vecinos.next.value, {
            mode: modo,
            anime: animeValue,
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
        <p className="search__error">
          {t(DEFAULT_LOCALE, 'player.error', { message: error ?? '' })}
        </p>
        <button type="button" className="button" onClick={recargar}>
          {t(DEFAULT_LOCALE, 'detail.retry')}
        </button>
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
