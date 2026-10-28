/**
 * El botón de descargar de un episodio.
 *
 * No le pregunta nada a la fuente. Descargar no es un permiso que ella conceda:
 * lo hace la aplicación, que resuelve el mismo stream que la reproducción —un
 * archivo directo o un HLS— y lo baja a la carpeta de descargas. Por eso el botón
 * está siempre que hay episodio, declare lo que declare el plugin.
 *
 * Lo que falle se cuenta en el `title` del botón —el tooltip del navegador— y no
 * en un párrafo al lado: el botón vive anclado al encabezado del reproductor y un
 * texto de error ahí empujaba la sala, que se mide contra el alto de la ventana.
 * Para quien no ve el tooltip, el mismo texto va en un `solo-lectores`.
 */

import { downloadStartResponseSchema } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ProviderRef } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { apiPostJson } from '../../api/client'
import { t } from '../../i18n'

const LOCALE = DEFAULT_LOCALE

export interface DownloadButtonProps {
  readonly providerId: string
  readonly animeRef: ProviderRef
  readonly episodeRef: ProviderRef
}

type Estado = 'listo' | 'guardando' | 'hecho' | 'error'

export interface BotonDeDescargaProps {
  readonly estado: Estado
  readonly mensaje?: string | undefined
  readonly onDescargar: () => void
}

/**
 * El botón sin estado ni red, para poder medirlo en cualquier estado.
 *
 * Un fallo no lo deshabilita: volver a pulsar es el reintento, y el motivo espera
 * en el tooltip. Sólo se cierra mientras guarda —para no pedir dos veces— y una
 * vez en cola, porque la descarga ya está apuntada.
 */
export function BotonDeDescarga(props: BotonDeDescargaProps): ReactNode {
  const etiqueta =
    props.estado === 'hecho'
      ? t(LOCALE, 'downloads.queued')
      : props.estado === 'guardando'
        ? t(LOCALE, 'downloads.saving')
        : t(LOCALE, 'downloads.download')

  return (
    <div className="downloads__button">
      <button
        type="button"
        className="button"
        title={props.mensaje}
        disabled={props.estado === 'guardando' || props.estado === 'hecho'}
        onClick={props.onDescargar}
      >
        {etiqueta}
      </button>
      {props.mensaje === undefined ? null : (
        <span className="solo-lectores" role="alert">
          {props.mensaje}
        </span>
      )}
    </div>
  )
}

export function DownloadButton(props: DownloadButtonProps): ReactNode {
  const [estado, setEstado] = useState<Estado>('listo')
  const [mensaje, setMensaje] = useState<string | undefined>()

  const descargar = async (): Promise<void> => {
    setEstado('guardando')
    setMensaje(undefined)
    try {
      await apiPostJson(
        '/api/downloads',
        {
          providerId: props.providerId,
          animeRef: props.animeRef,
          episodeRef: props.episodeRef,
        },
        downloadStartResponseSchema,
      )
      // El clic es el gesto que el navegador exige para pedir el permiso; si ya
      // está decidido, no se vuelve a preguntar.
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        void Notification.requestPermission()
      }
      setEstado('hecho')
    } catch (cause) {
      setEstado('error')
      setMensaje(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <BotonDeDescarga
      estado={estado}
      {...(mensaje === undefined ? {} : { mensaje })}
      onDescargar={() => void descargar()}
    />
  )
}
