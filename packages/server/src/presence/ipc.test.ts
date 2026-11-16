import { describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { createDiscordIpc, pipeCandidates } from './ipc'

interface Frame {
  readonly op: number
  readonly datos: Record<string, unknown>
}

/** Un Discord de mentira: contesta el handshake y apunta lo que le mandan. */
async function discordFalso(
  ruta: string,
): Promise<{ readonly server: Server; readonly frames: Frame[] }> {
  const frames: Frame[] = []

  const server = createServer((socket: Socket) => {
    let buffer = Buffer.alloc(0)

    socket.on('data', (trozo: Buffer) => {
      buffer = Buffer.concat([buffer, trozo])

      while (buffer.length >= 8) {
        const op = buffer.readInt32LE(0)
        const largo = buffer.readInt32LE(4)
        if (buffer.length < 8 + largo) return

        const cuerpo = buffer.subarray(8, 8 + largo).toString('utf8')
        buffer = buffer.subarray(8 + largo)

        const datos = JSON.parse(cuerpo) as Record<string, unknown>
        frames.push({ op, datos })

        if (op === 0) {
          const ready = Buffer.from(
            JSON.stringify({ cmd: 'DISPATCH', evt: 'READY', data: {} }),
            'utf8',
          )
          const cabecera = Buffer.alloc(8)
          cabecera.writeInt32LE(1, 0)
          cabecera.writeInt32LE(ready.length, 4)
          socket.write(Buffer.concat([cabecera, ready]))
        }
      }
    })
  })

  await new Promise<void>((resolve) => server.listen(ruta, resolve))

  return { server, frames }
}

function rutaDelPipe(): string {
  const sufijo = `${process.pid}-${Date.now()}`

  return process.platform === 'win32'
    ? `\\\\.\\pipe\\rona-ipc-${sufijo}`
    : join(tmpdir(), `rona-ipc-${sufijo}.sock`)
}

describe('el cliente del IPC de Discord', () => {
  test('hace el handshake, valida el READY y manda SET_ACTIVITY', async () => {
    const ruta = rutaDelPipe()
    const falso = await discordFalso(ruta)

    try {
      const ipc = createDiscordIpc({
        appId: '1571721886742876321',
        pipePath: ruta,
        timeoutMs: 2_000,
      })
      await ipc.connect()

      expect(ipc.connected).toBe(true)
      expect(falso.frames[0]?.op).toBe(0)
      expect(falso.frames[0]?.datos).toEqual({
        v: 1,
        client_id: '1571721886742876321',
      })

      ipc.setActivity({ type: 3, details: 'Aurora Nocturna' })
      await Bun.sleep(100)

      const actividad = falso.frames.find((frame) => frame.op === 1)
      if (actividad === undefined) throw new Error('no llegó SET_ACTIVITY')

      const recibido = z
        .object({
          cmd: z.string(),
          args: z.object({ activity: z.object({ details: z.string() }) }),
        })
        .parse(actividad.datos)

      expect(recibido.cmd).toBe('SET_ACTIVITY')
      expect(recibido.args.activity.details).toBe('Aurora Nocturna')

      ipc.close()
      expect(ipc.connected).toBe(false)
    } finally {
      falso.server.close()
      if (process.platform !== 'win32') rmSync(ruta, { force: true })
    }
  })

  test('un pipe que no existe falla en vez de fingir que está conectado', async () => {
    const ipc = createDiscordIpc({
      appId: '1571721886742876321',
      pipePath: rutaDelPipe(),
      timeoutMs: 200,
    })

    await expect(ipc.connect()).rejects.toThrow('Discord')
    expect(ipc.connected).toBe(false)
  })

  test('los candidatos de Windows son los diez pipes de Discord', () => {
    if (process.platform !== 'win32') return

    expect(pipeCandidates().slice(0, 2)).toEqual([
      '\\\\.\\pipe\\discord-ipc-0',
      '\\\\.\\pipe\\discord-ipc-1',
    ])
    expect(pipeCandidates().length).toBe(10)
  })
})
