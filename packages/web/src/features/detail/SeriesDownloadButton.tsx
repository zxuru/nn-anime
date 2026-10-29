/**
 * El botón que apunta la serie entera.
 *
 * No elige capítulos ni manda una lista: manda el título y el servidor lee sus
 * episodios, los ordena y los encola uno por uno. La respuesta cuenta lo que
 * quedó apuntado, y con eso se dice si la serie ya estaba descargada o cuántos
 * capítulos esperan turno. Volver a pulsarlo es seguro: el alta es idempotente
 * por episodio.
 *
 * La descarga no es un permiso de la fuente —la hace la aplicación resolviendo
 * el mismo stream de la reproducción—, así que el botón no consulta
 * `capabilities.download` ni nace deshabilitado por lo que declare el plugin.
 */

import type { DownloadSeriesResponse } from '@nn-anime/core/api'
import { downloadSeriesResponseSchema } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ProviderRef } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { apiPostJson } from '../../api/client'
import { t } from '../../i18n'
import { Link } from '../../router'

const LOCALE = DEFAULT_LOCALE

export interface SeriesDownloadButtonProps {
  readonly providerId: string
  readonly animeRef: ProviderRef
  /** Una película no tiene serie: el rótulo dice lo que de verdad se apunta. */
  readonly movie?: boolean
}

type Estado = 'listo' | 'enviando' | 'hecho' | 'error'

export interface BotonDeSerieProps {
  readonly estado: Estado
  readonly respuesta?: DownloadSeriesResponse | undefined
  readonly mensaje?: string | undefined
  readonly movie?: boolean
  readonly onDescargar: () => void
}

/**
 * Lo que se lee debajo del botón, o nada mientras no haya nada que contar.
 *
 * Se distinguen tres desenlaces porque los tres piden cosas distintas: lo que
 * espera turno se va a bajar solo, lo completo no hay que tocarlo y lo que quedó
 * a medias se mira en la biblioteca. Un «hecho» para todo eso dejaría al usuario
 * sin saber si tiene que hacer algo.
 */
export function textoDeSerie(
  estado: Estado,
  respuesta: DownloadSeriesResponse | undefined,
  mensaje: string | undefined,
): string | undefined {
  if (estado === 'enviando') return t(LOCALE, 'detail.download.sending')
  if (estado === 'error') {
    return t(LOCALE, 'detail.download.failed', { message: mensaje ?? '' })
  }
  if (estado !== 'hecho' || respuesta === undefined) return undefined
  if (respuesta.episodes === 0) return t(LOCALE, 'detail.download.empty')
  if (respuesta.pending > 0) {
    return t(LOCALE, 'detail.download.queued', {
      pending: respuesta.pending,
      episodes: respuesta.episodes,
    })
  }
  if (respuesta.complete === respuesta.episodes) return t(LOCALE, 'detail.download.done')

  return t(LOCALE, 'detail.download.partial', {
    complete: respuesta.complete,
    episodes: respuesta.episodes,
  })
}

/**
 * El botón sin red ni estado, para poder medirlo en cualquier desenlace.
 *
 * Mientras envía se cierra para no pedir dos veces; un fallo no, porque volver a
 * pulsar es el reintento y el motivo está escrito debajo.
 */
export function BotonDeSerie(props: BotonDeSerieProps): ReactNode {
  const texto = textoDeSerie(props.estado, props.respuesta, props.mensaje)
  const etiqueta =
    props.movie === true ? t(LOCALE, 'detail.download.movie') : t(LOCALE, 'detail.download.series')

  return (
    <div className="detail__download">
      <button
        type="button"
        className="button"
        disabled={props.estado === 'enviando'}
        onClick={props.onDescargar}
      >
        {etiqueta}
      </button>

      {texto === undefined ? null : (
        <p className="field__hint" role={props.estado === 'error' ? 'alert' : 'status'}>
          {texto}
        </p>
      )}

      {props.estado === 'hecho' ? (
        <Link className="detail__download-link" to="/library">
          {t(LOCALE, 'detail.download.library')}
        </Link>
      ) : null}
    </div>
  )
}

export function SeriesDownloadButton(props: SeriesDownloadButtonProps): ReactNode {
  const [estado, setEstado] = useState<Estado>('listo')
  const [respuesta, setRespuesta] = useState<DownloadSeriesResponse | undefined>()
  const [mensaje, setMensaje] = useState<string | undefined>()

  const descargar = async (): Promise<void> => {
    setEstado('enviando')
    setMensaje(undefined)
    try {
      const salida = await apiPostJson(
        '/api/downloads/series',
        { providerId: props.providerId, animeRef: props.animeRef },
        downloadSeriesResponseSchema,
      )
      setRespuesta(salida)
      setEstado('hecho')
      // El clic es el gesto que el navegador exige para pedir el permiso; si ya
      // está decidido, no se vuelve a preguntar. Es la misma regla que el botón
      // de un episodio.
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        void Notification.requestPermission()
      }
    } catch (cause) {
      setEstado('error')
      setMensaje(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <BotonDeSerie
      estado={estado}
      {...(respuesta === undefined ? {} : { respuesta })}
      {...(mensaje === undefined ? {} : { mensaje })}
      {...(props.movie === true ? { movie: true } : {})}
      onDescargar={() => void descargar()}
    />
  )
}
