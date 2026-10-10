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
 */

import { streamResolveResponseSchema } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { apiPostJson } from '../../api/client'
import { t } from '../../i18n'
import { Player } from './Player'
import { type SubtitleCandidate, toSafeTracks, tracksFromSource } from './subtitle-tracks'
import { useWatchEvents } from './useWatchEvents'

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
  const [modo, setModo] = useState<'sub' | 'dub'>('sub')
  const [posicion, setPosicion] = useState(0)

  // El registro del visionado: alta al reproducir de verdad, avance cada 15 s y
  // al pausar, y la posición final al desmontar o cerrar la pestaña.
  const visionado = useWatchEvents({
    animeRef: { providerId: props.providerId, value: props.ref },
    episodeRef: { providerId: props.providerId, value: props.ref },
    mode: modo,
    startAtS: posicion,
  })
  const [estado, setEstado] = useState<Estado>('loading')
  const [error, setError] = useState<string | undefined>(undefined)
  const [intento, setIntento] = useState(0)

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

  if (estado === 'loading') {
    return <p className="empty">{t(DEFAULT_LOCALE, 'player.loading')}</p>
  }

  if (estado === 'error' || fuente === undefined) {
    return (
      <section>
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
      <div className="watch__modes">
        <span className="card__meta">{t(DEFAULT_LOCALE, 'player.mode')}</span>
        {(['sub', 'dub'] as const).map((candidato) => (
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
