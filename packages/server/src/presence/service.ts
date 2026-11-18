/**
 * El servicio que decide cuándo se habla con Discord.
 *
 * El reproductor manda fotos del visionado a menudo; Discord admite cinco
 * actualizaciones cada veinte segundos. Aquí se queda la última foto y se envía
 * cuando la cuota lo permite, así que el estado que gana es siempre el más
 * reciente.
 *
 * La cuota es una **ventana deslizante** y no un intervalo fijo: con un envío
 * cada cinco segundos, una pausa que llegaba dos segundos después de una foto
 * esperaba tres a publicarse, y Discord seguía contando el reloj como si el
 * episodio estuviera en marcha. Ahora los cambios de estado —pausa, reanudación,
 * otro título— salen en el acto, y lo que sólo avanza en el tiempo se agrupa en
 * un turno cada dos segundos para no gastar la ventana arrastrando la barra.
 *
 * Si Discord no está abierto, **no se reintenta en bucle**: se apunta un
 * reintento a un minuto y la última foto se queda esperando a que pase. Antes se
 * descartaba, y una pausa que caía dentro de ese minuto no se publicaba nunca:
 * el perfil se quedaba diciendo que se estaba viendo algo que ya no.
 */

import { buildActivity, DISCORD_APP_ID, type PresenceSnapshot } from './activity'
import { createDiscordIpc, type DiscordIpc } from './ipc'

/** Lo que se agrupa una actualización que sólo avanza: dos segundos. */
export const MIN_GAP_MS = 2_000

/** La cuota de Discord: cinco actualizaciones cada veinte segundos. */
export const WINDOW_MS = 20_000
export const MAX_IN_WINDOW = 5

export interface PresenceService {
  /** Publica la última foto. No bloquea: el envío va por detrás. */
  update(snapshot: PresenceSnapshot): void
  /** Retira la actividad y cierra la conexión. */
  clear(): void
  /** `true` sólo después del READY de Discord. */
  connected(): boolean
  close(): Promise<void>
}

export interface PresenceServiceOptions {
  readonly appId?: string | undefined
  readonly pipePath?: string | undefined
  readonly now?: (() => number) | undefined
  /**
   * El temporizador, por defecto `setTimeout`.
   *
   * Se inyecta para poder medir la ventana de veinte segundos sin esperarla: con
   * el reloj de las pruebas en falso, un `setTimeout` de verdad dejaría la suite
   * parada veinte segundos por caso.
   */
  readonly programar?: ((fn: () => void, ms: number) => unknown) | undefined
  readonly cancelar?: ((id: unknown) => void) | undefined
  readonly minGapMs?: number | undefined
  readonly windowMs?: number | undefined
  readonly maxInWindow?: number | undefined
  readonly retryMs?: number | undefined
  readonly createIpc?: ((options: { appId: string; pipePath?: string }) => DiscordIpc) | undefined
}

/**
 * Cuánto hay que esperar antes de hablar con Discord, en milisegundos.
 *
 * Dos reglas y la que más tarde:
 *
 * - **El turno.** Una foto que sólo avanza la posición no sale antes de
 *   `minGapMs` desde la anterior: arrastrar la barra no puede mandar veinte
 *   avisos. Un cambio de estado —pausa, reanudación, otro título— no espera ese
 *   turno: es lo que el usuario está mirando en su perfil.
 * - **La cuota.** Cinco por ventana deslizante. Si la ventana está llena, se
 *   espera a que caduque la marca más vieja que tenga que salir.
 *
 * Es una función pura para poder medir los bordes —la foto número seis, la que
 * llega justo al cumplirse la ventana— sin temporizadores de por medio.
 */
export function esperaDeEnvio(input: {
  readonly ahora: number
  readonly ultimoEnvio: number
  readonly hayAnterior: boolean
  readonly cambiaElEstado: boolean
  readonly marcas: readonly number[]
  readonly windowMs: number
  readonly maxInWindow: number
  readonly minGapMs: number
}): number {
  const ritmo =
    input.hayAnterior && input.cambiaElEstado
      ? 0
      : input.minGapMs - (input.ahora - input.ultimoEnvio)

  const enVentana = input.marcas.filter((marca) => input.ahora - marca < input.windowMs)
  // Cuántas tienen que caducar para que quepa una más. Las marcas van en orden,
  // así que la última de las que sobran dice cuándo se abre el hueco.
  const sobran = enVentana.length - input.maxInWindow + 1
  const cuota = sobran > 0 ? (enVentana[sobran - 1] ?? 0) + input.windowMs - input.ahora : 0

  return Math.max(0, ritmo, cuota)
}

/**
 * ¿La foto nueva cuenta otra cosa que la anterior?
 *
 * La pausa, el modo, el título, el episodio y la duración son estado: se
 * publican en el acto. La duración entra porque pasar de «no sé cuánto dura» a
 * saberlo es lo que hace aparecer la barra de progreso en Discord: esperar el
 * turno dejaba al perfil sin barra los primeros segundos.
 *
 * La posición no: ésa sólo avanza, y entre foto y foto el reloj lo lleva Discord.
 */
export function cambiaElEstado(
  foto: PresenceSnapshot,
  anterior: PresenceSnapshot | undefined,
): boolean {
  if (anterior === undefined) return true

  return (
    foto.paused !== anterior.paused ||
    foto.mode !== anterior.mode ||
    foto.title !== anterior.title ||
    foto.episodeNumber !== anterior.episodeNumber ||
    foto.durationS !== anterior.durationS
  )
}

export function createPresenceService(options: PresenceServiceOptions = {}): PresenceService {
  const appId = options.appId ?? process.env.RONA_DISCORD_APP_ID ?? DISCORD_APP_ID
  const pipePath = options.pipePath ?? process.env.RONA_DISCORD_IPC
  const now = options.now ?? Date.now
  const minGapMs = options.minGapMs ?? MIN_GAP_MS
  const windowMs = options.windowMs ?? WINDOW_MS
  const maxInWindow = options.maxInWindow ?? MAX_IN_WINDOW
  const retryMs = options.retryMs ?? 60_000
  const programar =
    options.programar ??
    ((fn: () => void, ms: number) => setTimeout(fn, Math.max(0, ms)) as unknown)
  const cancelar =
    options.cancelar ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>))
  const crearIpc =
    options.createIpc ??
    ((ipcOptions: { appId: string; pipePath?: string }) =>
      createDiscordIpc({ appId: ipcOptions.appId, pipePath: ipcOptions.pipePath }))

  let ipc: DiscordIpc | undefined
  let pendiente: PresenceSnapshot | undefined
  let temporizador: unknown
  let ultimoEnvio = 0
  let ultimoJson = ''
  let reintentoEn = 0
  let cerrado = false
  /** Una conversación con Discord a la vez: dos handshakes abrirían dos pipes. */
  let enviando = false
  /** Lo último que Discord aceptó, para saber qué cambió desde entonces. */
  let anterior: PresenceSnapshot | undefined
  /** Las horas de los envíos que aún cuentan para la ventana. */
  let marcas: number[] = []
  /**
   * La generación de la actividad publicada.
   *
   * `clear()` la sube. Un envío que estaba esperando el handshake cuando se apagó
   * el ajuste se encuentra con otra generación y se descarta: si no, la presencia
   * apagada volvía sola en cuanto terminaba la conexión.
   */
  let generacion = 0

  const agendar = (esperaMs: number): void => {
    if (temporizador !== undefined || cerrado) return

    temporizador = programar(
      () => {
        temporizador = undefined
        void enviar()
      },
      Math.max(0, esperaMs),
    )
  }

  const cancelarTurno = (): void => {
    if (temporizador === undefined) return

    cancelar(temporizador)
    temporizador = undefined
  }

  const enviar = async (): Promise<void> => {
    if (cerrado || enviando) return

    const foto = pendiente
    if (foto === undefined) return

    // Discord cerrado o handshake rechazado: la foto no se tira. Se queda
    // esperando a que venza el reintento, y si llega otra antes, manda la nueva.
    if (now() < reintentoEn) {
      agendar(reintentoEn - now())
      return
    }

    const espera = esperaDeEnvio({
      ahora: now(),
      ultimoEnvio,
      hayAnterior: anterior !== undefined,
      cambiaElEstado: cambiaElEstado(foto, anterior),
      marcas,
      windowMs,
      maxInWindow,
      minGapMs,
    })

    if (espera > 0) {
      agendar(espera)
      return
    }

    pendiente = undefined
    const activity = buildActivity(foto, now())
    const json = JSON.stringify(activity)
    const turno = generacion

    // La misma foto no se repite: Discord ya la tiene y gastaría cuota.
    if (json === ultimoJson && ipc?.connected === true) {
      anterior = foto
      return
    }

    enviando = true

    try {
      let conexion = ipc

      if (conexion === undefined || !conexion.connected) {
        const nueva = crearIpc({ appId, ...(pipePath === undefined ? {} : { pipePath }) })
        await nueva.connect()

        // Se apagó la presencia mientras se abría el pipe: esta actividad ya no
        // vale, y la conexión tampoco.
        if (turno !== generacion) {
          nueva.close()
          return
        }

        ipc = nueva
        conexion = nueva
      }

      conexion.setActivity(activity)
      ultimoJson = json
      ultimoEnvio = now()
      marcas = [...marcas.filter((marca) => ultimoEnvio - marca < windowMs), ultimoEnvio]
      anterior = foto
      reintentoEn = 0
    } catch {
      // Discord cerrado, pipe ocupado o handshake rechazado: se cierra lo que
      // haya y se espera. No se registra el título: la presencia es del usuario.
      ipc?.close()
      ipc = undefined
      ultimoJson = ''
      reintentoEn = now() + retryMs

      // La foto vuelve a la cola. Si mientras se intentaba llegó otra, ésa manda.
      if (pendiente === undefined && turno === generacion) pendiente = foto
    } finally {
      enviando = false

      // Lo que llegó mientras se hablaba con Discord —o la foto que acaba de
      // fallar— sale en el turno siguiente, no se queda esperando a otra foto.
      if (!cerrado && turno === generacion && pendiente !== undefined) {
        agendar(now() < reintentoEn ? reintentoEn - now() : 0)
      }
    }
  }

  const update = (snapshot: PresenceSnapshot): void => {
    if (cerrado) return

    pendiente = snapshot

    if (enviando) return

    /*
     * Si ya hay un turno apuntado, la foto nueva viaja en él —`enviar` lee la
     * última, no la que lo programó—. La excepción es un cambio de estado: la
     * pausa no espera a un turno pensado para una foto que sólo avanzaba.
     */
    if (temporizador !== undefined) {
      if (!cambiaElEstado(snapshot, anterior)) return

      cancelarTurno()
    }

    if (now() < reintentoEn) {
      agendar(reintentoEn - now())
      return
    }

    void enviar()
  }

  const clear = (): void => {
    pendiente = undefined
    cancelarTurno()
    generacion += 1

    if (ipc !== undefined) {
      try {
        if (ipc.connected) ipc.clearActivity()
      } catch {
        // Si ya no hay conexión, cerrar es todo lo que hace falta.
      }

      ipc.close()
      ipc = undefined
    }

    ultimoJson = ''
    ultimoEnvio = 0
    reintentoEn = 0
    anterior = undefined
    marcas = []
  }

  return {
    update,
    clear,
    connected: () => ipc?.connected === true,
    close: async () => {
      cerrado = true
      clear()
    },
  }
}
