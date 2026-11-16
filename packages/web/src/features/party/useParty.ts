/**
 * Estado y acciones de la sala de visionado.
 *
 * El anfitrión **coordina**: publica a su coordinador el episodio, la posición,
 * la pausa y la velocidad cuando cambian y con un latido mientras reproduce. El
 * invitado **se sincroniza**: entra por su propia instancia —que es la que habla
 * con el anfitrión—, mide el reloj con cinco muestras, corrige la deriva de su
 * `<video>` y reporta por dónde va.
 *
 * Nunca viaja el vídeo, ni un ticket, ni una URL de stream. Lo que esta pieza
 * manda es la forma pequeña de `PartyHostState`; lo que recibe, `PartyEvent`.
 *
 * Sin efectos en el render: `window`, `document` y el elemento `<video>` sólo se
 * tocan dentro de efectos y de manejadores. En el servidor la sala se pinta en
 * su estado inicial y no hace nada.
 */

import {
  normalizeRoomCode,
  PARTY_DRIFT_OK_S,
  PARTY_DRIFT_SEEK_S,
  PARTY_REPORT_INTERVAL_MS,
  type PartyClockSample,
  type PartyCorrection,
  type PartyEvent,
  type PartyHostState,
  type PartyMedia,
  type PartyParticipant,
  type PartyReport,
  type PartyState,
  partyClockOffset,
  partyCorrection,
  partyTargetPositionS,
} from '@nn-anime/core/party'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, ApiShapeError } from '../../api/client'
import {
  closePartyRoom,
  createPartyRoom,
  joinRemoteRoom,
  leaveRemoteRoom,
  measureRemoteClock,
  normalizeHostAddress,
  publishPartyState,
  readHostPartyEvents,
  readPartyInfo,
  readRemotePartyEvents,
  reportRemotePosition,
} from './client'

/** Fase de la sesión: sin sala, coordinando o sincronizada con un anfitrión. */
export type PartyPhase = 'idle' | 'host' | 'guest'

/** Estado del flujo de eventos. */
export type PartyConnection = 'connecting' | 'connected' | 'error' | 'closed'

/** Cómo de lejos está el invitado del anfitrión, con los umbrales del protocolo. */
export type PartySync = 'ok' | 'adjusting' | 'drift' | 'unknown'

export interface PartyRoomInfo {
  readonly roomId: string
  readonly code: string
  readonly expiresAt: number
  /** Direcciones de esta instancia para invitar. Vacío en el invitado. */
  readonly urls: readonly string[]
}

export interface PartyJoinInput {
  readonly baseUrl: string
  readonly code: string
  readonly name: string
}

export interface PartyHandle {
  readonly phase: PartyPhase
  readonly room: PartyRoomInfo | undefined
  readonly roster: readonly PartyParticipant[]
  readonly connection: PartyConnection
  readonly sync: PartySync
  /** Magnitud de la deriva, en segundos. `0` mientras no hay estado. */
  readonly driftS: number
  /** Clave de i18n del último fallo, o `undefined` si no hay. */
  readonly error: string | undefined
  /**
   * El episodio que ve el anfitrión.
   *
   * En el anfitrión es el suyo; en el invitado llega en los eventos. La barra lo
   * usa para decir qué hay que abrir, porque el invitado resuelve la fuente en
   * su instancia y la sala no se la manda.
   */
  readonly hostMedia: PartyMedia | undefined
  createRoom: () => Promise<void>
  joinRoom: (input: PartyJoinInput) => Promise<void>
  closeRoom: () => Promise<void>
  leave: () => Promise<void>
}

export interface UsePartyOptions {
  /** El elemento que se está reproduciendo, o `null` mientras no hay. */
  readonly video: HTMLVideoElement | null
  /** El contenido que esta instancia está viendo, para publicarlo. */
  readonly media: PartyMedia | undefined
}

/** Cada cuánto se compara la posición del invitado con la del anfitrión. */
const DRIFT_TICK_MS = 500

/** Muestras del reloj al entrar: la mediana de cinco aguanta un pico de latencia. */
const CLOCK_SAMPLES = 5

/** Tiempo máximo de una muestra del reloj, para no quedarse midiendo para siempre. */
const CLOCK_SAMPLE_TIMEOUT_MS = 4000

/** Diferencia de `playbackRate` que no merece tocar el elemento. */
const RATE_EPSILON = 0.001

/** La sesión activa, ya con la forma que necesita el flujo. */
interface PartySession {
  readonly kind: 'host' | 'guest'
  readonly roomId: string
  readonly code: string
  readonly expiresAt: number
  readonly urls: readonly string[]
}

/**
 * Clave de i18n del fallo.
 *
 * Los estados del contrato dicen qué pasó: 401 es la sesión local, 404 la sala o
 * el enlace, 409 la sala llena, 429 el límite y 502 que el anfitrión no
 * responde. Se traducen a frases con el resto de la interfaz; el mensaje del
 * cliente —con su método y su ruta— no se enseña nunca.
 */
export function partyErrorKey(cause: unknown): string {
  if (cause instanceof ApiError) {
    switch (cause.status) {
      case 401:
        return 'party.error.unauthorized'
      case 404:
        return 'party.error.notFound'
      case 409:
        return 'party.error.full'
      case 429:
        return 'party.error.rateLimited'
      case 502:
        return 'party.error.hostUnreachable'
      default:
        return 'party.error.server'
    }
  }

  if (cause instanceof ApiShapeError) return 'party.error.shape'
  if (cause instanceof TypeError) return 'party.error.network'

  return 'party.error.generic'
}

/**
 * Aplica al `<video>` la corrección que pide el protocolo.
 *
 * La velocidad vuelve siempre a la del anfitrión cuando ya no hay que ajustar:
 * un `playbackRate` que se queda en 1,05 para siempre convierte el episodio en
 * una cinta acelerada, y es exactamente el fallo que el spec prohíbe.
 */
function applyCorrection(
  video: HTMLVideoElement,
  correction: PartyCorrection,
  hostRate: number,
): void {
  switch (correction.kind) {
    case 'none':
      if (Math.abs(video.playbackRate - hostRate) > RATE_EPSILON) video.playbackRate = hostRate

      return
    case 'play':
      if (Math.abs(video.currentTime - correction.targetS) > 0.1) {
        video.currentTime = correction.targetS
      }

      if (Math.abs(video.playbackRate - hostRate) > RATE_EPSILON) video.playbackRate = hostRate
      // La política de reproducción del navegador puede rechazar el gesto: es un
      // no, no un fallo que haya que contar en pantalla.
      void video.play().catch(() => {})

      return
    case 'pause':
      if (Math.abs(video.playbackRate - hostRate) > RATE_EPSILON) video.playbackRate = hostRate
      video.pause()
      if (Math.abs(video.currentTime - correction.targetS) > 0.1) {
        video.currentTime = correction.targetS
      }

      return
    case 'seek':
      video.currentTime = correction.targetS
      if (Math.abs(video.playbackRate - hostRate) > RATE_EPSILON) video.playbackRate = hostRate

      return
    case 'rate':
      video.playbackRate = correction.rate

      return
  }
}

/** El estado autoritativo con lo que el `<video>` tiene ahora mismo. */
function hostStateOf(video: HTMLVideoElement, media: PartyMedia): PartyHostState {
  return {
    media,
    positionS: Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0,
    paused: video.paused,
    rate:
      Number.isFinite(video.playbackRate) && video.playbackRate >= 0.25 ? video.playbackRate : 1,
  }
}

/** El reporte del invitado, con lo que el elemento sabe en ese instante. */
function reportOf(video: HTMLVideoElement): PartyReport {
  return {
    positionS: Math.max(0, video.currentTime),
    paused: video.paused,
    buffering: !video.paused && video.readyState < 3,
    ready: video.readyState >= 2,
  }
}

export function useParty(options: UsePartyOptions): PartyHandle {
  const { video } = options

  // El contenido cambia con el episodio y con la duración; el valor se lee desde
  // una referencia para que un cambio de media no vuelva a montar el flujo.
  const mediaRef = useRef(options.media)
  mediaRef.current = options.media
  const mediaKey = options.media === undefined ? '' : JSON.stringify(options.media)

  const [phase, setPhase] = useState<PartyPhase>('idle')
  const [session, setSession] = useState<PartySession | undefined>(undefined)
  const [room, setRoom] = useState<PartyRoomInfo | undefined>(undefined)
  const [roster, setRoster] = useState<readonly PartyParticipant[]>([])
  const [connection, setConnection] = useState<PartyConnection>('closed')
  const [sync, setSync] = useState<PartySync>('unknown')
  const [driftS, setDriftS] = useState(0)
  const [error, setError] = useState<string | undefined>(undefined)
  const [remoteMedia, setRemoteMedia] = useState<PartyMedia | undefined>(undefined)

  const sessionRef = useRef<PartySession | undefined>(undefined)
  sessionRef.current = session
  const latestState = useRef<PartyState | undefined>(undefined)
  const clockOffset = useRef(0)
  const clockReady = useRef(false)
  const clockStarted = useRef(false)
  /** Evita dos salas creadas por un doble clic mientras la primera va en vuelo. */
  const busy = useRef(false)

  const hostMedia = phase === 'host' ? options.media : remoteMedia

  const reiniciar = useCallback(() => {
    setSession(undefined)
    setPhase('idle')
    setRoom(undefined)
    setRoster([])
    setConnection('closed')
    setSync('unknown')
    setDriftS(0)
    setRemoteMedia(undefined)
    latestState.current = undefined
    clockOffset.current = 0
    clockReady.current = false
    clockStarted.current = false
  }, [])

  /**
   * Se queda con el estado más nuevo.
   *
   * `seq` es estrictamente creciente por emisor: un evento que llega tarde —un
   * `welcome` después de un `state`, o un reintento— no puede devolver la sala a
   * una posición vieja.
   */
  const adoptarEstado = useCallback((state: PartyState): void => {
    const previo = latestState.current
    if (previo !== undefined && state.seq < previo.seq) return

    latestState.current = state
    setRemoteMedia(state.media)
  }, [])

  /**
   * Mide el desfase con el reloj del anfitrión, cinco veces al entrar.
   *
   * Cada muestra es una ida y vuelta; la mediana de las cinco es el desfase que
   * usa la corrección. Una muestra perdida no invalida las demás; sin ninguna,
   * el desfase queda en cero y el invitado se corrige contra el sello del
   * servidor, que es lo mejor que se puede hacer.
   */
  const medirReloj = useCallback(async (): Promise<void> => {
    if (clockStarted.current || sessionRef.current?.kind !== 'guest') return

    clockStarted.current = true
    const sesion = sessionRef.current
    const muestras: PartyClockSample[] = []

    for (let intento = 0; intento < CLOCK_SAMPLES; intento++) {
      if (sessionRef.current !== sesion) return

      try {
        muestras.push(
          await measureRemoteClock({ signal: AbortSignal.timeout(CLOCK_SAMPLE_TIMEOUT_MS) }),
        )
      } catch {
        // Un timeout o un 502 en una muestra: la mediana se queda con las otras.
      }
    }

    // La sesión pudo cambiar mientras se medía: el desfase de una sala no vale
    // para la siguiente.
    if (sessionRef.current !== sesion) return

    clockOffset.current = partyClockOffset(muestras)
    clockReady.current = true
  }, [])

  /** Procesa un evento del flujo; el mismo para anfitrión e invitado. */
  const aplicarEvento = useCallback(
    (evento: PartyEvent, actual: PartySession): void => {
      switch (evento.type) {
        case 'welcome':
          setConnection('connected')
          setRoster(evento.roster)
          setRoom((previo) =>
            previo === undefined ? previo : { ...previo, expiresAt: evento.expiresAt },
          )
          if (evento.state !== null) adoptarEstado(evento.state)
          if (actual.kind === 'guest') void medirReloj()

          return
        case 'state':
          adoptarEstado(evento.state)
          setConnection('connected')

          return
        case 'roster':
          setRoster(evento.roster)

          return
        case 'ping':
          setConnection('connected')

          return
        case 'closed':
          // La sala murió: se deja la sesión montada para que se pueda salir o
          // cerrar, y se dice por qué. Los invitados no vuelven a entrar solos.
          setConnection('closed')
          setError('party.error.roomClosed')

          return
      }
    },
    [adoptarEstado, medirReloj],
  )

  /**
   * El flujo de eventos.
   *
   * Anfitrión e invitado usan el mismo: su propia instancia, con la sesión de la
   * pestaña. Al desmontar o al cambiar de sesión se aborta la lectura y el
   * coordinador libera la conexión por el `AbortSignal`.
   */
  useEffect(() => {
    if (session === undefined) return

    const controller = new AbortController()
    let vivo = true

    const consumir = async (): Promise<void> => {
      try {
        const eventos =
          session.kind === 'host'
            ? readHostPartyEvents(session.roomId, { signal: controller.signal })
            : readRemotePartyEvents({ signal: controller.signal })

        for await (const evento of eventos) {
          if (!vivo) return
          aplicarEvento(evento, session)
        }

        if (vivo) setConnection('closed')
      } catch (cause) {
        if (!vivo || controller.signal.aborted) return

        setConnection('error')
        setError(partyErrorKey(cause))
      }
    }

    setConnection('connecting')
    void consumir()

    return () => {
      vivo = false
      controller.abort()
    }
  }, [session, aplicarEvento])

  /**
   * El latido del anfitrión.
   *
   * Publica al cambiar lo que se nota en la cara —play, pausa, salto, velocidad—
   * y cada `PARTY_REPORT_INTERVAL_MS` mientras reproduce, para que quien entre a
   * mitad sepa por dónde va. El estado lo sella el servidor con su `atMs`.
   */
  useEffect(() => {
    if (session?.kind !== 'host' || video === null) return

    let vivo = true

    const publicar = (): void => {
      const media = mediaRef.current
      if (media === undefined) return

      void publishPartyState(session.roomId, hostStateOf(video, media)).catch((cause: unknown) => {
        if (vivo) setError(partyErrorKey(cause))
      })
    }

    const eventos = ['play', 'pause', 'seeked', 'ratechange', 'loadedmetadata'] as const
    for (const nombre of eventos) video.addEventListener(nombre, publicar)

    publicar()
    const latido = setInterval(() => {
      if (!video.paused) publicar()
    }, PARTY_REPORT_INTERVAL_MS)

    return () => {
      vivo = false
      clearInterval(latido)
      for (const nombre of eventos) video.removeEventListener(nombre, publicar)
    }
  }, [session, video])

  /**
   * Republica al cambiar de episodio.
   *
   * Va aparte del latido porque `media` es un objeto nuevo en cada render: con
   * él en las dependencias, el efecto se remontaría cuatro veces por segundo y
   * el anfitrión inundaría la sala. La clave serializada sólo cambia cuando
   * cambia de verdad lo que se publica.
   */
  useEffect(() => {
    if (session?.kind !== 'host' || video === null || mediaKey === '') return

    const media = mediaRef.current
    if (media === undefined) return

    let vivo = true
    void publishPartyState(session.roomId, hostStateOf(video, media)).catch((cause: unknown) => {
      if (vivo) setError(partyErrorKey(cause))
    })

    return () => {
      vivo = false
    }
  }, [session, video, mediaKey])

  /**
   * La corrección del invitado.
   *
   * Cada medio segundo se compara la posición real del `<video>` con la que
   * tendría el del anfitrión: por debajo de `PARTY_DRIFT_OK_S` no se toca nada;
   * hasta `PARTY_DRIFT_SEEK_S` se ajusta la velocidad; por encima, se salta. La
   * píldora de la barra dice en cuál de los tres tramos está.
   */
  useEffect(() => {
    if (session?.kind !== 'guest' || video === null) return

    const corregir = (): void => {
      const state = latestState.current
      if (state === undefined) {
        setSync('unknown')

        return
      }

      if (!clockReady.current) return

      const ahora = performance.now()
      const deriva = Math.abs(
        partyTargetPositionS(state, ahora, clockOffset.current) - video.currentTime,
      )

      applyCorrection(
        video,
        partyCorrection({
          currentS: video.currentTime,
          paused: video.paused,
          state,
          nowMs: ahora,
          offsetMs: clockOffset.current,
        }),
        state.rate,
      )

      // El protocolo devuelve `seek` cuando el anfitrión está en pausa y hay que
      // recolocarse: el salto no pausa por sí solo, así que la pausa se aplica
      // aquí. Sin esto, un invitado que reproducía se quedaba saltando cada
      // medio segundo sin parar nunca.
      if (state.paused && !video.paused) video.pause()

      setDriftS(Math.round(deriva * 10) / 10)
      setSync(
        deriva <= PARTY_DRIFT_OK_S ? 'ok' : deriva < PARTY_DRIFT_SEEK_S ? 'adjusting' : 'drift',
      )
    }

    corregir()
    const temporizador = setInterval(corregir, DRIFT_TICK_MS)

    return () => clearInterval(temporizador)
  }, [session, video])

  /** El invitado cuenta por dónde va, si almacena y si ya puede reproducir. */
  useEffect(() => {
    if (session?.kind !== 'guest' || video === null) return

    let vivo = true

    const reportar = (): void => {
      void reportRemotePosition(reportOf(video)).then(
        () => {
          if (vivo) setError((previo) => (previo === 'party.error.roomClosed' ? previo : undefined))
        },
        (cause: unknown) => {
          if (vivo) setError(partyErrorKey(cause))
        },
      )
    }

    reportar()
    const temporizador = setInterval(reportar, PARTY_REPORT_INTERVAL_MS)

    return () => {
      vivo = false
      clearInterval(temporizador)
    }
  }, [session, video])

  // Salir al desmontar: el coordinador libera el hueco del roster sin esperar a
  // que caduque la sala. Va en un efecto de montaje y no en el del flujo porque
  // el del flujo también se limpia al cambiar de sesión, y ya se habría salido.
  useEffect(() => {
    return () => {
      if (sessionRef.current?.kind === 'guest') void leaveRemoteRoom().catch(() => {})
    }
  }, [])

  const createRoom = useCallback(async (): Promise<void> => {
    if (busy.current) return

    busy.current = true
    setError(undefined)
    setConnection('connecting')

    try {
      const creada = await createPartyRoom()
      // Las direcciones son un atajo para invitar: si fallan, la sala existe y
      // se puede compartir la dirección de la barra del navegador.
      const urls = await readPartyInfo().then(
        (info) => info.urls,
        () => [],
      )

      setRoom({
        roomId: creada.roomId,
        code: creada.code,
        expiresAt: creada.expiresAt,
        urls,
      })
      setSession({
        kind: 'host',
        roomId: creada.roomId,
        code: creada.code,
        expiresAt: creada.expiresAt,
        urls,
      })
      setPhase('host')
    } catch (cause) {
      setConnection('error')
      setError(partyErrorKey(cause))
    } finally {
      busy.current = false
    }
  }, [])

  const joinRoom = useCallback(
    async (input: PartyJoinInput): Promise<void> => {
      if (busy.current) return

      const baseUrl = normalizeHostAddress(input.baseUrl)
      if (baseUrl === undefined) {
        setConnection('error')
        setError('party.error.address')

        return
      }

      const code = normalizeRoomCode(input.code)
      if (code === undefined) {
        setConnection('error')
        setError('party.error.code')

        return
      }

      const name = input.name.trim()
      if (name === '') {
        setConnection('error')
        setError('party.error.name')

        return
      }

      busy.current = true
      setError(undefined)
      setConnection('connecting')

      try {
        const entrada = await joinRemoteRoom({ baseUrl, code, name })

        if (entrada.state !== null) adoptarEstado(entrada.state)
        setRoster(entrada.roster)
        setRoom({ roomId: entrada.roomId, code, expiresAt: entrada.expiresAt, urls: [] })
        setSession({
          kind: 'guest',
          roomId: entrada.roomId,
          code,
          expiresAt: entrada.expiresAt,
          urls: [],
        })
        setPhase('guest')
      } catch (cause) {
        setConnection('error')
        setError(partyErrorKey(cause))
      } finally {
        busy.current = false
      }
    },
    [adoptarEstado],
  )

  const closeRoom = useCallback(async (): Promise<void> => {
    const actual = sessionRef.current
    if (actual?.kind !== 'host') return

    try {
      await closePartyRoom(actual.roomId)
    } catch (cause) {
      // La sala puede haber caducado ya: el estado local se cierra igual, que es
      // lo que la persona pidió.
      setError(partyErrorKey(cause))
    } finally {
      reiniciar()
    }
  }, [reiniciar])

  const leave = useCallback(async (): Promise<void> => {
    if (sessionRef.current?.kind !== 'guest') return

    try {
      await leaveRemoteRoom()
    } catch {
      // Salir es local: si el enlace ya no estaba, la sesión se cierra igual.
    } finally {
      reiniciar()
    }
  }, [reiniciar])

  return {
    phase,
    room,
    roster,
    connection,
    sync,
    driftS,
    error,
    hostMedia,
    createRoom,
    joinRoom,
    closeRoom,
    leave,
  }
}
