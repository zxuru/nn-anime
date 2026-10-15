/**
 * Las piezas que llegan de AniList y lo que se hace con ellas.
 *
 * Tres funciones puras y un tipo de vista. El tipo existe porque las filas nuevas
 * mezclan dos procedencias —una referencia local con su ficha y una obra de
 * AniList que puede no estar en ninguna fuente— y las dos tienen que pintarse
 * igual: la pieza sabe de una portada y de un destino, no de dónde salieron.
 *
 * **La decisión que importa está en `destino`**: una obra que la base ya conoce
 * enlaza a su ficha —con sus episodios y su reproductor— y una que no, a la
 * búsqueda de su título, que es la salida honesta: la aplicación no puede abrir
 * una ficha que no tiene. La referencia local la pone el servidor, que es quien
 * lee la base.
 *
 * Las fechas se formatean con `Intl` y no con una tabla de días en el catálogo:
 * son fechas —un dato que el idioma formatea—, no textos de interfaz, y la
 * aplicación tiene un solo idioma declarado (`DEFAULT_LOCALE`).
 */

import type { AiringItem, DiscoverItem } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { AnimeSummary, ProviderRef } from '@nn-anime/core/models'
import { t } from '../../i18n'
import { searchPath } from '../search/SearchPage'

/** Una pieza de una fila de descubrimiento. */
export interface PiezaVista {
  /** Lo que la identifica en una lista: la referencia o el id de AniList. */
  readonly clave: string
  readonly title: string
  /** A dónde lleva: la ficha si se conoce, la búsqueda si no. */
  readonly to: string
  /** La portada, cuando se tiene una. Sin ella, la pieza dibuja su hueco. */
  readonly portada?: string | undefined
  readonly providerId?: string | undefined
  readonly ref?: string | undefined
  readonly year?: number | undefined
  /** La línea de datos del pie. */
  readonly meta?: string | undefined
}

/** El destino de una obra local: su ficha. */
export function fichaPath(providerId: string, ref: string): string {
  return `/anime/${encodeURIComponent(providerId)}/${encodeURIComponent(ref)}`
}

/**
 * A dónde lleva una pieza.
 *
 * Es la decisión de esta entrega: con referencia local, la ficha —con sus
 * episodios y su reproductor—; sin ella, la búsqueda del título. Una obra que
 * ninguna fuente tiene no puede abrir una ficha que no existe, y la búsqueda es
 * lo único honesto que se puede ofrecer.
 */
export function destinoDe(item: {
  readonly ref?: ProviderRef | undefined
  readonly title: string
}): string {
  return item.ref === undefined
    ? searchPath(item.title)
    : fichaPath(item.ref.providerId, item.ref.value)
}

/** Una pieza de la base, la que ya usan las filas de siempre. */
export function desdeResumen(item: AnimeSummary): PiezaVista {
  return {
    clave: `${item.ref.providerId}:${item.ref.value}`,
    title: item.title,
    to: fichaPath(item.ref.providerId, item.ref.value),
    providerId: item.ref.providerId,
    ref: item.ref.value,
    ...(item.year === undefined ? {} : { year: item.year }),
  }
}

/** La meta de una obra de AniList: el año, el formato si no es una serie, y la marca. */
export function metaDeDescubrir(item: DiscoverItem): string | undefined {
  const partes: string[] = []
  if (item.year !== undefined)
    partes.push(t(DEFAULT_LOCALE, 'detail.related.year', { year: item.year }))
  if (item.format !== undefined && item.format !== 'TV') partes.push(item.format)
  // La marca va en la línea de datos y no en un adorno: es texto, así que la lee
  // cualquiera —también un lector de pantalla— y no depende de un color.
  if (item.adult) partes.push(t(DEFAULT_LOCALE, 'adult.mark'))

  return partes.length === 0 ? undefined : partes.join(' · ')
}

/** Una pieza de AniList: su portada, y su ficha sólo si la base la conoce. */
export function desdeDescubrir(item: DiscoverItem): PiezaVista {
  return {
    clave: `anilist:${item.anilistId}`,
    title: item.title,
    to: destinoDe(item),
    portada: item.cover,
    ...(item.ref === undefined ? {} : { providerId: item.ref.providerId, ref: item.ref.value }),
    ...(item.year === undefined ? {} : { year: item.year }),
    ...(metaDeDescubrir(item) === undefined ? {} : { meta: metaDeDescubrir(item) }),
  }
}

/** La meta de un capítulo de la parrilla: «Ep. 5», y en una película, nada. */
export function episodioDe(item: { readonly episode?: number | undefined }): string | undefined {
  return item.episode === undefined
    ? undefined
    : t(DEFAULT_LOCALE, 'home.episode', { number: item.episode })
}

/** La meta de una emisión: el capítulo, y la marca si la obra es para adultos. */
export function metaDeEmision(item: AiringItem): string | undefined {
  const partes: string[] = []
  const episodio = episodioDe(item)
  if (episodio !== undefined) partes.push(episodio)
  if (item.adult) partes.push(t(DEFAULT_LOCALE, 'adult.mark'))

  return partes.length === 0 ? undefined : partes.join(' · ')
}

/** Un capítulo o un estreno de la parrilla. */
export function desdeEmision(item: AiringItem): PiezaVista {
  return {
    clave: `anilist:${item.anilistId}:${item.airingAt ?? item.year ?? ''}`,
    title: item.title,
    to: destinoDe(item),
    portada: item.cover,
    ...(item.ref === undefined ? {} : { providerId: item.ref.providerId, ref: item.ref.value }),
    ...(metaDeEmision(item) === undefined ? {} : { meta: metaDeEmision(item) }),
  }
}

/** Un día de la parrilla. */
export interface DiaDeParrilla {
  /** El día en ISO corto (`AAAA-MM-DD`), que es lo que lo identifica. */
  readonly dia: string
  /** «Hoy», «Mañana», el día de la semana o la fecha. */
  readonly etiqueta: string
  readonly items: readonly AiringItem[]
}

/** El día natural de una fecha, en su zona local, como `AAAA-MM-DD`. */
export function diaDe(fecha: Date): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia = String(fecha.getDate()).padStart(2, '0')

  return `${fecha.getFullYear()}-${mes}-${dia}`
}

/**
 * El año de una emisión, cuando no hay día.
 *
 * AniList publica el estreno de muchas películas con precisión de año, así que la
 * pieza lleva el año y no una fecha inventada.
 */
export function anioDe(item: { readonly year?: number | undefined }): string | undefined {
  return item.year === undefined
    ? undefined
    : t(DEFAULT_LOCALE, 'detail.related.year', { year: item.year })
}

/**
 * Cómo se llama un día.
 *
 * Hoy, mañana y el día de la semana; a partir de la semana que viene, la fecha
 * —«lunes» a seis meses no dice nada—. La cuenta de días se hace por día natural
 * y no por horas: a las 23:50, lo de dentro de veinte minutos es «mañana».
 */
export function etiquetaDeDia(dia: string, hoy: Date): string {
  const fecha = new Date(`${dia}T00:00:00`)
  const base = new Date(`${diaDe(hoy)}T00:00:00`)
  const diferencia = Math.round((fecha.getTime() - base.getTime()) / 86_400_000)

  if (diferencia === 0) return t(DEFAULT_LOCALE, 'home.parrilla.hoy')
  if (diferencia === 1) return t(DEFAULT_LOCALE, 'home.parrilla.manana')
  if (diferencia > 1 && diferencia < 7) {
    return new Intl.DateTimeFormat(DEFAULT_LOCALE, { weekday: 'long' }).format(fecha)
  }

  return new Intl.DateTimeFormat(DEFAULT_LOCALE, { day: 'numeric', month: 'short' }).format(fecha)
}

/**
 * La parrilla, agrupada por día y en orden.
 *
 * Se recorre **una vez** y se guarda el orden de aparición, así que el orden de
 * entrada manda: el servidor devuelve los capítulos por fecha, y reagruparlos no
 * puede barajarlos. Un capítulo con una fecha que no se entiende se queda fuera
 * —no se le inventa un día—.
 */
export function agruparPorDia(items: readonly AiringItem[], hoy: Date): readonly DiaDeParrilla[] {
  const porDia = new Map<string, AiringItem[]>()

  for (const item of items) {
    // Sin fecha no hay día donde colocarla: una película anunciada por su año no
    // entra en el calendario, y no se le inventa una fecha.
    if (item.airingAt === undefined) continue

    const fecha = new Date(item.airingAt)
    if (Number.isNaN(fecha.getTime())) continue

    const clave = diaDe(fecha)
    const lista = porDia.get(clave)
    if (lista === undefined) porDia.set(clave, [item])
    else lista.push(item)
  }

  return [...porDia.entries()].map(([dia, suyos]) => ({
    dia,
    etiqueta: etiquetaDeDia(dia, hoy),
    // Todas las del grupo tienen fecha —sin ella no entran—, así que la cadena
    // vacía del `??` no llega a compararse.
    items: [...suyos].sort((a, b) => Date.parse(a.airingAt ?? '') - Date.parse(b.airingAt ?? '')),
  }))
}

/** La hora de un capítulo, en la zona del usuario. Sin fecha, no hay hora. */
export function horaDe(airingAt: string | undefined): string {
  if (airingAt === undefined) return ''

  const fecha = new Date(airingAt)
  if (Number.isNaN(fecha.getTime())) return ''

  return new Intl.DateTimeFormat(DEFAULT_LOCALE, { hour: '2-digit', minute: '2-digit' }).format(
    fecha,
  )
}
