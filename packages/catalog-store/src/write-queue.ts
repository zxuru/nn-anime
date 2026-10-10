/**
 * Cola de escritura: un solo escritor, en orden.
 *
 * SQLite admite muchas lecturas a la vez pero **una sola escritura**. Con varias
 * conexiones —o con una escritura de fondo que empieza mientras otra está a
 * medias— eso se convierte en `SQLITE_BUSY`, y el error aparece en el sitio más
 * incómodo: en mitad de una revalidación que el usuario no pidió.
 *
 * Aquí se serializa por construcción: cada trabajo espera a que termine el
 * anterior. No es un `mutex` con reintentos ni un `busy_timeout` más largo; es
 * que nunca hay dos escrituras a la vez, así que no hay nada que reintentar.
 *
 * Un trabajo que falla **no rompe la cola**: la cadena sigue con el siguiente, y
 * el error se le devuelve sólo a quien lo pidió.
 */

import { StoreError } from '@nn-anime/core'

export interface WriteQueue {
  /** Encola un trabajo y devuelve su resultado. */
  run<T>(task: () => T | Promise<T>): Promise<T>
  /** Trabajos en cola o en curso. */
  pending(): number
  closed(): boolean
  /** Espera a que se vacíe. No cierra la cola. */
  drain(): Promise<void>
  /** Deja de aceptar trabajo. Lo que ya está en cola termina. */
  close(): void
}

export function createWriteQueue(): WriteQueue {
  let cola: Promise<unknown> = Promise.resolve()
  let pendientes = 0
  let cerrada = false

  return {
    run<T>(task: () => T | Promise<T>): Promise<T> {
      if (cerrada) {
        return Promise.reject(
          new StoreError({
            message: 'la cola de escritura está cerrada y no admite más trabajo',
            scope: 'catalog-store',
            op: 'writeQueue',
          }),
        )
      }

      pendientes += 1
      const resultado = cola.then(() => task())

      // La cadena sigue aunque este trabajo falle: si no, un fallo dejaría la
      // cola rota y ninguna escritura posterior llegaría a ejecutarse.
      cola = resultado.then(
        () => undefined,
        () => undefined,
      )

      return resultado.finally(() => {
        pendientes -= 1
      })
    },
    pending: () => pendientes,
    closed: () => cerrada,
    async drain() {
      await cola
    },
    close() {
      cerrada = true
    },
  }
}
