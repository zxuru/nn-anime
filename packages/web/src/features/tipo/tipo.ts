/**
 * La familia de contenido y el formato que se están mirando.
 *
 * Son **dos ejes**, no una pestaña de dos mitades: la familia dice de qué está
 * hecha la obra —anime, animación que no es anime o imagen real— y el formato
 * cómo está contada —serie o película—. La familia vive en la dirección
 * (`?tipo=`) y el formato en la suya (`?formato=`), como la consulta de la
 * búsqueda: así se puede recargar, compartir y volver atrás, el botón «atrás»
 * deshace el cambio de pestaña y no hay un segundo sitio donde se desincronice.
 *
 * De quién es cada título lo dice **su fuente** —lo que declara por título o, si
 * no, lo que sirve— y la regla vive en `core`, la misma que usa el servidor para
 * filtrar lo que pide. Aquí se usa para lo que ya está en la mano: los
 * favoritos, lo que se está viendo y los resultados que acaban de llegar.
 *
 * `?tipo=movies` sigue leyéndose —es la dirección vieja— y se reescribe como
 * `live` al entrar: `movies` significaba «todo lo que no es anime», y su sucesor
 * natural es la acción real. No hay una familia que signifique «lo que no es
 * anime» porque ésa era justamente la confusión.
 */

import type { ProviderSummary } from '@rona/core/api'
import { familiesOf, pasaElFiltro, puedeServirFamilia } from '@rona/core/media'
import type { MediaFamily, MediaFormat, MediaType, ProviderRef, TitleKind } from '@rona/core/models'
import { useMemo } from 'react'
import { useProviders } from '../search/useSearchStream'

/**
 * La familia con la que abre la aplicación.
 *
 * Anime, y no «todas»: es lo que la aplicación es, y una pestaña «todo» sería
 * una cuarta que nadie ha pedido. Quien busque otra cosa cambia de pestaña, y el
 * cambio queda en la dirección.
 */
export const FAMILIA_POR_DEFECTO: MediaFamily = 'anime'

/** Las tres familias, en el orden en que se enseñan. Anime primero: es la casa. */
export const FAMILIAS: readonly MediaFamily[] = ['anime', 'animation', 'live']

/** Una familia que llegó por la dirección y no se entiende cae en la de siempre. */
function familiaValida(valor: string | null): MediaFamily {
  return valor === 'animation' || valor === 'live' ? valor : FAMILIA_POR_DEFECTO
}

/** La familia que pide una ruta. */
export function familiaFromPath(path: string): MediaFamily {
  const valor = new URLSearchParams(path.split('?')[1] ?? '').get('tipo')
  // `movies` es la dirección vieja: su sucesor natural es la acción real.
  if (valor === 'movies') return 'live'

  return familiaValida(valor)
}

/** Si la dirección trae el vocabulario viejo y hay que reescribirla. */
export function tieneTipoViejo(path: string): boolean {
  return new URLSearchParams(path.split('?')[1] ?? '').get('tipo') === 'movies'
}

/** El formato que pide una ruta: sin `?formato=` no se filtra (es «Todo»). */
export function formatoFromPath(path: string): MediaFormat | undefined {
  const valor = new URLSearchParams(path.split('?')[1] ?? '').get('formato')
  if (valor === 'series' || valor === 'movie') return valor

  return undefined
}

/**
 * La misma ruta, con la familia puesta.
 *
 * La de por defecto se **quita** de la dirección en vez de escribirse: dos
 * direcciones para la misma pantalla darían dos entradas de historial y dos
 * claves de caché para lo mismo.
 *
 * La consulta se compone **trozo a trozo** y no con `URLSearchParams`: eso
 * reescribiría los espacios como `+`, y la dirección de arranque del CLI los
 * escribe como `%20`. Dos convenciones para la misma búsqueda dan dos claves de
 * caché distintas, que es lo que `searchPath` ya evita.
 */
export function pathConFamilia(path: string, familia: MediaFamily): string {
  const [camino = '', consulta = ''] = path.split('?')
  const partes = consulta.split('&').filter((parte) => parte !== '' && !parte.startsWith('tipo='))
  if (familia !== FAMILIA_POR_DEFECTO) partes.push(`tipo=${familia}`)

  return partes.length === 0 ? camino : `${camino}?${partes.join('&')}`
}

/** La misma ruta, con el formato puesto. Sin formato, el parámetro se quita. */
export function pathConFormato(path: string, formato: MediaFormat | undefined): string {
  const [camino = '', consulta = ''] = path.split('?')
  const partes = consulta
    .split('&')
    .filter((parte) => parte !== '' && !parte.startsWith('formato='))
  if (formato !== undefined) partes.push(`formato=${formato}`)

  return partes.length === 0 ? camino : `${camino}?${partes.join('&')}`
}

/** Las dos cosas a la vez, para los destinos que conservan la vista entera. */
export function pathConVista(
  path: string,
  familia: MediaFamily,
  formato: MediaFormat | undefined,
): string {
  return pathConFormato(pathConFamilia(path, familia), formato)
}

/**
 * Los proveedores y las familias que sirve cada uno, en una sola lectura.
 *
 * La home necesita las dos cosas a la vez: el mapa para repartir títulos por
 * familia y la lista para saber si la instalación no tiene ninguna fuente.
 * Pedirlas por separado abriría dos instancias del mismo hook; aquí se comparten.
 */
export interface Fuentes {
  /** Las familias de cada proveedor, con su `media` heredado ya traducido. */
  readonly familias: ReadonlyMap<string, readonly MediaFamily[]>
  readonly summaries: readonly ProviderSummary[]
  /** La lectura terminó. */
  readonly loaded: boolean
  /** La lectura falló: la lista vacía no significa «no hay proveedores». */
  readonly failed: boolean
}

export function useFuentes(): Fuentes {
  const { summaries, loaded, failed } = useProviders()

  const familias = useMemo(
    () =>
      new Map(summaries.map((resumen) => [resumen.id, familiesOf(resumen.capabilities)] as const)),
    [summaries],
  )

  return { familias, summaries, loaded, failed }
}

/** Las familias de cada proveedor cargado. Sin declararlas, anime. */
export function useFamilias(): ReadonlyMap<string, readonly MediaFamily[]> {
  return useFuentes().familias
}

/** La fuente de un título, que es lo que decide de qué es. */
export interface FuenteDeTitulo {
  readonly providerId: string
  readonly kind?: TitleKind | undefined
  /** Lo que la fuente declara del título, cuando no basta con su `kind`. */
  readonly family?: MediaFamily | undefined
  readonly format?: MediaFormat | undefined
  readonly mediaType?: MediaType | undefined
}

/**
 * La fuente de un resumen: favorito, resultado de búsqueda, relacionado.
 *
 * En estas formas el `kind` **no vive dentro del `ref`** sino a su lado, y
 * confundirlo no da error de compilación —`ref` no tiene `kind` y el título cae
 * en el defecto— pero deja la pestaña vacía con los datos delante. Por eso el
 * mapeo está escrito una vez y no en cada llamada.
 */
export function fuenteDeResumen(item: {
  readonly ref: ProviderRef
  readonly kind?: TitleKind | undefined
  readonly family?: MediaFamily | undefined
  readonly format?: MediaFormat | undefined
  readonly mediaType?: MediaType | undefined
}): FuenteDeTitulo {
  return {
    providerId: item.ref.providerId,
    ...(item.kind === undefined ? {} : { kind: item.kind }),
    ...(item.family === undefined ? {} : { family: item.family }),
    ...(item.format === undefined ? {} : { format: item.format }),
    ...(item.mediaType === undefined ? {} : { mediaType: item.mediaType }),
  }
}

/** La fuente de lo que se está viendo: lleva su familia y su formato desde T257b. */
export function fuenteDeVisionado(item: {
  readonly animeRef: ProviderRef
  readonly family?: MediaFamily | undefined
  readonly format?: MediaFormat | undefined
}): FuenteDeTitulo {
  return {
    providerId: item.animeRef.providerId,
    ...(item.family === undefined ? {} : { family: item.family }),
    ...(item.format === undefined ? {} : { format: item.format }),
  }
}

/** Las familias de la fuente de un título, o el defecto del contrato. */
function familiasDeLaFuente(
  familias: ReadonlyMap<string, readonly MediaFamily[]>,
  providerId: string,
): readonly MediaFamily[] {
  return familias.get(providerId) ?? [FAMILIA_POR_DEFECTO]
}

/** Si un título entra en la familia que se está mirando. */
export function esDeLaFamilia(
  familia: MediaFamily,
  familias: ReadonlyMap<string, readonly MediaFamily[]>,
  fuente: FuenteDeTitulo,
): boolean {
  return pasaElFiltro(
    { families: [familia] },
    fuente,
    familiasDeLaFuente(familias, fuente.providerId),
  )
}

/** Si un título entra en el formato pedido. Sin formato entran todos. */
export function esDelFormato(
  formato: MediaFormat | undefined,
  familias: ReadonlyMap<string, readonly MediaFamily[]>,
  fuente: FuenteDeTitulo,
): boolean {
  if (formato === undefined) return true

  return pasaElFiltro({ format: formato }, fuente, familiasDeLaFuente(familias, fuente.providerId))
}

/**
 * Los títulos que entran en la familia, de una lista que ya está en la mano.
 *
 * La fuente de cada uno la dice quien llama: los favoritos la llevan en `ref` y
 * lo que se está viendo en `animeRef`, y son formas distintas del mismo dato.
 */
export function enLaFamilia<T>(
  items: readonly T[],
  familia: MediaFamily,
  familias: ReadonlyMap<string, readonly MediaFamily[]>,
  fuente: (item: T) => FuenteDeTitulo,
): readonly T[] {
  return items.filter((item) => esDeLaFamilia(familia, familias, fuente(item)))
}

/** Los títulos que entran en el formato pedido. Sin formato, la lista entera. */
export function enElFormato<T>(
  items: readonly T[],
  formato: MediaFormat | undefined,
  familias: ReadonlyMap<string, readonly MediaFamily[]>,
  fuente: (item: T) => FuenteDeTitulo,
): readonly T[] {
  if (formato === undefined) return items

  return items.filter((item) => esDelFormato(formato, familias, fuente(item)))
}

/**
 * Si hay que avisar de que a esta familia no la sirve nadie.
 *
 * Es lo que convierte una pantalla vacía en un problema con solución: sin esto,
 * la pestaña de animación de una instalación sólo de anime se lee como una
 * aplicación rota, y lo que falta es un plugin.
 *
 * **Con el mapa vacío no se avisa de nada**, y no es un detalle: el mapa está
 * vacío las primeras décimas de segundo —los proveedores se piden al servidor— y
 * también cuando esa lectura falla. Afirmar ahí que ninguna fuente sirve la
 * familia sería decir algo que no se sabe, y encima en el arranque de todas las
 * pantallas. Una instalación sin ninguna fuente se explica en las filas, que ya
 * dicen qué falta.
 */
/** La clave del aviso de cada familia, escrita una por una: el catálogo se lee. */
export const AVISO_SIN_FUENTE: Readonly<
  Record<MediaFamily, 'media.empty.anime' | 'media.empty.animation' | 'media.empty.live'>
> = {
  anime: 'media.empty.anime',
  animation: 'media.empty.animation',
  live: 'media.empty.live',
}

export function sinFuenteQueSirva(
  familias: ReadonlyMap<string, readonly MediaFamily[]>,
  familia: MediaFamily,
): boolean {
  if (familias.size === 0) return false

  return [...familias.values()].every((suyas) => !puedeServirFamilia([familia], suyas))
}
