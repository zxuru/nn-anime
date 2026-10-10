/**
 * Control de mpv.
 *
 * mpv se lanza como proceso hijo y se sigue por eventos. Tres reglas que vienen
 * del spec y que no son negociables:
 *
 * 1. **Los argumentos van en un array.** Nunca se construye una línea de
 *    comandos por concatenación: un `Referer` con un espacio o un `;` sería una
 *    inyección de argumentos, y el array la hace imposible por construcción.
 * 2. **`--no-config`.** Sin él, mpv lee la configuración del usuario y puede
 *    acabar haciendo algo que este programa no pidió. El reproductor lo lanza
 *    nn-anime, no el usuario.
 * 3. **Ningún proceso queda huérfano.** Al cerrar la aplicación se matan todos
 *    los que siguan vivos: un mpv suelto es una ventana que nadie puede cerrar y
 *    una conexión contra un sitio de terceros que sigue abierta.
 *
 * El estado se reparte por un flujo de eventos con varios suscriptores: la
 * interfaz se conecta por SSE, y si se recarga la página, el nuevo suscriptor
 * recibe lo que pase a partir de ahí sin que el proceso se entere.
 */

import { AppError } from '@nn-anime/core'
import { invalidHeaderError, type MpvArgsOptions, mpvArgs } from './mpv-args'

export {
  HEADER_FIELD_FLAG,
  HEADER_NAME_RE,
  invalidHeaderError,
  type MpvArgsOptions,
  type MpvArgsOutcome,
  mpvArgs,
  validHeaderName,
  validHeaderValue,
} from './mpv-args'

/** Tope del `stderr` que se devuelve en un fallo, del spec. */
export const MAX_STDERR_BYTES = 2048

/** Los argumentos que mpv recibiría. Se reexporta para quien sólo mire la lista. */
export type PlayOptions = MpvArgsOptions

export type MpvEvent =
  | { readonly type: 'starting'; readonly pid: number }
  | { readonly type: 'playing'; readonly pid: number }
  | { readonly type: 'exited'; readonly pid: number; readonly code: number }
  | {
      readonly type: 'failed'
      readonly pid: number
      readonly code: number
      readonly stderr: string
    }

export interface MpvProcess {
  readonly pid: number
  readonly exited: Promise<number>
  kill(signal?: string): void
  /** Lo que escribió en `stderr`, ya recortado al tope. */
  stderr(): Promise<string>
}

export type SpawnMpv = (args: readonly string[]) => MpvProcess

export interface MpvPlayerOptions {
  readonly spawn: SpawnMpv
  /** Si mpv está disponible. Lo decide quien mira el `PATH`. */
  readonly available?: boolean
  /** Procesos a la vez. El spec dice uno. */
  readonly maxConcurrent?: number
  /** Retardo antes de anunciar `playing`: mpv tarda en abrir la ventana. */
  readonly playingDelayMs?: number
}

export type PlayOutcome =
  | { readonly ok: true; readonly pid: number }
  | {
      readonly ok: false
      readonly reason: 'unavailable' | 'busy' | 'invalid-header'
      /** El nombre de la cabecera que no se pudo usar, si es ese el motivo. */
      readonly header?: string
    }

export interface MpvPlayer {
  readonly available: boolean
  /** Cuántos procesos vivos hay. */
  readonly running: number
  play(options: PlayOptions): PlayOutcome
  stop(pid: number): boolean
  events(): AsyncIterable<MpvEvent>
  close(): Promise<void>
}

/** Un mpv que no está instalado, con su mensaje. */
export function mpvUnavailable(): AppError {
  return new AppError({
    code: 'internal',
    message: 'no se encontró mpv en el PATH; se puede reproducir en el navegador',
    context: { binary: 'mpv' },
    scope: 'media-proxy',
    op: 'playMpv',
  })
}

/** Recorta el `stderr` al tope, avisando de que se recortó. */
export function trimStderr(text: string, max: number = MAX_STDERR_BYTES): string {
  if (text.length <= max) return text

  return `${text.slice(0, max)}… (recortado)`
}

export function createMpvPlayer(options: MpvPlayerOptions): MpvPlayer {
  const maxConcurrent = options.maxConcurrent ?? 1
  const delay = options.playingDelayMs ?? 300
  const vivos = new Map<number, MpvProcess>()
  const suscriptores = new Set<(evento: MpvEvent) => void>()

  const emitir = (evento: MpvEvent): void => {
    for (const suscriptor of suscriptores) suscriptor(evento)
  }

  const seguir = (proceso: MpvProcess): void => {
    emitir({ type: 'starting', pid: proceso.pid })

    // `playing` se anuncia con un retardo: mpv tarda en abrir la ventana, y
    // decir «reproduciendo» en el mismo instante en que se lanza es mentira.
    const anuncio = setTimeout(() => {
      if (vivos.has(proceso.pid)) emitir({ type: 'playing', pid: proceso.pid })
    }, delay)

    void proceso.exited.then(async (code) => {
      clearTimeout(anuncio)
      vivos.delete(proceso.pid)

      if (code === 0) {
        emitir({ type: 'exited', pid: proceso.pid, code })

        return
      }

      emitir({
        type: 'failed',
        pid: proceso.pid,
        code,
        stderr: trimStderr(await proceso.stderr().catch(() => '')),
      })
    })
  }

  return {
    available: options.available ?? true,

    get running() {
      return vivos.size
    },

    play(entrada) {
      if (!this.available) return { ok: false, reason: 'unavailable' }
      if (vivos.size >= maxConcurrent) return { ok: false, reason: 'busy' }

      // La validación va **antes** de lanzar nada: un header inválido no abre
      // una ventana que luego haya que matar.
      const construidos = mpvArgs(entrada)
      if (!construidos.ok)
        return { ok: false, reason: 'invalid-header', header: construidos.header }

      const proceso = options.spawn(construidos.args)
      vivos.set(proceso.pid, proceso)
      seguir(proceso)

      return { ok: true, pid: proceso.pid }
    },

    stop(pid) {
      const proceso = vivos.get(pid)
      if (proceso === undefined) return false

      proceso.kill()

      return true
    },

    async *events() {
      // Cada suscriptor tiene su cola: el flujo es compartido, las colas no.
      const cola: MpvEvent[] = []
      let despertar: (() => void) | undefined
      let cerrado = false

      suscriptores.add((evento) => {
        cola.push(evento)
        despertar?.()
      })

      try {
        while (!cerrado) {
          if (cola.length === 0) {
            await new Promise<void>((resolver) => {
              despertar = resolver
            })
            despertar = undefined
            continue
          }

          const evento = cola.shift()
          if (evento !== undefined) yield evento
        }
      } finally {
        cerrado = true
        suscriptores.clear()
      }
    },

    async close() {
      const procesos = [...vivos.values()]
      vivos.clear()

      for (const proceso of procesos) proceso.kill()
      await Promise.allSettled(procesos.map((proceso) => proceso.exited))
    },
  }
}

/** ¿Está mpv en el `PATH`? */
export async function hasMpv(
  which: (binary: string) => Promise<string | undefined>,
): Promise<boolean> {
  try {
    return (await which('mpv')) !== undefined
  } catch {
    return false
  }
}

/**
 * El lanzador de verdad, con `Bun.spawn`.
 *
 * Se pasa como dependencia para poder probar todo lo demás sin abrir una
 * ventana: una prueba que lanza mpv de verdad no se puede ejecutar en cualquier
 * máquina.
 */
export function spawnMpvProcess(args: readonly string[]): MpvProcess {
  const proceso = Bun.spawn(['mpv', ...args], {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
  })

  let buffer = ''

  void (async () => {
    const lector = proceso.stderr.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await lector.read()
      if (done) break

      buffer = trimStderr(buffer + decoder.decode(value))
    }
  })()

  return {
    pid: proceso.pid,
    exited: proceso.exited,
    kill: (signal?: string) => proceso.kill(signal as never),
    stderr: async () => buffer,
  }
}
