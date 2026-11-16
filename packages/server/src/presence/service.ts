/**
 * El servicio que decide cuándo se habla con Discord.
 *
 * El reproductor manda fotos del visionado a menudo; Discord admite cinco
 * actualizaciones cada veinte segundos. Aquí se queda la última foto y se envía
 * como mucho una cada `minIntervalMs` (cinco segundos por defecto), así que el
 * estado que gana es siempre el más reciente y no se gasta la cuota.
 *
 * Si Discord no está abierto, **no se reintenta en bucle**: se apunta un
 * reintento a un minuto y las fotos siguientes se descartan hasta entonces. Un
 * proceso que abre diez pipes por segundo porque el usuario no tiene Discord es
 * peor que no tener presencia.
 */

import { buildActivity, DISCORD_APP_ID, type PresenceSnapshot } from './activity'
import { createDiscordIpc, type DiscordIpc } from './ipc'

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
  readonly minIntervalMs?: number | undefined
  readonly retryMs?: number | undefined
  readonly createIpc?: ((options: { appId: string; pipePath?: string }) => DiscordIpc) | undefined
}

export function createPresenceService(options: PresenceServiceOptions = {}): PresenceService {
  const appId = options.appId ?? process.env.RONA_DISCORD_APP_ID ?? DISCORD_APP_ID
  const pipePath = options.pipePath ?? process.env.RONA_DISCORD_IPC
  const now = options.now ?? Date.now
  const minIntervalMs = options.minIntervalMs ?? 5_000
  const retryMs = options.retryMs ?? 60_000
  const crearIpc =
    options.createIpc ??
    ((ipcOptions: { appId: string; pipePath?: string }) =>
      createDiscordIpc({ appId: ipcOptions.appId, pipePath: ipcOptions.pipePath }))

  let ipc: DiscordIpc | undefined
  let pendiente: PresenceSnapshot | undefined
  let temporizador: ReturnType<typeof setTimeout> | undefined
  let ultimoEnvio = 0
  let ultimoJson = ''
  let reintentoEn = 0
  let cerrado = false

  const programar = (esperaMs: number): void => {
    if (temporizador !== undefined) return

    temporizador = setTimeout(
      () => {
        temporizador = undefined
        void enviar()
      },
      Math.max(0, esperaMs),
    )
  }

  const enviar = async (): Promise<void> => {
    const foto = pendiente
    pendiente = undefined

    if (foto === undefined || cerrado) return
    if (now() < reintentoEn) return

    const activity = buildActivity(foto, now())
    const json = JSON.stringify(activity)

    // La misma foto no se repite: Discord ya la tiene y gastaría cuota.
    if (json === ultimoJson && ipc?.connected === true) return

    try {
      if (ipc === undefined || !ipc.connected) {
        ipc = crearIpc({ appId, ...(pipePath === undefined ? {} : { pipePath }) })
        await ipc.connect()
      }

      ipc.setActivity(activity)
      ultimoJson = json
      ultimoEnvio = now()
      reintentoEn = 0
    } catch {
      // Discord cerrado, pipe ocupado o handshake rechazado: se cierra lo que
      // haya y se espera. No se registra el título: la presencia es del usuario.
      ipc?.close()
      ipc = undefined
      ultimoJson = ''
      reintentoEn = now() + retryMs
    }
  }

  const update = (snapshot: PresenceSnapshot): void => {
    if (cerrado) return

    pendiente = snapshot

    if (now() < reintentoEn) return

    const espera = minIntervalMs - (now() - ultimoEnvio)
    if (espera > 0) {
      programar(espera)
      return
    }

    void enviar()
  }

  const clear = (): void => {
    pendiente = undefined

    if (temporizador !== undefined) {
      clearTimeout(temporizador)
      temporizador = undefined
    }

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
