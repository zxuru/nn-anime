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

export interface SignalTarget {
  on(event: TerminatingSignal, handler: () => void): unknown
  off(event: TerminatingSignal, handler: () => void): unknown
}

/** Convención de shell: 128 más el número de la señal. */
export function signalExitCode(signal: TerminatingSignal): number {
  return signal === 'SIGINT' ? 130 : 143
}

/**
 * Espera a la primera señal de terminación y quita el resto de escuchas.
 *
 * Sin quitar la escucha de la otra señal, un segundo Ctrl+C durante el cierre
 * dispararía un manejador que ya no corresponde a nadie.
 */
export function waitForSignal(target: SignalTarget): Promise<TerminatingSignal> {
  return new Promise((resolve) => {
    const cleanup = (): void => {
      target.off('SIGINT', onInterrupt)
      target.off('SIGTERM', onTerminate)
    }

    const onInterrupt = (): void => {
      cleanup()
      resolve('SIGINT')
    }

    const onTerminate = (): void => {
      cleanup()
      resolve('SIGTERM')
    }

    target.on('SIGINT', onInterrupt)
    target.on('SIGTERM', onTerminate)
  })
}
