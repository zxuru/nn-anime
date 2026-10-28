/**
 * El botón de descargar de un episodio.
 *
 * Sólo aparece si la fuente declara `capabilities.download`; una fuente que no
 * lo declara no ofrece un botón que va a contestar 400. La capacidad se pide una
 * vez por montaje y no se cachea más: es barata y cambia al recargar plugins.
 */

import { downloadStartResponseSchema, providersResponseSchema } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ProviderRef } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { apiGet, apiPostJson } from '../../api/client'
import { t } from '../../i18n'

const LOCALE = DEFAULT_LOCALE

export interface DownloadButtonProps {
  readonly providerId: string
  readonly animeRef: ProviderRef
  readonly episodeRef: ProviderRef
}

type Estado = 'comprobando' | 'listo' | 'guardando' | 'hecho' | 'error'

export function DownloadButton(props: DownloadButtonProps): ReactNode {
  const [estado, setEstado] = useState<Estado>('comprobando')
  const [mensaje, setMensaje] = useState<string | undefined>()

  useEffect(() => {
    let vivo = true

    void apiGet('/api/providers', providersResponseSchema)
      .then((respuesta) => {
        if (!vivo) return
        const fuente = respuesta.providers.find((item) => item.id === props.providerId)
        setEstado(fuente?.capabilities.download === true ? 'listo' : 'error')
        if (fuente?.capabilities.download !== true) setMensaje(t(LOCALE, 'downloads.notAllowed'))
      })
      .catch(() => {
        if (vivo) setEstado('error')
      })

    return () => {
      vivo = false
    }
  }, [props.providerId])

  if (estado === 'comprobando' || (estado === 'error' && mensaje === undefined)) return null

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
      setEstado('hecho')
    } catch (cause) {
      setEstado('error')
      setMensaje(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="downloads__button">
      <button
        type="button"
        className="button"
        disabled={estado === 'guardando' || estado === 'hecho' || estado === 'error'}
        onClick={() => void descargar()}
      >
        {estado === 'hecho'
          ? t(LOCALE, 'downloads.queued')
          : estado === 'guardando'
            ? t(LOCALE, 'downloads.saving')
            : t(LOCALE, 'downloads.download')}
      </button>
      {mensaje === undefined ? null : <span className="downloads__error">{mensaje}</span>}
    </div>
  )
}
