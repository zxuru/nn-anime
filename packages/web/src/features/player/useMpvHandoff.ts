/**
 * El handoff al reproductor externo: `POST /api/play/mpv`.
 *
 * Existe porque el navegador no siempre puede con el stream —un decodificador que
 * no arranca deja el audio sonando y la imagen en negro— y mpv sí. El contrato lo
 * pide como una de las dos formas de ver algo: «se ve el video en la página, **o
 * se lanza a mpv con un clic**».
 *
 * El estado es pequeño a propósito: si se lanzó, si está lanzando, o qué dijo el
 * servidor cuando no se pudo. El seguimiento del proceso vive en el SSE de
 * `mpv/events`, y la pantalla no lo necesita para nada: la ventana la abre mpv.
 */

import { mpvPlayResponseSchema } from '@nn-anime/core/api'
import { useCallback, useState } from 'react'
import { ApiError, apiPostJson } from '../../api/client'

export interface MpvHandoffOptions {
  readonly providerId: string
  readonly ref: string
  readonly mode: string
  /** Segundo por el que empezar: lo que se lleve visto en el reproductor web. */
  readonly startAtS?: number | undefined
}

export type MpvEstado =
  | { readonly kind: 'idle' }
  | { readonly kind: 'lanzando' }
  | { readonly kind: 'abierto'; readonly pid: number }
  | { readonly kind: 'error'; readonly mensaje: string }

export interface MpvHandoff {
  readonly estado: MpvEstado
  readonly abrir: () => void
}

/**
 * Qué contarle a quien pulsó, a partir de lo que contestó el servidor.
 *
 * El `detail` del error es el mensaje del servidor —«no se encontró mpv en el
 * PATH; se puede reproducir en el navegador»— y es mejor que el genérico: dice
 * qué pasa y qué hacer. Cuando no lo hay, se usa el del cliente.
 */
export function mensajeDeFallo(causa: unknown): string {
  if (causa instanceof ApiError) return causa.detail ?? causa.message
  if (causa instanceof Error) return causa.message

  return String(causa)
}

export function useMpvHandoff(options: MpvHandoffOptions): MpvHandoff {
  const [estado, setEstado] = useState<MpvEstado>({ kind: 'idle' })

  const abrir = useCallback(() => {
    setEstado({ kind: 'lanzando' })

    void apiPostJson(
      '/api/play/mpv',
      {
        episodeRef: { providerId: options.providerId, value: options.ref },
        mode: options.mode,
        ...(options.startAtS === undefined || options.startAtS <= 0
          ? {}
          : { startAtS: options.startAtS }),
      },
      mpvPlayResponseSchema,
    ).then(
      (salida) => setEstado({ kind: 'abierto', pid: salida.pid }),
      (causa: unknown) => setEstado({ kind: 'error', mensaje: mensajeDeFallo(causa) }),
    )
  }, [options.providerId, options.ref, options.mode, options.startAtS])

  return { estado, abrir }
}
