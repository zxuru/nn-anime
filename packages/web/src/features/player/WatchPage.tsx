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

import { episodesResponseSchema, streamResolveResponseSchema } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { Episode } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPostJson } from '../../api/client'
import { t } from '../../i18n'
import { Link, usePath } from '../../router'
import { Player } from './Player'
import { type SubtitleCandidate, toSafeTracks, tracksFromSource } from './subtitle-tracks'
import { useMpvHandoff } from './useMpvHandoff'
import { useWatchEvents } from './useWatchEvents'
import {
  animeRefOf,
  episodePosition,
  modeFromPath,
  neighbourEpisodes,
  PLAY_MODES,
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
  const [posicion, setPosicion] = useState(0)

  // El registro del visionado: alta al reproducir de verdad, avance cada 15 s y
  // al pausar, y la posición final al desmontar o cerrar la pestaña.
  //
  // El título y el episodio son dos referencias distintas: la de la dirección es
  // la del episodio y la del título se deduce de ella. Mandar la del episodio en
  // los dos campos hacía que el alta de visionado no encontrara el título y
  // respondiera 404, así que «continuar viendo» nunca se llenaba.
  const animeRef = { providerId: props.providerId, value: animeRefOf(props.ref) }
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
          to={watchPath(props.providerId, vecinos.previous.value, modo)}
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
          to={watchPath(props.providerId, vecinos.next.value, modo)}
        >
          {t(DEFAULT_LOCALE, 'player.nextEpisode')}
          <EpisodeArrow towards="next" />
        </Link>
      )}
    </nav>
  )

  if (estado === 'loading') {
    return <p className="empty">{t(DEFAULT_LOCALE, 'player.loading')}</p>
  }

  if (estado === 'error' || fuente === undefined) {
    return (
      <section>
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
        title={props.ref}
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
