/**
 * Revalidación de fondo.
 *
 * Cuando un dato está vencido pero sigue siendo servible, se responde ya y se
 * refresca por detrás. Ese refresco tiene dos reglas que no son obvias:
 *
 * 1. **Deduplicado por clave.** Si el usuario abre el mismo título en dos
 *    pestañas —o el componente se vuelve a montar—, no se piden dos veces los
 *    mismos datos a un sitio de terceros. La clave está en vuelo o no está.
 * 2. **Concurrencia máxima 2.** Refrescar diez cosas a la vez contra sitios
 *    ajenos es la forma más rápida de que te bloqueen; y el spec lo fija.
 *
 * Y una que sí es obvia pero se olvida: **un fallo no borra el dato viejo**. Se
 * anota el error y la fila se queda donde estaba; cambiar un dato viejo por
 * ninguno es empeorar. Quien lo lea la próxima vez volverá a intentarlo.
 *
 * El trabajo llega como una función que recibe una señal. Al cerrar, se aborta
 * lo que está corriendo y se descarta lo que esperaba: sin eso, cerrar la base
 * con una revalidación a medias deja la promesa colgada y el proceso no sale.
 */

import type { Database } from 'bun:sqlite'
import { type ProviderRef, StoreError } from '@nn-anime/core'

/**
 * Recursos que se revalidan en segundo plano.
 *
 * `feed` y `trending` entraron con T54: las dos filas que la home refresca tienen
 * su TTL desde T49 y T47, y hasta entonces nadie lo miraba. No hace falta
 * migración —la tabla no tiene `CHECK` sobre `resource`, y su clave primaria es
 * `(resource, key)`—, así que el error de un feed no pisa el de un anime.
 */
export type RevalidateResource = 'anime' | 'episodes' | 'search' | 'feed' | 'trending'

export interface RevalidateError {
  readonly resource: RevalidateResource
  readonly key: string
  readonly message: string
  readonly at: Date
}

interface ErrorRow {
  readonly resource: string
  readonly key: string
  readonly message: string
  readonly at: number
}

/**
 * La clave de una referencia.
 *
 * Se separa con `#` y no con `/`: el valor de una referencia puede llevar
 * barras —`a/b` es una referencia válida—, así que `uno` + `x/y` y `uno/x` + `y`
 * darían la misma clave y dos recursos distintos compartirían el aviso de error.
 * El identificador de proveedor es kebab-case por contrato, así que no puede
 * llevar `#` y el corte es inequívoco.
 */
export function refKey(ref: ProviderRef): string {
  return `${ref.providerId}#${ref.value}`
}

export function markRevalidateError(
  db: Database,
  resource: RevalidateResource,
  key: string,
  message: string,
  now: number = Date.now(),
): void {
  db.query(
    `INSERT INTO revalidate_error (resource, key, message, at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (resource, key) DO UPDATE SET message = excluded.message, at = excluded.at`,
  ).run(resource, key, message, now)
}

/** Limpia el error: la revalidación funcionó, así que ya no hay nada que avisar. */
export function clearRevalidateError(
  db: Database,
  resource: RevalidateResource,
  key: string,
): void {
  db.query('DELETE FROM revalidate_error WHERE resource = ? AND key = ?').run(resource, key)
}

export function listRevalidateErrors(db: Database): readonly RevalidateError[] {
  const rows = db
    .query<ErrorRow, []>('SELECT resource, key, message, at FROM revalidate_error ORDER BY at DESC')
    .all()

  return rows.map((row) => ({
    resource: row.resource as RevalidateResource,
    key: row.key,
    message: row.message,
    at: new Date(row.at),
  }))
}

/** El trabajo de una revalidación. Recibe la señal para poder abandonar. */
export type RevalidateTask = (signal: AbortSignal) => Promise<void>

export interface RevalidatorOptions {
  /** Por defecto 2, el máximo del spec. */
  readonly concurrency?: number
  /**
   * Qué hacer cuando una revalidación falla. Lo normal es anotar el error, y no
   * borrar nada: el dato viejo sigue sirviendo.
   */
  readonly onError?: (key: string, message: string) => void | Promise<void>
  /** Se llama cuando una revalidación termina bien, para limpiar el error. */
  readonly onSuccess?: (key: string) => void | Promise<void>
}

export interface Revalidator {
  /** Encola una revalidación. Si la clave ya está, no hace nada. */
  schedule(key: string, task: RevalidateTask): void
  running(): number
  queued(): readonly string[]
  /** Aborta lo que corre, descarta lo que espera y espera a que se suelte todo. */
  close(): Promise<void>
  closed(): boolean
}

interface Pending {
  readonly key: string
  readonly task: RevalidateTask
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function createRevalidator(options: RevalidatorOptions = {}): Revalidator {
  const limite = options.concurrency ?? 2
  const esperando: Pending[] = []
  const enCurso = new Map<
    string,
    { readonly controller: AbortController; readonly done: Promise<void> }
  >()
  let cerrado = false

  if (!Number.isInteger(limite) || limite < 1) {
    throw new StoreError({
      message: `la concurrencia tiene que ser un entero mayor que cero, no ${limite}`,
      scope: 'catalog-store',
      op: 'revalidator',
    })
  }

  const siguiente = (): void => {
    while (enCurso.size < limite && esperando.length > 0) {
      const pending = esperando.shift()
      if (pending === undefined) return

      const controller = new AbortController()
      const done = (async () => {
        try {
          await pending.task(controller.signal)
          await options.onSuccess?.(pending.key)
        } catch (cause) {
          // Un aborto no es un fallo que haya que anotar: es que se cerró. Se
          // compara con el motivo de la señal y no con `signal.aborted`, porque
          // al cerrar se aborta **todo** lo que corre: mirar la bandera haría
          // que un fallo real que llega en ese instante se confundiera con una
          // cancelación y se perdiera el aviso.
          if (cause !== controller.signal.reason) {
            await options.onError?.(pending.key, describe(cause))
          }
        } finally {
          enCurso.delete(pending.key)
          if (!cerrado) siguiente()
        }
      })()

      enCurso.set(pending.key, { controller, done })
    }
  }

  return {
    schedule(key, task) {
      if (cerrado) return
      // Deduplicado: la clave en el aire —corriendo o esperando— no se repite.
      if (enCurso.has(key) || esperando.some((item) => item.key === key)) return

      esperando.push({ key, task })
      siguiente()
    },
    running: () => enCurso.size,
    queued: () => esperando.map((item) => item.key),
    async close() {
      cerrado = true
      esperando.length = 0

      for (const { controller } of enCurso.values()) controller.abort()

      // Se espera a las promesas, no a un reloj: cerrar la base con trabajo en
      // vuelo deja promesas colgadas y el proceso no termina. Esperar de verdad
      // es también lo que hace que la prueba sea determinista.
      await Promise.allSettled([...enCurso.values()].map(({ done }) => done))
    },
    closed: () => cerrado,
  }
}
