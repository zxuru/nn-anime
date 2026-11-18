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
 *
 * **El audio se elige antes de apuntar nada.** Es el mismo conmutador que el
 * episodio y el reproductor: si la fuente declara sub y dub, se pregunta; con una
 * sola capacidad se manda la que hay. La elección vale para todos los capítulos,
 * que es lo que significa «descargar la serie».
 */

import type { DownloadSeriesResponse } from '@rona/core/api'
import { downloadSeriesResponseSchema } from '@rona/core/api'
import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { ProviderRef } from '@rona/core/models'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { apiPostJson } from '../../api/client'
import { t } from '../../i18n'
import { Link } from '../../router'
import { modoDeAudio, useModosDelProveedor } from '../downloads/DownloadButton'
import { AudioModeSwitch } from '../player/AudioModeSwitch'
import type { PlayMode } from '../player/watch-route'

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
  /** Las capacidades de audio de la fuente. Con una sola no se pregunta. */
  readonly modes?: readonly PlayMode[] | undefined
  readonly mode?: PlayMode | undefined
  readonly onMode?: ((mode: PlayMode) => void) | undefined
  readonly onDescargar: () => void
}

/**
 * El cuerpo del alta de la serie.
 *
 * Manda el modo elegido, igual que el alta de un episodio: el servidor lo
 * guarda por capítulo y el motor resuelve con él. Sin `mode`, el contrato pone
 * `sub`, que es lo que hacía antes de que se pudiera elegir.
 */
export function peticionDeSerie(
  props: SeriesDownloadButtonProps,
  mode: PlayMode,
): { readonly providerId: string; readonly animeRef: ProviderRef; readonly mode: PlayMode } {
  return { providerId: props.providerId, animeRef: props.animeRef, mode }
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
      {props.mode !== undefined && props.onMode !== undefined && (props.modes?.length ?? 0) > 1 ? (
        <AudioModeSwitch
          mode={props.mode}
          onMode={props.onMode}
          label={t(LOCALE, 'detail.download.audio')}
        />
      ) : null}
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
  const [preferido, setPreferido] = useState<PlayMode | undefined>()
  const modos = useModosDelProveedor(props.providerId)
  const modo = modoDeAudio(modos, preferido)

  const descargar = async (): Promise<void> => {
    setEstado('enviando')
    setMensaje(undefined)
    try {
      const salida = await apiPostJson(
        '/api/downloads/series',
        peticionDeSerie(props, modo),
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
      modes={modos}
      mode={modo}
      onMode={setPreferido}
      onDescargar={() => void descargar()}
    />
  )
}
