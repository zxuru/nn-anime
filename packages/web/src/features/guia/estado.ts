/**
 * El estado de la guía, fuera de React.
 *
 * La guía la leen dos sitios que no se hablan —la cabecera, que la abre, y
 * Ajustes, que la repite— y el recorrido automático vive en la raíz. Un estado
 * de módulo con suscripción evita pasar callbacks por media aplicación y deja
 * `useSyncExternalStore` hacer el resto.
 *
 * La memoria es del navegador: `localStorage`, sin servidor y sin cuentas, como
 * el resto de lo que la aplicación guarda.
 */

import {
  conBienvenida,
  type EstadoGuia,
  guardarEstado,
  leerEstado,
  sinAviso,
  sinAvisos,
} from './guia'

let cache: EstadoGuia | undefined
const oyentes = new Set<() => void>()

function almacen(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

/**
 * El estado actual.
 *
 * La primera lectura siembra la línea base y la guarda en el acto: si no se
 * guardara, un aviso publicado después volvería a sembrarse como «ya conocido»
 * en la sesión siguiente y no saldría nunca.
 *
 * El objeto se cachea para que `useSyncExternalStore` reciba siempre la misma
 * referencia mientras no haya cambios; devolver uno nuevo en cada lectura es un
 * bucle de renderizado.
 */
export function estadoActual(): EstadoGuia {
  if (cache !== undefined) return cache

  const deposito = almacen()
  cache = leerEstado(deposito)
  // Se guarda la primera vez aunque no hubiera nada: normaliza un valor viejo o
  // corrupto y deja sembrada la línea base de los avisos.
  guardarEstado(deposito, cache)

  return cache
}

export function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente)

  return () => {
    oyentes.delete(oyente)
  }
}

function publicar(siguiente: EstadoGuia): void {
  // Repetir «visto» —cerrar la guía dos veces— no cambia nada y no tiene por qué
  // reescribir el almacén ni despertar a los oyentes.
  if (siguiente === cache) return

  cache = siguiente
  guardarEstado(almacen(), siguiente)

  for (const oyente of [...oyentes]) oyente()
}

/** La bienvenida ya se vio. */
export function marcarBienvenida(): void {
  publicar(conBienvenida(estadoActual()))
}

/** El aviso `id` no vuelve a salir. */
export function descartarAviso(id: string): void {
  publicar(sinAviso(estadoActual(), id))
}

/** Devuelve a la lista los avisos publicados: se pueden repasar desde Ajustes. */
export function restablecerAvisos(): void {
  publicar(sinAvisos(estadoActual()))
}
