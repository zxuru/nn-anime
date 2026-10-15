/**
 * El alcance de las lecturas locales: sólo lo que la aplicación puede abrir.
 *
 * Un proveedor desmarcado en Ajustes —o uno que no cargó porque su archivo está
 * a medias— sale del registro vivo, pero **sus filas siguen en la base**:
 * desmarcar no borra nada, y no debe borrar, porque volver a marcarlo tiene que
 * devolver el historial a su sitio. Lo que no puede pasar es que una lectura
 * local ofrezca una tarjeta que la ficha contesta con 404 —«no hay ningún
 * proveedor llamado animex»—: quien la pulsa la pulsa porque la aplicación se la
 * enseñó.
 *
 * El filtro vive aquí, en un solo sitio, y no en cada ruta, por dos motivos:
 *
 * 1. **Son ocho lecturas** —los candidatos del motor, lo último conocido, el
 *    catálogo por género, los favoritos, los visionados, los hermanos de saga, las
 *    otras fuentes de la ficha y los candidatos locales del emparejamiento con
 *    AniList—, y la novena que se añada sin esto repetiría el fallo. Repetida en
 *    cada ruta, la regla se olvida en la siguiente.
 * 2. **La regla es una sola**: una referencia se ofrece si su proveedor está
 *    cargado ahora. `/api/search` ya la aplicaba por su cuenta, para el filtro de
 *    proveedores de la interfaz; esa parte sigue siendo suya y no se toca.
 *
 * Las lecturas **por proveedor** no se acotan: `readAnime`, `readEpisodes`,
 * `readSearch`, `readFeed`, `readCover`… reciben un identificador y las rutas ya
 * contestan 404 cuando no está cargado, que es lo correcto: la ficha de un
 * proveedor desconocido no se sirve por mucho que su fila esté en la base.
 *
 * El registro es **vivo** —`ProviderHub` vacía y rellena el mismo array al
 * recargar—, así que el alcance se calcula en cada lectura. Un `Set` guardado al
 * arrancar dejaría fuera al plugin que se habilita después, que es justo lo que
 * `PATCH /api/provider-repos` promete que se ve sin reiniciar.
 */

import type { CatalogStore } from '@nn-anime/catalog-store'
import type { ProviderRef } from '@nn-anime/core'
import type { Provider } from '@nn-anime/provider-sdk'
import type { ServerContainer } from './container'

/**
 * El contenedor que ven las rutas: el mismo, con el almacén acotado.
 *
 * Se devuelve un contenedor y no un almacén porque lo que se le pasa a las rutas
 * es el contenedor, y así ninguna tiene que acordarse de acotar. Todo lo demás
 * —el reproductor, los tickets, el cierre— es el de siempre: sólo cambia lo que
 * devuelven las lecturas que pueden ofrecer una tarjeta ajena.
 */
export function acotarAProveedoresActivos(
  container: ServerContainer,
  providers: readonly Provider[],
): ServerContainer {
  return { ...container, store: acotarAlmacen(container.store, providers) }
}

/** El almacén, con las lecturas que pueden ofrecer una referencia ajena acotadas. */
export function acotarAlmacen(store: CatalogStore, providers: readonly Provider[]): CatalogStore {
  /**
   * Si el proveedor está cargado ahora mismo.
   *
   * Se pregunta al array en cada lectura y no a un `Set` de arranque: el registro
   * se recarga sin reiniciar, y un plugin habilitado en Ajustes tiene que
   * devolver sus filas al instante.
   */
  const activo = (providerId: string): boolean =>
    providers.some((provider) => provider.id === providerId)

  /** Las listas de resúmenes, que llevan su referencia en `ref`. */
  const soloActivos = <T extends { readonly ref: ProviderRef }>(
    items: readonly T[],
  ): readonly T[] => items.filter((item) => activo(item.ref.providerId))

  return {
    ...store,

    // Las ocho lecturas que pueden ofrecer una tarjeta de otro proveedor. Una
    // lectura nueva que devuelva referencias se añade **aquí**: es el único
    // sitio donde la regla se aplica.
    listCandidates: async (limit) => soloActivos(await store.listCandidates(limit)),
    listRecentSummaries: async (limit) => soloActivos(await store.listRecentSummaries(limit)),
    searchByGenre: async (term, limit) => soloActivos(await store.searchByGenre(term, limit)),
    listFavorites: async () => soloActivos(await store.listFavorites()),
    listRelated: async (ref, limit, scope) =>
      soloActivos(await store.listRelated(ref, limit, scope)),
    listSources: async (ref, limit) => soloActivos(await store.listSources(ref, limit)),
    // El emparejamiento con AniList ofrece una tarjeta local: si su proveedor no
    // está cargado, la vitrina enlazaría a una ficha que no existe. La lectura
    // acotada deja la pieza sin referencia y se abre la búsqueda, que es la
    // salida honesta.
    listLocalCandidates: async (names, limit) =>
      soloActivos(await store.listLocalCandidates(names, limit)),
    // El visionado lleva el resumen del anime dentro: la referencia que la fila
    // abre es la del título, no la del episodio.
    listRecentlyWatched: async (limit) =>
      (await store.listRecentlyWatched(limit)).filter((fila) => activo(fila.anime.ref.providerId)),
  }
}
