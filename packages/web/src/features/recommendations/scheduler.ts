/**
 * El planificador de peticiones del panel.
 *
 * Está separado del hook porque es la parte que **se puede probar**: un hook con
 * `setTimeout` y `AbortController` necesita un navegador y relojes de mentira,
 * mientras que esto son tres funciones y una promesa.
 *
 * Dos reglas, y las dos tienen su prueba:
 *
 * 1. **Un retardo.** Varias llamadas seguidas dentro del retardo producen **una**
 *    carga, con la última clave. Sin esto, escribir «mecha» serían cinco
 *    peticiones y cuatro respuestas que ya no sirven.
 * 2. **Se cancela lo anterior, y se cancela ya.** La carga en vuelo se aborta en
 *    cuanto llega una clave nueva, no cuando pasa el retardo: si se esperara,
 *    seguiría viva y su respuesta podría llegar la última y pintar datos viejos.
 */

export interface SchedulerOptions {
  readonly delayMs: number
  /** Carga una clave. Recibe la señal que se aborta al cancelar. */
  readonly load: (key: string, signal: AbortSignal) => Promise<void>
  /** Temporizadores inyectables: una prueba no espera 400 ms. */
  readonly setTimeoutFn?: (fn: () => void, ms: number) => unknown
  readonly clearTimeoutFn?: (id: unknown) => void
}

export interface Scheduler {
  /** Programa una carga. Cancela la anterior si la había. */
  schedule(key: string): void
  /** Cancela lo pendiente y lo que esté en vuelo. */
  cancel(): void
}

export function createScheduler(options: SchedulerOptions): Scheduler {
  const poner = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms))
  const quitar =
    options.clearTimeoutFn ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>))

  let temporizador: unknown
  let controlador: AbortController | undefined

  const cancelar = (): void => {
    if (temporizador !== undefined) {
      quitar(temporizador)
      temporizador = undefined
    }

    controlador?.abort()
    controlador = undefined
  }

  return {
    schedule(key) {
      // Se cancela **antes** de programar, no dentro del temporizador.
      cancelar()

      temporizador = poner(() => {
        temporizador = undefined
        const nuevo = new AbortController()
        controlador = nuevo

        void options.load(key, nuevo.signal).catch(() => {
          // Un fallo de carga se cuenta donde se cargó; aquí sólo se evita que la
          // promesa quede rechazada sin dueño.
        })
      }, options.delayMs)
    },
    cancel: cancelar,
  }
}
