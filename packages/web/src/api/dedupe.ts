/**
 * Deduplicación de peticiones en vuelo.
 *
 * Dos montajes del mismo componente —o un remontaje rápido al cambiar de
 * pantalla— piden lo mismo dos veces. Aquí se comparte la promesa: la segunda
 * llamada espera la primera en lugar de abrir otra conexión contra un sitio de
 * terceros.
 *
 * Tres detalles que importan:
 *
 * - La entrada se borra **antes** de que ningún llamador continúe, no en un
 *   `finally` suelto: si no, una petición ya terminada sigue contando como en
 *   vuelo un par de ciclos del bucle de eventos, y la siguiente petición recibe
 *   el cuerpo de la anterior.
 * - Un fallo libera la clave, así que se puede reintentar.
 * - La clave la decide quien llama. Aquí no se adivina qué hace distinta a una
 *   petición de otra: lo sabe quien la construye.
 */

export interface Dedupe<T> {
  run(key: string, work: () => Promise<T>): Promise<T>
  /** Cuántas claves hay en vuelo. Para tests y para diagnósticos. */
  size(): number
}

export function createDedupe<T>(): Dedupe<T> {
  const inFlight = new Map<string, Promise<T>>()

  return {
    run(key, work) {
      const existing = inFlight.get(key)
      if (existing !== undefined) return existing

      const pending = work().then(
        (value) => {
          inFlight.delete(key)
          return value
        },
        (error: unknown) => {
          inFlight.delete(key)
          throw error
        },
      )

      inFlight.set(key, pending)
      // Un fallo que nadie escuche no debe salir como rechazo no gestionado.
      pending.catch(() => {})

      return pending
    },
    size: () => inFlight.size,
  }
}
