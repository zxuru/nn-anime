/**
 * Registro del visionado: alta, avance y posición final.
 *
 * Tres momentos y tres razones:
 *
 * - **Alta al empezar a reproducir.** No al cargar la página: cargar la ficha de
 *   un episodio no es haberlo visto, y si se registrara ahí, «continuar viendo»
 *   se llenaría de títulos que nadie reprodujo.
 * - **Avance cada 15 s y al pausar.** Cada 15 y no cada segundo: una petición por
 *   segundo es una escritura por segundo en una base de un solo escritor, y la
 *   posición se guarda para poder reanudar, no para dibujar una gráfica.
 * - **Posición final al desmontar y al cerrar la pestaña**, con `keepalive`. Sin
 *   eso, cerrar la pestaña pierde los últimos segundos, que son justo los que
 *   hacen que reanudar sirva de algo.
 *
 * La decisión de si toca enviar es una función pura: `shouldSendUpdate`. Lo que
 * no se puede probar sin navegador es el envío, y eso se prueba aquí aparte.
 */

import { watchStartResponseSchema } from '@nn-anime/core/api'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiPatch, apiPostJson } from '../../api/client'

/** Cada cuánto se manda la posición mientras se reproduce. */
export const UPDATE_INTERVAL_MS = 15_000

/** Diferencia mínima para considerar que la posición cambió de verdad. */
export const MIN_DELTA_S = 1

export interface WatchEventsOptions {
  readonly animeRef: { readonly providerId: string; readonly value: string }
  readonly episodeRef: { readonly providerId: string; readonly value: string }
  readonly mode: string
  /** Posición desde la que se empieza, si se reanuda. */
  readonly startAtS?: number | undefined
}

export interface WatchEvents {
  /** Se llama cuando la reproducción empieza de verdad. */
  readonly onPlay: () => void
  readonly onPause: () => void
  readonly onProgress: (positionS: number, durationS: number) => void
  /** Identificador del visionado abierto, si lo hay. */
  readonly watchId: number | undefined
}

/**
 * ¿Toca mandar el avance?
 *
 * Se manda si pasó el intervalo **o** si la posición se movió lo suficiente
 * desde el último envío: pausar a los dos segundos de empezar tiene que guardar
 * esos dos segundos.
 */
export function shouldSendUpdate(input: {
  readonly now: number
  readonly lastSentAt: number
  readonly positionS: number
  readonly lastSentPositionS: number
  readonly force?: boolean
}): boolean {
  if (input.force === true) return true
  if (Math.abs(input.positionS - input.lastSentPositionS) >= MIN_DELTA_S) return true

  return input.now - input.lastSentAt >= UPDATE_INTERVAL_MS
}

/** El cuerpo del avance, sin ceros que no aportan. */
export function updateBody(
  positionS: number,
  durationS: number,
): { positionS: number; durationS: number } {
  return {
    positionS: Math.max(0, Math.floor(positionS)),
    durationS: Number.isFinite(durationS) && durationS > 0 ? Math.floor(durationS) : 0,
  }
}

export function useWatchEvents(options: WatchEventsOptions): WatchEvents {
  const [watchId, setWatchId] = useState<number | undefined>(undefined)
  const ultimo = useRef({ at: 0, positionS: 0, durationS: 0 })
  const abierto = useRef<number | undefined>(undefined)

  const abrir = useCallback(() => {
    if (abierto.current !== undefined) return

    void apiPostJson(
      '/api/watch',
      {
        animeRef: options.animeRef,
        episodeRef: options.episodeRef,
        mode: options.mode,
        ...(options.startAtS === undefined ? {} : { startAtS: options.startAtS }),
      },
      watchStartResponseSchema,
    ).then(
      (salida) => {
        abierto.current = salida.id
        setWatchId(salida.id)
      },
      () => {
        // Que no se pueda registrar no puede impedir ver el video: se sigue sin
        // «continuar viendo», que es una comodidad y no la reproducción.
      },
    )
  }, [options.animeRef, options.episodeRef, options.mode, options.startAtS])

  const enviar = useCallback((positionS: number, durationS: number, force: boolean) => {
    const id = abierto.current
    if (id === undefined) return

    const ahora = Date.now()
    if (
      !shouldSendUpdate({
        now: ahora,
        lastSentAt: ultimo.current.at,
        positionS,
        lastSentPositionS: ultimo.current.positionS,
        force,
      })
    ) {
      return
    }

    ultimo.current = { at: ahora, positionS, durationS }
    void apiPatch(`/api/watch/${id}`, updateBody(positionS, durationS)).catch(() => {})
  }, [])

  // Al cerrar la pestaña, la posición final. `keepalive` deja que la petición
  // termine aunque la página se esté yendo, que es exactamente el caso.
  useEffect(() => {
    const alCerrar = (): void => {
      const id = abierto.current
      if (id === undefined) return

      const cuerpo = updateBody(ultimo.current.positionS, ultimo.current.durationS)
      void fetch(`/api/watch/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cuerpo),
        keepalive: true,
      }).catch(() => {})
    }

    window.addEventListener('pagehide', alCerrar)

    return () => {
      window.removeEventListener('pagehide', alCerrar)
      alCerrar()
    }
  }, [])

  return {
    watchId,
    onPlay: abrir,
    onPause: () => enviar(ultimo.current.positionS, ultimo.current.durationS, true),
    onProgress: (positionS, durationS) => enviar(positionS, durationS, false),
  }
}
