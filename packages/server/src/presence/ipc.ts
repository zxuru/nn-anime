/**
 * El cliente del IPC de Discord.
 *
 * Es el protocolo de siempre —el que usa el cliente de escritorio—, no el SDK
 * propietario: una cabecera de ocho bytes (opcode y longitud, little-endian) y
 * un JSON. Aquí no hay OAuth, ni token, ni `client_secret`: el Application ID es
 * público y lo único que se envía es la actividad que se decidió publicar.
 *
 * **Se valida el handshake.** La librería de Rust que hace esto ignora la
 * respuesta (`TODO: Return an Err if the handshake is rejected`), así que un ID
 * inválido parece «conectado» y el fallo aparece más tarde y sin contexto. Aquí
 * un `ERROR` o un cierre antes del `READY` rechazan la conexión.
 *
 * El cliente no reintenta por su cuenta: `service.ts` decide cuándo volver a
 * intentarlo, para no abrir diez pipes por segundo cuando Discord no está.
 */

import { randomUUID } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import { join } from 'node:path'

const OP_HANDSHAKE = 0
const OP_FRAME = 1
const OP_CLOSE = 2
const OP_PING = 3
const OP_PONG = 4

/** Un frame no puede pedir un búfer absurdo por un dato corrupto. */
const MAX_FRAME_BYTES = 1_000_000

export interface DiscordIpc {
  readonly connected: boolean
  connect(): Promise<void>
  setActivity(activity: unknown): void
  clearActivity(): void
  close(): void
}

export interface DiscordIpcOptions {
  readonly appId: string
  /** Ruta exacta del pipe. Sólo la usan las pruebas; en producción se busca. */
  readonly pipePath?: string | undefined
  readonly timeoutMs?: number | undefined
}

/** Los pipes que puede haber abiertos, en el orden en que se prueban. */
export function pipeCandidates(): readonly string[] {
  if (process.platform === 'win32') {
    return Array.from({ length: 10 }, (_, i) => `\\\\.\\pipe\\discord-ipc-${i}`)
  }

  const bases = [
    process.env.XDG_RUNTIME_DIR,
    process.env.TMPDIR,
    process.env.TMP,
    process.env.TEMP,
    '/tmp',
  ].filter((base): base is string => base !== undefined && base.trim() !== '')

  const subrutas = [
    '',
    'app/com.discordapp.Discord/',
    'app/dev.vencord.Vesktop/',
    '.flatpak/com.discordapp.Discord/xdg-run/',
    '.flatpak/dev.vencord.Vesktop/xdg-run/',
    'snap.discord/',
    'snap.discord-canary/',
  ]

  const candidatos: string[] = []

  for (const base of bases) {
    for (let i = 0; i < 10; i++) {
      for (const subruta of subrutas) {
        candidatos.push(join(base, subruta, `discord-ipc-${i}`))
      }
    }
  }

  return candidatos
}

function frame(op: number, payload: unknown): Buffer {
  const cuerpo = Buffer.from(JSON.stringify(payload), 'utf8')
  const cabecera = Buffer.alloc(8)

  cabecera.writeInt32LE(op, 0)
  cabecera.writeInt32LE(cuerpo.length, 4)

  return Buffer.concat([cabecera, cuerpo])
}

export function createDiscordIpc(options: DiscordIpcOptions): DiscordIpc {
  const candidatos = options.pipePath === undefined ? pipeCandidates() : [options.pipePath]
  const timeoutMs = options.timeoutMs ?? 3_000

  let socket: Socket | undefined
  let buffer = Buffer.alloc(0)
  let conectado = false
  let handshake: { resolve: () => void; reject: (error: Error) => void } | undefined
  let temporizador: ReturnType<typeof setTimeout> | undefined

  const pararReloj = (): void => {
    if (temporizador !== undefined) clearTimeout(temporizador)
    temporizador = undefined
  }

  const fallar = (error: Error): void => {
    pararReloj()

    const pendiente = handshake
    handshake = undefined
    conectado = false

    const roto = socket
    socket = undefined
    roto?.destroy()

    pendiente?.reject(error)
  }

  const enviar = (op: number, payload: unknown): void => {
    if (socket === undefined) throw new Error('Discord IPC sin conexión')

    socket.write(frame(op, payload))
  }

  const alRecibir = (trozo: Buffer): void => {
    buffer = Buffer.concat([buffer, trozo])

    while (buffer.length >= 8) {
      const op = buffer.readInt32LE(0)
      const largo = buffer.readInt32LE(4)

      if (largo < 0 || largo > MAX_FRAME_BYTES) {
        fallar(new Error('frame de Discord inválido'))
        return
      }

      if (buffer.length < 8 + largo) return

      const cuerpo = buffer.subarray(8, 8 + largo).toString('utf8')
      buffer = buffer.subarray(8 + largo)

      let datos: Record<string, unknown>
      try {
        datos = JSON.parse(cuerpo) as Record<string, unknown>
      } catch {
        continue
      }

      if (op === OP_PING) {
        try {
          enviar(OP_PONG, datos)
        } catch {
          // El ping se contesta si se puede; si no, el `close` lo dirá.
        }
        continue
      }

      const evt = typeof datos.evt === 'string' ? datos.evt : undefined
      const mensaje = typeof datos.message === 'string' ? datos.message : undefined
      const anidado =
        typeof datos.data === 'object' && datos.data !== null
          ? (datos.data as Record<string, unknown>)
          : undefined
      const mensajeAnidado = typeof anidado?.message === 'string' ? anidado.message : undefined

      if (evt === 'READY') {
        conectado = true
        pararReloj()
        const pendiente = handshake
        handshake = undefined
        pendiente?.resolve()
        continue
      }

      if (evt === 'ERROR' || op === OP_CLOSE) {
        fallar(new Error(mensaje ?? mensajeAnidado ?? 'Discord rechazó la conexión'))
        return
      }
    }
  }

  const conectarA = (ruta: string): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const intento = createConnection({ path: ruta })

      const alError = (error: Error): void => {
        intento.destroy()
        reject(error)
      }

      intento.once('error', alError)
      intento.once('connect', () => {
        intento.off('error', alError)
        resolve(intento)
      })
    })

  const connect = async (): Promise<void> => {
    if (conectado && socket !== undefined) return

    let ultimo: Error | undefined

    for (const ruta of candidatos) {
      try {
        socket = await conectarA(ruta)
        break
      } catch (error) {
        ultimo = error instanceof Error ? error : new Error(String(error))
      }
    }

    if (socket === undefined) {
      throw new Error(
        `Discord no está abierto o no expone su IPC${ultimo === undefined ? '' : `: ${ultimo.message}`}`,
      )
    }

    buffer = Buffer.alloc(0)
    socket.on('data', alRecibir)
    socket.on('error', (error) => fallar(error))
    socket.on('close', () => {
      if (conectado) fallar(new Error('Discord cerró la conexión'))
    })

    const espera = new Promise<void>((resolve, reject) => {
      handshake = { resolve, reject }
    })

    temporizador = setTimeout(
      () => fallar(new Error('Discord no contestó al handshake')),
      timeoutMs,
    )

    enviar(OP_HANDSHAKE, { v: 1, client_id: options.appId })

    await espera
  }

  const setActivity = (activity: unknown): void => {
    enviar(OP_FRAME, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity },
      nonce: randomUUID(),
    })
  }

  const clearActivity = (): void => {
    enviar(OP_FRAME, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity: null },
      nonce: randomUUID(),
    })
  }

  const close = (): void => {
    pararReloj()
    conectado = false

    const saliente = socket
    socket = undefined

    if (saliente !== undefined) {
      try {
        saliente.write(frame(OP_CLOSE, {}))
      } catch {
        // Ya estaba roto: cerrar es lo único que queda.
      }

      saliente.end()
      saliente.destroy()
    }
  }

  return {
    get connected() {
      return conectado
    },
    connect,
    setActivity,
    clearActivity,
    close,
  }
}
