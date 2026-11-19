/**
 * El formato que se está mirando.
 *
 * T372 retiró la familia de contenido (`anime` / `animation` / `live`): la
 * aplicación sirve anime y películas de anime, así que el único eje que queda es
 * el **formato** —serie o película—. Vive en la dirección (`?formato=`), como la
 * consulta de la búsqueda: así se puede recargar, compartir y volver atrás, y no
 * hay un segundo sitio donde se desincronice.
 *
 * La regla de a qué formato pertenece un título vive en `core` y la comparten el
 * servidor y la interfaz. Aquí se usa para lo que ya está en la mano: los
 * favoritos, lo que se está viendo y los resultados que acaban de llegar.
 */

import { pasaElFiltro } from '@rona/core/media'
import type { MediaFormat, MediaType, ProviderRef, TitleKind } from '@rona/core/models'

/** El formato que pide una ruta: sin `?formato=` no se filtra (es «Todo»). */
export function formatoFromPath(path: string): MediaFormat | undefined {
  const valor = new URLSearchParams(path.split('?')[1] ?? '').get('formato')
  if (valor === 'series' || valor === 'movie') return valor

  return undefined
}

/**
 * Si la dirección trae el vocabulario retirado y hay que reescribirla.
 *
 * `?tipo=` era la familia. Una dirección guardada o compartida tiene que abrir la
 * misma pantalla —sin el parámetro— en vez de dar un error o una vista distinta.
 */
export function tieneTipoRetirado(path: string): boolean {
  return new URLSearchParams(path.split('?')[1] ?? '').has('tipo')
}

/** La misma ruta, sin el `tipo` retirado. */
export function sinTipo(path: string): string {
  const [camino = '', consulta = ''] = path.split('?')
  const partes = consulta.split('&').filter((parte) => parte !== '' && !parte.startsWith('tipo='))

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

/** La misma ruta con la vista puesta. */
export function pathConVista(path: string, formato: MediaFormat | undefined): string {
  return pathConFormato(sinTipo(path), formato)
}

/** La fuente de un título, que es lo que decide su formato. */
export interface FuenteDeTitulo {
  readonly providerId: string
  readonly kind?: TitleKind | undefined
  readonly format?: MediaFormat | undefined
  readonly mediaType?: MediaType | undefined
}

/**
 * La fuente de un resumen: favorito, resultado de búsqueda, relacionado.
 *
 * En estas formas el `kind` **no vive dentro del `ref`** sino a su lado, y
 * confundirlo no da error de compilación —`ref` no tiene `kind` y el título cae
 * en el defecto— pero deja la lista con el formato equivocado. Por eso el mapeo
 * está escrito una vez y no en cada llamada.
 */
export function fuenteDeResumen(item: {
  readonly ref: ProviderRef
  readonly kind?: TitleKind | undefined
  readonly format?: MediaFormat | undefined
  readonly mediaType?: MediaType | undefined
}): FuenteDeTitulo {
  return {
    providerId: item.ref.providerId,
    ...(item.kind === undefined ? {} : { kind: item.kind }),
    ...(item.format === undefined ? {} : { format: item.format }),
    ...(item.mediaType === undefined ? {} : { mediaType: item.mediaType }),
  }
}

/** La fuente de lo que se está viendo: lleva su formato desde T257b. */
export function fuenteDeVisionado(item: {
  readonly animeRef: ProviderRef
  readonly format?: MediaFormat | undefined
}): FuenteDeTitulo {
  return {
    providerId: item.animeRef.providerId,
    ...(item.format === undefined ? {} : { format: item.format }),
  }
}

/** Si un título entra en el formato pedido. Sin formato entran todos. */
export function esDelFormato(formato: MediaFormat | undefined, fuente: FuenteDeTitulo): boolean {
  if (formato === undefined) return true

  return pasaElFiltro({ format: formato }, fuente)
}

/** Los títulos que entran en el formato pedido. Sin formato, la lista entera. */
export function enElFormato<T>(
  items: readonly T[],
  formato: MediaFormat | undefined,
  fuente: (item: T) => FuenteDeTitulo,
): readonly T[] {
  if (formato === undefined) return items

  return items.filter((item) => esDelFormato(formato, fuente(item)))
}
