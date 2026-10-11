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
import { useWatchEvents } from './useWatchEvents'
import { animeRefOf, modeFromPath, neighbourEpisodes, PLAY_MODES, watchPath } from './watch-route'

export interface WatchPageProps {
  readonly providerId: string
  readonly ref: string
}

type Estado = 'loading' | 'ready' | 'error'

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
  const [estado, setEstado] = useState<Estado>('loading')
  const [error, setError] = useState<string | undefined>(undefined)
  const [intento, setIntento] = useState(0)
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

  const recargar = useCallback(() => {
    setEstado('loading')
    setError(undefined)
    setIntento((valor) => valor + 1)
  }, [])

  useEffect(() => {
    let vivo = true

    void apiPostJson(
      '/api/stream/resolve',
      { episodeRef: { providerId: props.providerId, value: props.ref }, mode: modo },
      streamResolveResponseSchema,
    ).then(
      (salida) => {
        if (!vivo) return

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
        if (!vivo) return

        setError(cause instanceof Error ? cause.message : String(cause))
        setEstado('error')
      },
    )

    return () => {
      vivo = false
    }
  }, [props.providerId, props.ref, intento, modo])

  const vecinos = neighbourEpisodes(episodios, props.providerId, props.ref)

  /**
   * Las flechas de episodio.
   *
   * Van **encima del video** para que se vean sin bajar, y cada una sólo es un
   * enlace cuando existe ese episodio: en el primero no hay flecha a la
   * izquierda y en el último no la hay a la derecha. El hueco se deja con una
   * flecha apagada, para que la fila no baile al saltar de un episodio a otro.
   *
   * El modo con el que se está viendo viaja en la dirección: si alguien cambió a
   * doblado, el episodio siguiente se abre doblado y no vuelve a preguntarlo.
   */
  const navegacion = (
    <nav className="watch__nav" aria-label={t(DEFAULT_LOCALE, 'player.episodes')}>
      {vecinos.previous === undefined ? (
        <span className="watch__nav-off" aria-hidden="true">
          ←
        </span>
      ) : (
        <Link
          className="watch__nav-link"
          title={t(DEFAULT_LOCALE, 'player.previousEpisode')}
          to={watchPath(props.providerId, vecinos.previous.value, modo)}
        >
          <span aria-hidden="true">←</span>
          {t(DEFAULT_LOCALE, 'player.previousEpisode')}
        </Link>
      )}
      {vecinos.next === undefined ? (
        <span className="watch__nav-off" aria-hidden="true">
          →
        </span>
      ) : (
        <Link
          className="watch__nav-link"
          title={t(DEFAULT_LOCALE, 'player.nextEpisode')}
          to={watchPath(props.providerId, vecinos.next.value, modo)}
        >
          {t(DEFAULT_LOCALE, 'player.nextEpisode')}
          <span aria-hidden="true">→</span>
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

      <Player
        url={fuente.url}
        kind={fuente.kind}
        title={props.ref}
        tracks={pistas}
        startAtS={posicion}
        onPlay={visionado.onPlay}
        onPause={visionado.onPause}
        onProgress={(positionS) => {
          setPosicion(positionS)
          visionado.onProgress(positionS, 0)
        }}
      />
    </section>
  )
}
