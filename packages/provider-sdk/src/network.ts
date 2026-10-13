/**
 * El registro de la capacidad de red.
 *
 * El SDK no puede tener la implementación —vive en `media-proxy`, que es el
 * motor—, así que la recibe del arranque y la inyecta en cada llamada. Es estado
 * de módulo y a propósito: las funciones de `call.ts` son libres, no tienen un
 * objeto donde guardarlo, y lo único que la fábrica necesita saber de la llamada
 * es su `signal` y su `timeoutMs`.
 *
 * Sin nada registrado, `CallOptions.fetch` se queda sin poner: el plugin que la
 * use falla cerrado y lo dice, en vez de salir por el `fetch` global sin que nadie
 * lo note.
 */
import type { PluginFetch, PluginFetchCall, PluginFetchFactory } from '@nn-anime/core'

let fabrica: PluginFetchFactory | undefined

/**
 * Registra la capacidad del motor.
 *
 * `undefined` la quita, que es lo que hace falta en una prueba para no dejar
 * estado de una en la siguiente.
 */
export function setPluginFetchFactory(factory: PluginFetchFactory | undefined): void {
  fabrica = factory
}

/** La capacidad para esta llamada, si hay alguna registrada. */
export function pluginFetchFor(call: PluginFetchCall): PluginFetch | undefined {
  return fabrica?.(call)
}
