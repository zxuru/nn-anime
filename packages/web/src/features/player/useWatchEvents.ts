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
 *   `rona:ocultar-ventana` antes de esconder la ventana en la bandeja: la
 *   página sigue viva pero ya no se ve, y es el último momento seguro.
 *
 * Los envíos se **serializan** en una cola: dos `PATCH` a la vez pueden llegar
 * desordenados y dejar la posición más vieja como última. La decisión de si toca
 * enviar es una función pura —`shouldSendUpdate`— y el envío en sí se prueba con
 * un `fetch` de mentira.
 */

import { watchStartResponseSchema } from '@rona/core/api'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiPostJson } from '../../api/client'

/**
 * Cada cuánto se manda la posición mientras se reproduce.
 *
 * Son los mismos cinco segundos que el progreso local: con dos ritmos distintos,
 * el servidor y el navegador podían discrepar en el sitio donde reanudar.
 */
export const UPDATE_INTERVAL_MS = 5_000

/**
 * Cada cuánto se refresca la presencia de Discord.
 *
 * Discord admite cinco actualizaciones cada veinte segundos; quince segundos
 * deja margen y no gasta la cuota. El reloj de la actividad lo lleva Discord, así
 * que entre foto y foto la barra sigue avanzando sola: la foto periódica sólo
 * corrige lo que se desvía —una pausa larga del búfer, la velocidad—, no dibuja
 * el reloj. Lo que sí se manda en el acto es una interacción: pausar, reanudar y
 * saltar a otro punto del episodio.
 */
export const PRESENCE_INTERVAL_MS = 15_000

/** Diferencia mínima para considerar que la posición cambió de verdad. */
export const MIN_DELTA_S = 1

/**
 * Un salto de esta magnitud no lo hizo el reloj: lo hizo alguien.
 *
 * El elemento avisa de la posición cuatro veces por segundo, así que entre dos
 * avisos la posición avanza una fracción de segundo. Un salto de dos segundos o
 * más es la barra, las teclas de diez segundos o el botón de saltar —una
 * interacción que Discord tiene que ver ya, no en la siguiente foto—; el reloj
 * de la actividad lleva al día lo que sólo avanza.
 */
export const SEEK_JUMP_S = 2

/** ¿Entre estos dos avisos hubo una búsqueda y no el paso del reloj? */
export function isSeek(previousS: number, nextS: number): boolean {
  return Math.abs(nextS - previousS) >= SEEK_JUMP_S
}

/**
 * La duración que viaja en el cuerpo, ya normalizada.
 *
 * `Infinity` —un directo— y `NaN` no son duraciones conocidas y se mandan como
 * cero, igual que hacía `updateBody`. Que esta cifra y la que se guarda para
 * decidir sean la misma importa: comparando la cruda, un `Infinity` dejaba el
 * pestillo de la presencia abierto y salía una foto por cada `timeupdate`.
 */
export function duracionConocida(durationS: number): number {
  return Number.isFinite(durationS) && durationS > 0 ? Math.floor(durationS) : 0
}

/**
 * ¿Toca mandar la foto a Discord?
 *
 * Se manda si pasó el intervalo, si la duración acaba de conocerse —es cuando
 * puede aparecer la barra de progreso— o si se pide. Discord admite cinco
 * actualizaciones cada veinte segundos; quince deja margen, y quien agrupa de
 * verdad los envíos es el servidor: aquí se decide **qué** merece contarse, y
 * una pausa o una búsqueda siempre lo merecen.
 */
export function shouldSendPresence(input: {
  readonly now: number
  readonly lastSentAt: number
  readonly durationS: number
  readonly lastDurationS: number
  readonly force?: boolean
}): boolean {
  if (input.force === true) return true
  if (input.durationS > 0 && input.lastDurationS === 0) return true

  return input.now - input.lastSentAt >= PRESENCE_INTERVAL_MS
}

/**
 * El evento con el que el anfitrión de Tauri pide guardar antes de ocultar la
 * ventana. Es un `CustomEvent` de la propia página: no hay IPC ni permisos de
 * Tauri de por medio.
 */
export const EVENTO_OCULTAR_VENTANA = 'rona:ocultar-ventana'

export interface WatchEventsOptions {
  readonly animeRef: { readonly providerId: string; readonly value: string }
  readonly episodeRef: { readonly providerId: string; readonly value: string }
  readonly mode: string
  /** El número de episodio, si la dirección o la referencia lo traen. */
  readonly episodeNumber?: number | undefined
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
    durationS: duracionConocida(durationS),
  }
}

export interface PresenceBody {
  readonly animeRef: { readonly providerId: string; readonly value: string }
  readonly episodeNumber?: number
  readonly positionS: number
  readonly durationS: number
  readonly paused: boolean
}

/**
 * La foto que se manda al servidor para Discord.
 *
 * No lleva el título: lo resuelve el servidor desde `animeRef` y lo cruza con la
 * marca de adultos. El número de episodio sólo viaja si se conoce y es positivo;
 * un cero no dice nada y el servidor lo omitiría igual.
 */
export function presenceBody(
  animeRef: PresenceBody['animeRef'],
  episodeNumber: number | undefined,
  positionS: number,
  durationS: number,
  paused: boolean,
): PresenceBody {
  const cuerpo = updateBody(positionS, durationS)

  return {
    animeRef,
    ...(episodeNumber === undefined || episodeNumber <= 0
      ? {}
      : { episodeNumber: Math.floor(episodeNumber) }),
    ...cuerpo,
    paused,
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
  /**
   * La última foto publicada en Discord.
   *
   * `at` frena los envíos para no gastar las cinco actualizaciones que Discord
   * admite cada veinte segundos; `duracion` detecta el paso de «aún no sé cuánto
   * dura» a «ya lo sé», que es cuando la barra de progreso puede aparecer.
   */
  const presencia = useRef({ at: 0, duracion: 0 })
  const pausado = useRef(false)
  /** Al desmontar se deja de publicar: el `DELETE` llega después. */
  const cerrado = useRef(false)
  /**
   * Las opciones vivas.
   *
   * Quien llama construye `animeRef` en cada render, así que su identidad cambia
   * con cada `timeupdate`. Con ella en las dependencias, los avisos se recreaban
   * en cada vuelta y el efecto de desmontaje ejecutaba su limpieza una y otra
   * vez. Las referencias y el número de episodio se leen de aquí en el momento
   * de mandar, que es cuando valen.
   */
  const opciones = useRef(options)
  opciones.current = options

  const mandarPresencia = useCallback((paused: boolean, forzar = false): void => {
    if (cerrado.current) return

    const ahora = Date.now()
    const duracion = duracionConocida(vivo.current.durationS)

    /*
     * El turno de quince segundos es para las fotos que sólo avanzan. Lo que se
     * pide con `forzar` —empezar, pausar, una búsqueda, la duración recién
     * conocida— sale ya: es lo que el usuario está viendo en su perfil. Quien
     * respeta la cuota de Discord es el servidor, que agrupa lo que llega junto.
     */
    if (
      !shouldSendPresence({
        now: ahora,
        lastSentAt: presencia.current.at,
        durationS: duracion,
        lastDurationS: presencia.current.duracion,
        force: forzar,
      })
    ) {
      return
    }

    presencia.current = { at: ahora, duracion }

    const cuerpo = presenceBody(
      opciones.current.animeRef,
      opciones.current.episodeNumber,
      vivo.current.positionS,
      vivo.current.durationS,
      paused,
    )

    // Sin `keepalive`: es un aviso de estado, no el guardado final. Que no
    // llegue no puede romper la reproducción ni la pausa.
    void fetch('/api/presence', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(cuerpo),
    }).catch(() => {})
  }, [])

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
      // Un salto entre dos avisos no es el reloj: es la barra o un mando. Discord
      // tiene que verlo ya, no quince segundos después, o el perfil sigue
      // diciendo que se está viendo el minuto que ya se dejó atrás.
      const salto = isSeek(vivo.current.positionS, positionS)
      vivo.current = { positionS, durationS }

      // La presencia no depende de que el alta del visionado haya llegado: si el
      // `POST /api/watch` falló, el historial se pierde pero Discord puede seguir
      // diciendo qué se está viendo.
      mandarPresencia(pausado.current, force || salto)

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
    [mandar, mandarPresencia],
  )

  const flush = useCallback((): void => {
    registrar(vivo.current.positionS, vivo.current.durationS, true, true)
  }, [registrar])

  /**
   * El guardado final, en una referencia.
   *
   * El efecto de desmontaje no puede llevar en las dependencias una función que
   * pueda cambiar de identidad: React ejecutaría su limpieza en cada render y
   * cada `timeupdate` mandaría un `DELETE /api/presence` y un `PATCH` del
   * visionado, además de apagar la presencia para el resto de la sesión. Se lee
   * la de ahora al desmontar, que es lo único que hace falta.
   */
  const flushVivo = useRef(flush)
  flushVivo.current = flush

  const abrir = useCallback(() => {
    reproduciendo.current = true
    pausado.current = false

    // Se publica ya, sin esperar al alta del historial: la presencia no necesita
    // una fila en la base.
    mandarPresencia(false, true)

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
  }, [
    options.animeRef,
    options.episodeRef,
    options.mode,
    options.startAtS,
    registrar,
    mandarPresencia,
  ])

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
  // `beforeunload` cubren el navegador y **retiran** la presencia; la visibilidad
  // y la bandeja del anfitrión sólo guardan la posición: la página sigue viva y
  // el episodio puede seguir sonando.
  useEffect(() => {
    const alCerrar = (): void => {
      flushVivo.current()
      void fetch('/api/presence', {
        method: 'DELETE',
        credentials: 'same-origin',
        keepalive: true,
      }).catch(() => {})
    }
    const alOcultar = (): void => flushVivo.current()
    const alCambiarVisibilidad = (): void => {
      if (document.visibilityState === 'hidden') flushVivo.current()
    }

    window.addEventListener('pagehide', alCerrar)
    window.addEventListener('beforeunload', alCerrar)
    window.addEventListener(EVENTO_OCULTAR_VENTANA, alOcultar)
    document.addEventListener('visibilitychange', alCambiarVisibilidad)

    return () => {
      window.removeEventListener('pagehide', alCerrar)
      window.removeEventListener('beforeunload', alCerrar)
      window.removeEventListener(EVENTO_OCULTAR_VENTANA, alOcultar)
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
    }
  }, [])

  // Al desmontar —cambiar de episodio o salir de la pantalla—, la posición
  // final. Es el último momento en el que la fila y la posición viven juntas. Sin
  // dependencias: la limpieza de este efecto es **el desmontaje**, no una vuelta
  // más del render, y por eso lee el guardado de una referencia.
  useEffect(() => {
    /*
     * El pestillo se abre al montar y no sólo al crearse el gancho: en modo
     * estricto React monta, desmonta y vuelve a montar, y la limpieza de abajo
     * dejaba `cerrado` en `true` para siempre. Desde ahí, la presencia de Discord
     * no se publicaba ni una vez en toda la sesión.
     */
    cerrado.current = false

    return () => {
      cerrado.current = true
      reproduciendo.current = false
      flushVivo.current()
      void fetch('/api/presence', {
        method: 'DELETE',
        credentials: 'same-origin',
        keepalive: true,
      }).catch(() => {})
    }
  }, [])

  return {
    watchId,
    onPlay: abrir,
    onPause: () => {
      pausado.current = true
      reproduciendo.current = false
      mandarPresencia(true, true)
      flush()
    },
    onProgress: (positionS, durationS) => registrar(positionS, durationS, false),
    flush,
  }
}
