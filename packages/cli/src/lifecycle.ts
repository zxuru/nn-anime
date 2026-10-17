/**
 * Ciclo de vida del proceso: registro de tareas de cierre y señales.
 *
 * El cierre se ejecuta **en orden de registro**, que es el orden inverso al de
 * arranque de los recursos. Un cierre que falla no impide los siguientes: al
 * salir, dejar el resto de recursos abiertos es peor que perder un error.
 */

export type Closer = () => void | Promise<void>

export interface Lifecycle {
  /** Registra una tarea de cierre. Devuelve la forma de desregistrarla. */
  onShutdown(closer: Closer): () => void
  /** Idempotente: la segunda llamada devuelve la misma promesa. */
  shutdown(): Promise<void>
  readonly size: number
}

export interface LifecycleOptions {
  /** Se llama por cada cierre que falla, en lugar de tragarse el error. */
  readonly onError?: (error: unknown) => void
}

export function createLifecycle(options: LifecycleOptions = {}): Lifecycle {
  const closers: Closer[] = []
  let closing: Promise<void> | undefined

  return {
    get size(): number {
      return closers.length
    },

    onShutdown(closer: Closer): () => void {
      closers.push(closer)

      return () => {
        const index = closers.indexOf(closer)
        if (index !== -1) closers.splice(index, 1)
      }
    },

    shutdown(): Promise<void> {
      if (closing !== undefined) return closing

      closing = (async () => {
        for (const closer of closers) {
          try {
            await closer()
          } catch (error) {
            options.onError?.(error)
          }
        }
      })()

      return closing
    },
  }
}

export type TerminatingSignal = 'SIGINT' | 'SIGTERM'

/**
 * Por qué se está cerrando.
 *
 * `stdin` no es una señal: es una **petición**, y por eso tiene su propio código
 * de salida. Existe porque en Windows no hay `SIGTERM` de verdad —matar el
 * proceso que se lanzó es `TerminateProcess`, sin señal y sin `finally`—, así que
 * un anfitrión que arranca el servidor y quiere pararlo con orden necesita una
 * forma de pedirlo que exista en las tres plataformas, y una línea por la entrada
 * estándar lo es.
 */
export type ClosingReason = TerminatingSignal | 'stdin'

export interface SignalTarget {
  on(event: TerminatingSignal, handler: () => void): unknown
  off(event: TerminatingSignal, handler: () => void): unknown
}

/** Lo mínimo de un trozo de entrada: poder leerlo como texto. */
export interface Chunk {
  toString(): string
}

export interface StdinTarget {
  on(event: 'data', handler: (chunk: Chunk) => void): unknown
  off(event: 'data', handler: (chunk: Chunk) => void): unknown
}

/** Convención de shell: 128 más el número de la señal. */
export function signalExitCode(signal: TerminatingSignal): number {
  return signal === 'SIGINT' ? 130 : 143
}

/**
 * Código de salida por motivo.
 *
 * Un cierre pedido por la entrada estándar es un cierre limpio y sale con `0`: no
 * hubo señal, hubo una petición que se atendió entera.
 */
export function exitCodeFor(reason: ClosingReason): number {
  return reason === 'stdin' ? 0 : signalExitCode(reason)
}

/** La línea que pide el cierre por la entrada estándar. */
export const SHUTDOWN_LINE = 'shutdown'

/**
 * Espera a la primera señal **o** a la línea `shutdown` por la entrada estándar.
 *
 * El **fin** de la entrada no cierra nada, y es deliberado. La forma normal de
 * lanzar este servidor es con la entrada cerrada —`stdin: 'ignore'` en el `smoke`
 * del paquete, en el servidor del e2e y en los tres scripts de empaquetado—, así
 * que cerrar por un `end` mataría el servidor al nacer y el CI se pondría rojo en
 * las tres plataformas. Al anfitrión que muere de golpe lo cubre el sistema
 * operativo, no esta función: Job Object en Windows y `PR_SET_PDEATHSIG` en Linux.
 *
 * Las tres escuchas se quitan al resolver: sin eso, un segundo Ctrl+C durante el
 * cierre dispararía un manejador que ya no corresponde a nadie.
 */
export function waitForClose(target: SignalTarget, stdin: StdinTarget): Promise<ClosingReason> {
  return new Promise((resolve) => {
    /** Lo que quedó de una línea a medias, para el trozo siguiente. */
    let pending = ''
    let settled = false

    const cleanup = (): void => {
      target.off('SIGINT', onInterrupt)
      target.off('SIGTERM', onTerminate)
      stdin.off('data', onData)
    }

    const finish = (reason: ClosingReason): void => {
      if (settled) return

      settled = true
      cleanup()
      resolve(reason)
    }

    const onInterrupt = (): void => {
      finish('SIGINT')
    }

    const onTerminate = (): void => {
      finish('SIGTERM')
    }

    const onData = (chunk: Chunk): void => {
      // La línea puede llegar partida en dos trozos —`shut` y `down\n`—: quien
      // escribe no tiene por qué vaciar el búfer de una vez. Sin guardar el resto
      // del último trozo, ese cierre se perdería sin decir nada.
      pending += chunk.toString()
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''

      if (lines.some((line) => line.trim() === SHUTDOWN_LINE)) finish('stdin')
    }

    target.on('SIGINT', onInterrupt)
    target.on('SIGTERM', onTerminate)
    stdin.on('data', onData)
  })
}
