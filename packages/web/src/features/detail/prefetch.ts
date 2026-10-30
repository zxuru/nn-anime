/**
 * La precarga de una ficha desde su tarjeta.
 *
 * Pasar el puntero por una tarjeta es intención de abrirla, y el tiempo que se
 * tarda en pulsar es tiempo que el proveedor puede ir contestando. Al empezar a
 * tocar en el móvil pasa lo mismo: el dedo ya está sobre la tarjeta. La precarga
 * se lanza con un retraso corto —100 ms— para que un puntero que cruza la
 * pantalla no dispare una petición por cada tarjeta que toca: sólo se pide la que
 * se ha quedado quieta un momento.
 *
 * **La precarga nunca pinta ni falla.** Guarda el resultado en la caché y, si no
 * puede, se queda callada: un proveedor caído durante una precarga no es un
 * error que el usuario haya provocado. La pantalla que después abra la ficha
 * encontrará el dato o pedirá el suyo.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { claveDeFicha, type DetailBundle, detailCache, loadDetailBundle } from './load-detail'

/** Lo que se espera antes de precargar: un cruce de puntero no es intención. */
export const PREFETCH_DELAY_MS = 100

/**
 * Las precargas en vuelo, por clave.
 *
 * Sin este mapa, el puntero que entra y sale dos veces lanzaría dos peticiones
 * para la misma ficha; con él, la segunda espera a la primera.
 */
const enVuelo = new Map<string, Promise<DetailBundle | undefined>>()

/**
 * Pide la ficha y la guarda en la caché.
 *
 * Devuelve la promesa para que la pantalla que abra la ficha mientras la precarga
 * está en marcha pueda esperarla en vez de pedir otra vez. Si la caché ya tiene
 * el dato fresco no se lanza ninguna petición.
 */
export function prefetchDetail(providerId: string, ref: string): Promise<DetailBundle | undefined> {
  const clave = claveDeFicha(providerId, ref)
  const cacheado = detailCache.get(clave)
  if (cacheado !== undefined) return Promise.resolve(cacheado)

  const pendiente = enVuelo.get(clave)
  if (pendiente !== undefined) return pendiente

  const promesa = loadDetailBundle(providerId, ref)
    .then((bundle) => {
      detailCache.set(clave, bundle)
      return bundle
    })
    // La precarga falla en silencio: no hay nadie a quien avisar y la pantalla
    // que abra la ficha volverá a intentarlo por su cuenta.
    .catch(() => undefined)
    .finally(() => {
      enVuelo.delete(clave)
    })

  enVuelo.set(clave, promesa)

  return promesa
}

/** La precarga que ya está en marcha para esta ficha, si la hay. */
export function prefetchPendiente(
  providerId: string,
  ref: string,
): Promise<DetailBundle | undefined> | undefined {
  return enVuelo.get(claveDeFicha(providerId, ref))
}

/**
 * Olvida lo que esté en vuelo para una ficha.
 *
 * Lo usan los tests, que comparten el módulo entre casos; en producción no hace
 * falta, porque la entrada se borra sola al terminar.
 */
export function olvidarPrefetch(providerId: string, ref: string): void {
  enVuelo.delete(claveDeFicha(providerId, ref))
}

export interface DetailPrefetchHandlers {
  readonly onPointerEnter: () => void
  readonly onPointerLeave: () => void
  readonly onPointerDown: () => void
}

/**
 * Los manejadores que una tarjeta pone en su enlace.
 *
 * Es un gancho y no tres funciones sueltas porque el temporizador tiene que
 * cancelarse al desmontar: una tarjeta que desaparece a mitad de la espera no
 * puede dejar un `setTimeout` que pida una ficha que ya no interesa.
 */
export function useDetailPrefetch(
  providerId: string | undefined,
  ref: string | undefined,
): DetailPrefetchHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const cancelar = useCallback(() => {
    if (timer.current === undefined) return

    clearTimeout(timer.current)
    timer.current = undefined
  }, [])

  useEffect(() => cancelar, [cancelar])

  return useMemo(
    () => ({
      onPointerEnter: () => {
        if (providerId === undefined || ref === undefined) return

        cancelar()
        timer.current = setTimeout(() => {
          timer.current = undefined
          void prefetchDetail(providerId, ref)
        }, PREFETCH_DELAY_MS)
      },
      onPointerLeave: cancelar,
      onPointerDown: () => {
        if (providerId === undefined || ref === undefined) return

        cancelar()
        void prefetchDetail(providerId, ref)
      },
    }),
    [providerId, ref, cancelar],
  )
}
