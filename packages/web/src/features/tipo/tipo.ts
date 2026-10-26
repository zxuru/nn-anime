/**
 * El tipo de contenido que se está mirando.
 *
 * La aplicación se parte en dos mitades —anime y lo demás— y el estado vive **en
 * la dirección** (`?tipo=`), como la consulta de la búsqueda: así se puede
 * recargar, compartir y volver atrás, el botón «atrás» deshace el cambio de
 * pestaña y no hay un segundo sitio donde el tipo pueda quedarse desincronizado.
 *
 * De quién es cada título lo dice **su fuente**: un plugin declara qué sirve
 * (`capabilities.media`) y sólo dentro de una fuente que sirve las dos cosas manda
 * el `kind` del título. Las dos reglas viven en `core` —el servidor filtra con
 * ellas lo que pide a las fuentes— y aquí se usan para lo que ya está en la mano:
 * los favoritos, lo que se está viendo y los resultados que acaban de llegar.
 */

import type { ProviderSummary } from '@nn-anime/core/api'
import {
  DEFAULT_MEDIA,
  esDeMedia,
  type MediaFilter,
  mediaOf,
  type ProviderMedia,
  puedeServir,
} from '@nn-anime/core/media'
import type { MediaType, ProviderRef, TitleKind } from '@nn-anime/core/models'
import { useMemo } from 'react'
import { useProviders } from '../search/useSearchStream'

/**
 * La mitad con la que abre la aplicación.
 *
 * Anime, y no «las dos cosas»: es lo que la aplicación es, y una pestaña «todo»
 * sería una tercera mitad que nadie ha pedido. Quien busque una película cambia de
 * pestaña, y el cambio queda en la dirección.
 */
export const TIPO_POR_DEFECTO: MediaFilter = 'anime'

/** El tipo que pide una ruta. Cualquier otra cosa —o nada— es el de por defecto. */
export function tipoFromPath(path: string): MediaFilter {
  const valor = new URLSearchParams(path.split('?')[1] ?? '').get('tipo')

  return valor === 'movies' ? 'movies' : TIPO_POR_DEFECTO
}

/**
 * La misma ruta, con el tipo puesto.
 *
 * El de por defecto se **quita** de la dirección en vez de escribirse: dos
 * direcciones para la misma pantalla darían dos entradas de historial y dos claves
 * de caché para lo mismo.
 *
 * La consulta se compone **trozo a trozo** y no con `URLSearchParams`: eso
 * reescribiría los espacios como `+`, y la dirección de arranque del CLI los
 * escribe como `%20`. Dos convenciones para la misma búsqueda dan dos claves de
 * caché distintas, que es lo que `searchPath` ya evita.
 */
export function pathConTipo(path: string, tipo: MediaFilter): string {
  const [camino = '', consulta = ''] = path.split('?')
  const partes = consulta.split('&').filter((parte) => parte !== '' && !parte.startsWith('tipo='))
  if (tipo !== TIPO_POR_DEFECTO) partes.push(`tipo=${tipo}`)

  return partes.length === 0 ? camino : `${camino}?${partes.join('&')}`
}

/**
 * Los proveedores y lo que sirve cada uno, en una sola lectura.
 *
 * La home necesita las dos cosas a la vez: el mapa para repartir títulos por
 * mitad y la lista para saber si la instalación no tiene ninguna fuente. Pedirlas
 * por separado abriría dos instancias del mismo hook; aquí se comparten.
 */
export interface Fuentes {
  readonly medias: ReadonlyMap<string, ProviderMedia>
  readonly summaries: readonly ProviderSummary[]
  /** La lectura terminó. */
  readonly loaded: boolean
  /** La lectura falló: la lista vacía no significa «no hay proveedores». */
  readonly failed: boolean
}

export function useFuentes(): Fuentes {
  const { summaries, loaded, failed } = useProviders()

  const medias = useMemo(
    () => new Map(summaries.map((resumen) => [resumen.id, mediaOf(resumen.capabilities)])),
    [summaries],
  )

  return { medias, summaries, loaded, failed }
}

/** Lo que sirve cada proveedor cargado, por su id. Sin declararlo, anime. */
export function useMedias(): ReadonlyMap<string, ProviderMedia> {
  return useFuentes().medias
}

/** La fuente de un título, que es lo que decide de qué es. */
export interface FuenteDeTitulo {
  readonly providerId: string
  readonly kind?: TitleKind | undefined
  /** Lo que la fuente declara del título, cuando no basta con su `kind`. */
  readonly mediaType?: MediaType | undefined
}

/**
 * La fuente de un resumen: favorito, resultado de búsqueda, relacionado.
 *
 * En estas formas el `kind` **no vive dentro del `ref`** sino a su lado, y
 * confundirlo no da error de compilación —`ref` no tiene `kind` y el título cae en
 * el defecto— pero deja la pestaña de películas vacía con los datos delante. Por eso
 * el mapeo está escrito una vez y no en cada llamada.
 */
export function fuenteDeResumen(item: {
  readonly ref: ProviderRef
  readonly kind?: TitleKind | undefined
  readonly mediaType?: MediaType | undefined
}): FuenteDeTitulo {
  return {
    providerId: item.ref.providerId,
    ...(item.kind === undefined ? {} : { kind: item.kind }),
    ...(item.mediaType === undefined ? {} : { mediaType: item.mediaType }),
  }
}

/**
 * La fuente de lo que se está viendo.
 *
 * `ContinueWatchingItem` no trae `kind` en el contrato: lo que se vio a medias lo
 * identifica su referencia de anime. Un título de una fuente mixta cae, por eso, del
 * lado del anime; añadir el tipo a esa ruta es otro cambio.
 */
export function fuenteDeVisionado(item: { readonly animeRef: ProviderRef }): FuenteDeTitulo {
  return { providerId: item.animeRef.providerId }
}

/** Si un título entra en el tipo que se está mirando. */
export function esDelTipo(
  tipo: MediaFilter,
  medias: ReadonlyMap<string, ProviderMedia>,
  fuente: FuenteDeTitulo,
): boolean {
  return esDeMedia(
    tipo,
    medias.get(fuente.providerId) ?? DEFAULT_MEDIA,
    fuente.kind,
    fuente.mediaType,
  )
}

/**
 * Los títulos que entran en el tipo, de una lista que ya está en la mano.
 *
 * La fuente de cada uno la dice quien llama: los favoritos la llevan en `ref` y lo
 * que se está viendo en `animeRef`, y son formas distintas del mismo dato.
 */
export function enElTipo<T>(
  items: readonly T[],
  tipo: MediaFilter,
  medias: ReadonlyMap<string, ProviderMedia>,
  fuente: (item: T) => FuenteDeTitulo,
): readonly T[] {
  return items.filter((item) => esDelTipo(tipo, medias, fuente(item)))
}

/**
 * Si hay que avisar de que a esta mitad no la sirve nadie.
 *
 * Es lo que convierte una pantalla vacía en un problema con solución: sin esto, la
 * pestaña de películas de una instalación sólo de anime se lee como una aplicación
 * rota, y lo que falta es un plugin.
 *
 * **Con el mapa vacío no se avisa de nada**, y no es un detalle: el mapa está vacío
 * las primeras décimas de segundo —los proveedores se piden al servidor— y también
 * cuando esa lectura falla. Afirmar ahí que ninguna fuente sirve la mitad sería
 * decir algo que no se sabe, y encima en el arranque de todas las pantallas. Una
 * instalación sin ninguna fuente se explica en las filas, que ya dicen qué falta.
 */
export function sinFuenteQueSirva(
  medias: ReadonlyMap<string, ProviderMedia>,
  tipo: MediaFilter,
): boolean {
  if (medias.size === 0) return false

  return [...medias.values()].every((media) => !puedeServir(tipo, media))
}
