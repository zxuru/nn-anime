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
 *
 * Se precarga **la carga entera**, no sólo el núcleo: el núcleo se guarda en
 * cuanto llega —para que al pulsar la ficha se pinte sin esperar al proveedor— y
 * los adornos completan la entrada cuando llegan. La cadena la arma
 * `cargarFicha`, que respeta el orden que exige el servidor; si la precarga
 * pidiera los adornos por su cuenta, volvería a abrir la carrera que dejaba la
 * ficha de una primera visita sin banner.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  type CargaDeFicha,
  cargarFicha,
  claveDeFicha,
  type DetailBundle,
  type DetailCore,
  detailCache,
} from './load-detail'

/** Lo que se espera antes de precargar: un cruce de puntero no es intención. */
export const PREFETCH_DELAY_MS = 100

/**
 * Las precargas en vuelo, por clave.
 *
 * Sin este mapa, el puntero que entra y sale dos veces lanzaría dos peticiones
 * para la misma ficha; con él, la segunda espera a la primera. La clave no lleva
 * la consulta —el contenido de la ficha es el mismo venga de donde venga—, así
 * que se guarda al lado: es lo que permite no reutilizar una precarga que salió
 * sin la búsqueda cuando la ficha viene de una y hay un rastro que dejar.
 */
interface PrecargaEnVuelo {
  readonly carga: CargaDeFicha
  /** La búsqueda con la que salió la petición; `undefined` es «sin búsqueda». */
  readonly consulta: string | undefined
}

const enVuelo = new Map<string, PrecargaEnVuelo>()

/**
 * Lanza la carga y la deja en vuelo, guardando lo que llegue en la caché.
 *
 * El núcleo se guarda en cuanto llega, aunque los adornos tarden: es lo que hace
 * que la ficha abierta después se pinte al instante. Los adornos se añaden a la
 * entrada cuando llegan, conservando lo que ya hubiera de la ficha.
 */
function precargar(providerId: string, ref: string, consulta?: string): CargaDeFicha {
  const clave = claveDeFicha(providerId, ref)
  const carga = cargarFicha(providerId, ref, consulta === undefined ? {} : { consulta })
  let nucleoGuardado: DetailCore | undefined

  void carga.nucleo.then(
    (nucleo) => {
      nucleoGuardado = nucleo
      detailCache.set(clave, { ...detailCache.peek(clave)?.value, ...nucleo })
    },
    () => undefined,
  )

  void carga.adornos.then(
    (adornos) => {
      // Sin núcleo no hay ficha a la que añadir adornos: el fallo ya lo contará
      // la pantalla, que es la única que puede decírselo a alguien.
      if (adornos === undefined || nucleoGuardado === undefined) return

      const previo: DetailBundle | undefined = detailCache.peek(clave)?.value
      detailCache.set(clave, { ...nucleoGuardado, ...previo, ...adornos })
    },
    () => undefined,
  )

  const entrada: PrecargaEnVuelo = { carga, consulta }
  enVuelo.set(clave, entrada)

  void carga.adornos
    .finally(() => {
      // La entrada se borra cuando termina la carga **entera** —núcleo y
      // adornos—. Si se borrara al terminar el núcleo, una ficha abierta en ese
      // hueco no encontraría la precarga y volvería a pedir lo que ya está en el
      // aire: el núcleo duplicado y los adornos duplicados.
      if (enVuelo.get(clave) === entrada) enVuelo.delete(clave)
    })
    .catch(() => undefined)

  return carga
}

/**
 * Pide la ficha y la guarda en la caché.
 *
 * Si la caché ya tiene el dato fresco no se lanza ninguna petición, y si hay una
 * precarga en marcha se espera esa en vez de pedir otra. El fallo se traga: no
 * hay nadie a quien avisar y la pantalla que abra la ficha volverá a intentarlo
 * por su cuenta.
 *
 * `consulta` es la búsqueda de la que viene la ficha: viaja en la petición porque
 * el servidor anota en `search_history` la que la lleva, y con ella el motor
 * recomienda lo que el usuario está buscando.
 */
export function prefetchDetail(
  providerId: string,
  ref: string,
  consulta?: string,
): Promise<DetailCore | undefined> {
  const clave = claveDeFicha(providerId, ref)
  const cacheado = detailCache.get(clave)
  if (cacheado !== undefined) return Promise.resolve(cacheado)

  const pendiente = enVuelo.get(clave)
  if (pendiente !== undefined) return pendiente.carga.nucleo.catch(() => undefined)

  return precargar(providerId, ref, consulta).nucleo.catch(() => undefined)
}

/**
 * La carga que ya está en marcha para esta ficha, si la hay.
 *
 * Con consulta, sólo se devuelve la que salió con esa misma consulta: una
 * precarga lanzada desde la vitrina no dejó el rastro de la búsqueda y reutilizarla
 * dejaría la ficha abierta desde Buscar sin anotar. En ese caso —raro: la misma
 * ficha precargada desde otra pantalla en el último segundo— la ficha pide la suya.
 *
 * Se devuelve la carga entera y no una promesa: la pantalla necesita esperar el
 * núcleo **y** los adornos, y con la carga en la mano reutiliza los dos sin
 * volver a pedirlos.
 */
export function cargaEnVuelo(
  providerId: string,
  ref: string,
  consulta?: string,
): CargaDeFicha | undefined {
  const entrada = enVuelo.get(claveDeFicha(providerId, ref))
  if (entrada === undefined) return undefined
  if (consulta !== undefined && entrada.consulta !== consulta) return undefined

  return entrada.carga
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
  consulta?: string,
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
          void prefetchDetail(providerId, ref, consulta)
        }, PREFETCH_DELAY_MS)
      },
      onPointerLeave: cancelar,
      onPointerDown: () => {
        if (providerId === undefined || ref === undefined) return

        cancelar()
        void prefetchDetail(providerId, ref, consulta)
      },
    }),
    [providerId, ref, consulta, cancelar],
  )
}
