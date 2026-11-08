/**
 * Registro del visionado: alta, avance y posición final.
 *
 * Tres momentos y tres razones:
 *
 * - **Alta al empezar a reproducir.** No al cargar la página: cargar la ficha de
 *   un episodio no es haberlo visto, y si se registrara ahí, «continuar viendo»
 *   se llenaría de títulos que nadie reprodujo.
 * - **Avance periódico y en cada pausa, salto o cambio de visibilidad.** La
 *   posición se guarda para reanudar, no para dibujar una gráfica: cinco segundos
 *   es el equilibrio entre perder poco al cerrar a lo brusco y no escribir una
 *   fila por segundo en una base de un solo escritor.
 * - **Posición final al desmontar, al cerrar la pestaña y al ocultar la ventana
 *   de Tauri**, con `keepalive` donde el navegador lo admite. Sin eso, cerrar
 *   pierde los últimos segundos, que son justo los que hacen que reanudar sirva
 *   de algo. El anfitrión de escritorio avisa con el evento
 *   `nn-anime:ocultar-ventana` antes de esconder la ventana en la bandeja: la
 *   página sigue viva pero ya no se ve, y es el último momento seguro.
 *
 * Los envíos se **serializan** en una cola: dos `PATCH` a la vez pueden llegar
 * desordenados y dejar la posición más vieja como última. La decisión de si toca
 * enviar es una función pura —`shouldSendUpdate`— y el envío en sí se prueba con
 * un `fetch` de mentira.
 */

import { watchStartResponseSchema } from '@nn-anime/core/api'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiPostJson } from '../../api/client'

/**
 * Cada cuánto se manda la posición mientras se reproduce.
 *
 * Son los mismos cinco segundos que el progreso local: con dos ritmos distintos,
 * el servidor y el navegador podían discrepar en el sitio donde reanudar.
 */
export const UPDATE_INTERVAL_MS = 5_000

/** Diferencia mínima para considerar que la posición cambió de verdad. */
export const MIN_DELTA_S = 1

/**
 * El evento con el que el anfitrión de Tauri pide guardar antes de ocultar la
 * ventana. Es un `CustomEvent` de la propia página: no hay IPC ni permisos de
 * Tauri de por medio.
 */
export const EVENTO_OCULTAR_VENTANA = 'nn-anime:ocultar-ventana'

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
  /**
   * Manda ahora la última posición conocida, sin esperar al turno periódico.
   *
   * Es público porque la pantalla puede saber de un cierre antes que este
   * gancho; hoy lo usan los eventos de ventana de aquí dentro.
   */
  readonly flush: () => void
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
  /**
   * La posición viva: la última que contó el reproductor.
   *
   * Se guarda en cada aviso, aunque no toque enviarla, porque el guardado final
   * —al cerrar, al pausar, al ocultar— necesita el dato de ahora y no el del
   * último envío.
   */
  const vivo = useRef({ positionS: 0, durationS: 0 })
  /** Lo último que se envió, para decidir si toca otro envío. */
  const enviado = useRef({ at: 0, positionS: 0 })
  /** La fila abierta; `undefined` hasta que el alta contesta. */
  const abierto = useRef<number | undefined>(undefined)
  /** ¿Está reproduciendo? El turno periódico no escribe si está en pausa. */
  const reproduciendo = useRef(false)
  /**
   * La cola de envíos.
   *
   * `fetch` no garantiza que dos `PATCH` simultáneos lleguen en orden, y la
   * posición que gana es la última que se escribe. Encolarlos hace que el orden
   * de llegada sea el orden de captura.
   */
  const cola = useRef<Promise<void>>(Promise.resolve())

  const mandar = useCallback((positionS: number, durationS: number, keepalive: boolean): void => {
    const cuerpo = updateBody(positionS, durationS)

    /*
     * La petición se **inicia dentro** de la cola, no antes: encadenar una
     * promesa que ya está en marcha no ordena nada. Así el `PATCH` siguiente no
     * sale hasta que el anterior terminó, y la posición que queda es la última
     * capturada.
     *
     * `fetch` directo y no `apiPatch`: el cliente HTTP no admite `keepalive`, y
     * sin él la petición del cierre de la pestaña se cancela con la página.
     */
    cola.current = cola.current.then(async () => {
      const id = abierto.current
      if (id === undefined) return

      try {
        await fetch(`/api/watch/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(cuerpo),
          keepalive,
        })
      } catch {
        // Que no se pueda guardar una posición no puede romper la reproducción.
      }
    })
  }, [])

  const registrar = useCallback(
    (positionS: number, durationS: number, force: boolean, keepalive = false): void => {
      vivo.current = { positionS, durationS }

      const id = abierto.current
      if (id === undefined) return

      const ahora = Date.now()
      if (
        !shouldSendUpdate({
          now: ahora,
          lastSentAt: enviado.current.at,
          positionS,
          lastSentPositionS: enviado.current.positionS,
          force,
        })
      ) {
        return
      }

      enviado.current = { at: ahora, positionS }
      mandar(positionS, durationS, keepalive)
    },
    [mandar],
  )

  const flush = useCallback((): void => {
    registrar(vivo.current.positionS, vivo.current.durationS, true, true)
  }, [registrar])

  const abrir = useCallback(() => {
    reproduciendo.current = true
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

        // Mientras el alta viajaba pudo avanzar la reproducción: si hay algo que
        // guardar, se guarda en cuanto hay fila, sin esperar al turno.
        const { positionS, durationS } = vivo.current
        if (positionS > 0 || durationS > 0) {
          enviado.current = { at: 0, positionS: 0 }
          registrar(positionS, durationS, true)
        }
      },
      () => {
        // Que no se pueda registrar no puede impedir ver el video: se sigue sin
        // «continuar viendo», que es una comodidad y no la reproducción.
      },
    )
  }, [options.animeRef, options.episodeRef, options.mode, options.startAtS, registrar])

  // El turno periódico. Se crea una vez y no depende de la posición: lee la
  // referencia viva, así que no se recrea en cada aviso del elemento.
  useEffect(() => {
    const reloj = setInterval(() => {
      if (!reproduciendo.current) return
      if (abierto.current === undefined) return

      registrar(vivo.current.positionS, vivo.current.durationS, false)
    }, UPDATE_INTERVAL_MS)

    return () => clearInterval(reloj)
  }, [registrar])

  // Los tres avisos de que la página se va o deja de verse. `pagehide` y
  // `beforeunload` cubren el navegador; la visibilidad cubre la bandeja del
  // anfitrión y el cambio de pestaña, que no descargan la página.
  useEffect(() => {
    const alCerrar = (): void => flush()
    const alCambiarVisibilidad = (): void => {
      if (document.visibilityState === 'hidden') flush()
    }

    window.addEventListener('pagehide', alCerrar)
    window.addEventListener('beforeunload', alCerrar)
    window.addEventListener(EVENTO_OCULTAR_VENTANA, alCerrar)
    document.addEventListener('visibilitychange', alCambiarVisibilidad)

    return () => {
      window.removeEventListener('pagehide', alCerrar)
      window.removeEventListener('beforeunload', alCerrar)
      window.removeEventListener(EVENTO_OCULTAR_VENTANA, alCerrar)
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
    }
  }, [flush])

  // Al desmontar —cambiar de episodio o salir de la pantalla—, la posición
  // final. Es el último momento en el que la fila y la posición viven juntas.
  useEffect(() => {
    return () => {
      reproduciendo.current = false
      flush()
    }
  }, [flush])

  return {
    watchId,
    onPlay: abrir,
    onPause: () => {
      reproduciendo.current = false
      flush()
    },
    onProgress: (positionS, durationS) => registrar(positionS, durationS, false),
    flush,
  }
}
