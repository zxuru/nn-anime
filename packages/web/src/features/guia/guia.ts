/**
 * La guía de primeros pasos y los avisos de novedad.
 *
 * Dos piezas con la misma materia —un ancla en el marcado y dos claves de
 * texto— y distinto peso: la bienvenida es un recorrido que se ve una vez y se
 * puede repetir; el aviso es una señal pequeña sobre una función nueva, que se
 * descarta y no vuelve.
 *
 * Aquí no hay DOM ni driver.js: sólo datos y el estado de lo visto, para poder
 * probarlo sin navegador. Quien los convierte en pasos es `useGuia.ts`.
 */

import type { RouteName } from '../../router'

/** El ancla que un paso busca en el marcado: `data-tour="…"`. */
export const ANCLAS = {
  cabecera: 'cabecera',
  buscar: 'buscar',
  tipo: 'tipo',
  destacado: 'destacado',
  biblioteca: 'biblioteca',
  ajustes: 'ajustes',
} as const

export type Lado = 'top' | 'right' | 'bottom' | 'left'
export type Alineacion = 'start' | 'center' | 'end'

export interface PasoGuia {
  readonly id: string
  /** Sin ancla, el paso va centrado: sirve para abrir y cerrar el recorrido. */
  readonly ancla?: string
  readonly titulo: string
  readonly cuerpo: string
  readonly lado?: Lado
  readonly alineacion?: Alineacion
  /**
   * Las pantallas donde el paso tiene sentido.
   *
   * Sin esto, el paso del destacado se abriría centrado en Ajustes —el ancla no
   * existe allí— y el contador diría «3 de 7» para un recorrido de seis. Se
   * filtra antes de arrancar, no se salta a mitad.
   */
  readonly rutas?: readonly RouteName[]
}

export interface AvisoGuia {
  readonly id: string
  readonly ancla: string
  readonly titulo: string
  readonly cuerpo: string
  readonly lado?: Lado
  readonly alineacion?: Alineacion
  readonly rutas?: readonly RouteName[]
}

/**
 * El recorrido de bienvenida, en orden.
 *
 * Son seis paradas después de la portada: la cabecera, la búsqueda, la mitad que
 * se mira, la vitrina, la biblioteca y los ajustes. Lo que no está aquí —la
 * ficha, el reproductor, el historial— se aprende usándolo, y un recorrido de
 * doce pasos no se termina.
 */
export const PASOS: readonly PasoGuia[] = [
  {
    id: 'bienvenida',
    titulo: 'guia.paso.bienvenida.titulo',
    cuerpo: 'guia.paso.bienvenida.cuerpo',
  },
  {
    id: 'cabecera',
    ancla: ANCLAS.cabecera,
    titulo: 'guia.paso.cabecera.titulo',
    cuerpo: 'guia.paso.cabecera.cuerpo',
    lado: 'bottom',
    alineacion: 'center',
  },
  {
    id: 'buscar',
    ancla: ANCLAS.buscar,
    titulo: 'guia.paso.buscar.titulo',
    cuerpo: 'guia.paso.buscar.cuerpo',
    lado: 'bottom',
    alineacion: 'start',
  },
  {
    id: 'tipo',
    ancla: ANCLAS.tipo,
    titulo: 'guia.paso.tipo.titulo',
    cuerpo: 'guia.paso.tipo.cuerpo',
    lado: 'bottom',
    alineacion: 'end',
    rutas: ['home', 'search'],
  },
  {
    id: 'destacado',
    ancla: ANCLAS.destacado,
    titulo: 'guia.paso.destacado.titulo',
    cuerpo: 'guia.paso.destacado.cuerpo',
    lado: 'bottom',
    alineacion: 'center',
    rutas: ['home'],
  },
  {
    id: 'biblioteca',
    ancla: ANCLAS.biblioteca,
    titulo: 'guia.paso.biblioteca.titulo',
    cuerpo: 'guia.paso.biblioteca.cuerpo',
    lado: 'bottom',
    alineacion: 'center',
  },
  {
    id: 'ajustes',
    ancla: ANCLAS.ajustes,
    titulo: 'guia.paso.ajustes.titulo',
    cuerpo: 'guia.paso.ajustes.cuerpo',
    lado: 'bottom',
    alineacion: 'end',
  },
]

/**
 * Los avisos de lo nuevo.
 *
 * Un aviso se publica con la función que anuncia: se añade aquí su entrada, se
 * le pone un ancla en el marcado y dos textos en el catálogo. La primera visita
 * siembra la línea base con los avisos que ya existían, así que sólo ve el faro
 * quien ya tenía la aplicación antes de la función. No hay fechas ni versiones
 * que mantener: el id es la fecha.
 */
export const AVISOS: readonly AvisoGuia[] = [
  {
    id: 'biblioteca-2026-10',
    ancla: ANCLAS.biblioteca,
    titulo: 'guia.aviso.biblioteca.titulo',
    cuerpo: 'guia.aviso.biblioteca.cuerpo',
    lado: 'bottom',
    alineacion: 'center',
  },
]

/** El selector que busca un paso. El valor es interno: no lleva comillas. */
export function selectorDeAncla(ancla: string): string {
  return `[data-tour="${ancla}"]`
}

/** Los pasos que esta pantalla puede enseñar, en orden. */
export function pasosPara(ruta: RouteName): readonly PasoGuia[] {
  return PASOS.filter((paso) => paso.rutas === undefined || paso.rutas.includes(ruta))
}

export interface EstadoGuia {
  /** Si la bienvenida ya se vio. Cerrarla también cuenta: se puede repetir. */
  readonly bienvenida: boolean
  /**
   * Los ids de los avisos que esta instalación ya conoce.
   *
   * En la primera lectura se siembra con los avisos publicados hasta entonces:
   * lo que ya existía al instalar no es una novedad. Un aviso añadido después
   * tiene un id que no está aquí y por eso sale.
   */
  readonly vistos: readonly string[]
}

/** La clave y la versión del almacén. Cambiar la forma pide subir la versión. */
export const CLAVE_GUIA = 'nn-anime.guia'
export const VERSION_GUIA = 1

/** El estado de una instalación que abre la aplicación por primera vez. */
export function estadoInicial(avisos: readonly AvisoGuia[] = AVISOS): EstadoGuia {
  return { bienvenida: false, vistos: avisos.map((aviso) => aviso.id) }
}

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

/**
 * Convierte lo que haya en el almacén en un estado utilizable.
 *
 * Un JSON de otra versión, un valor a medias o basura no rompen la aplicación:
 * se vuelve al estado inicial. Es un archivo del navegador, no un contrato.
 */
export function normalizarEstado(
  crudo: unknown,
  avisos: readonly AvisoGuia[] = AVISOS,
): EstadoGuia {
  if (!esRegistro(crudo) || crudo.v !== VERSION_GUIA) return estadoInicial(avisos)

  const vistos = Array.isArray(crudo.vistos)
    ? crudo.vistos.filter((id): id is string => typeof id === 'string')
    : []

  return { bienvenida: crudo.bienvenida === true, vistos: [...new Set(vistos)] }
}

type Lectura = Pick<Storage, 'getItem'>
type Escritura = Pick<Storage, 'setItem'>

/** Lee el estado guardado; sin almacén o con basura, el inicial. */
export function leerEstado(almacen: Lectura | undefined): EstadoGuia {
  const crudo = almacen?.getItem(CLAVE_GUIA)
  if (crudo === null || crudo === undefined) return estadoInicial()

  try {
    return normalizarEstado(JSON.parse(crudo))
  } catch {
    return estadoInicial()
  }
}

/**
 * Guarda el estado.
 *
 * Un almacén lleno o prohibido —modo privado— no puede impedir que la guía
 * funcione: se pierde la memoria y la bienvenida vuelve a salir en la sesión
 * siguiente, que es un fallo menor comparado con romper la aplicación.
 */
export function guardarEstado(almacen: Escritura | undefined, estado: EstadoGuia): void {
  if (almacen === undefined) return

  try {
    almacen.setItem(
      CLAVE_GUIA,
      JSON.stringify({ v: VERSION_GUIA, bienvenida: estado.bienvenida, vistos: estado.vistos }),
    )
  } catch {
    return
  }
}

/** La bienvenida, vista. */
export function conBienvenida(estado: EstadoGuia): EstadoGuia {
  return estado.bienvenida ? estado : { ...estado, bienvenida: true }
}

/** Un aviso, descartado. */
export function sinAviso(estado: EstadoGuia, id: string): EstadoGuia {
  return estado.vistos.includes(id) ? estado : { ...estado, vistos: [...estado.vistos, id] }
}

/** Los avisos de hoy vuelven a estar pendientes; lo demás no se toca. */
export function sinAvisos(estado: EstadoGuia, avisos: readonly AvisoGuia[] = AVISOS): EstadoGuia {
  const ids = new Set(avisos.map((aviso) => aviso.id))

  return { ...estado, vistos: estado.vistos.filter((id) => !ids.has(id)) }
}

/** Los avisos que esta pantalla puede enseñar y esta instalación no vio. */
export function avisosPendientes(
  estado: EstadoGuia,
  ruta: RouteName,
  avisos: readonly AvisoGuia[] = AVISOS,
): readonly AvisoGuia[] {
  return avisos.filter(
    (aviso) =>
      !estado.vistos.includes(aviso.id) &&
      (aviso.rutas === undefined || aviso.rutas.includes(ruta)),
  )
}
