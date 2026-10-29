/**
 * El reproductor de una descarga.
 *
 * Es una pantalla propia y no un enlace a la ficha porque lo descargado tiene
 * que verse **sin el proveedor**: si el plugin se desinstaló o no hay red, el
 * archivo sigue en el equipo y la aplicación lo sirve por su id. La ficha sigue
 * siendo el sitio para ver la serie entera; aquí se abre un episodio concreto.
 *
 * La fuente es la misma ruta que usa el reproductor de la ficha cuando encuentra
 * una copia local —`/api/downloads/:id/file`—, así que los segmentos y los MP4
 * se tratan igual que allí: el servidor decide qué sirve y con qué rangos.
 */

import { downloadItemSchema } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { apiGet } from '../../api/client'
import { describirFallo } from '../../api/fallo'
import { t } from '../../i18n'
import { Link } from '../../router'
import { Player } from '../player/Player'
import { coverPath } from '../search/ResultCard'
import type { Descarga } from './biblioteca'

const LOCALE = DEFAULT_LOCALE

type Estado = 'loading' | 'ready' | 'error'

export function LibraryPlayerPage(props: { readonly id: string }): ReactNode {
  const id = Number(props.id)
  const valido = Number.isInteger(id) && id > 0
  const [item, setItem] = useState<Descarga | undefined>()
  const [estado, setEstado] = useState<Estado>(valido ? 'loading' : 'error')
  const [error, setError] = useState<string | undefined>(
    valido ? undefined : t(LOCALE, 'library.player.invalid'),
  )

  useEffect(() => {
    if (!valido) return undefined

    const controlador = new AbortController()

    apiGet(`/api/downloads/${id}`, downloadItemSchema, {
      signal: controlador.signal,
    }).then(
      (descarga) => {
        if (controlador.signal.aborted) return

        setItem(descarga)
        if (descarga.status === 'complete') {
          setEstado('ready')
          setError(undefined)
          return
        }

        setEstado('error')
        setError(t(LOCALE, 'library.player.notReady'))
      },
      (cause: unknown) => {
        if (controlador.signal.aborted) return

        const fallo = describirFallo(cause)
        setError(fallo.detalle ?? fallo.tecnico)
        setEstado('error')
      },
    )

    return () => controlador.abort()
  }, [id, valido])

  return (
    <section className="library-player">
      <header className="library-player__head">
        <Link className="library-player__back" to="/library">
          {t(LOCALE, 'library.player.back')}
        </Link>
        <div className="library-player__titles">
          <h1>{item?.title ?? t(LOCALE, 'library.playerTitle')}</h1>
          {item === undefined ? null : (
            <p className="library-player__episode">{item.episodeLabel}</p>
          )}
        </div>
        <span className="library-player__badge">{t(LOCALE, 'library.downloaded')}</span>
      </header>

      {estado === 'loading' ? (
        <p className="library-player__loading">{t(LOCALE, 'library.player.loading')}</p>
      ) : null}

      {estado === 'error' ? (
        <div className="library-player__error" role="alert">
          <p>
            {t(LOCALE, 'library.player.error', {
              message: error ?? t(LOCALE, 'library.player.invalid'),
            })}
          </p>
          <Link className="button" to="/library">
            {t(LOCALE, 'library.player.back')}
          </Link>
        </div>
      ) : null}

      {estado === 'ready' && item !== undefined ? (
        <>
          <Player
            url={`/api/downloads/${item.id}/file`}
            kind={item.kind === 'segments' ? 'hls' : 'file'}
            title={`${item.title} · ${item.episodeLabel}`}
            poster={coverPath(item.providerId, item.animeRef.value)}
          />
          <p className="library-player__note">{t(LOCALE, 'library.player.offline')}</p>
        </>
      ) : null}
    </section>
  )
}
