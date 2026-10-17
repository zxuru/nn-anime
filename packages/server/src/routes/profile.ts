/**
 * La ruta del Perfil: `GET /api/profile`.
 *
 * Es **una** petición y no cuatro desde la interfaz, y es una decisión, no una
 * comodidad: una pantalla que enseña el estado del único usuario no puede pintar
 * tres secciones y callar la cuarta porque una lectura falló. Con cuatro peticiones
 * en paralelo, la que falla deja un hueco que nadie explica; con una, o está el
 * Perfil entero o está en error y se puede reintentar.
 *
 * Las cuatro listas se leen **en paralelo** y se filtran por contenido adulto con
 * `sinMarcadas`, que es local: abrir el Perfil no justifica preguntarle nada a
 * AniList. El historial llega con la forma paginada de su propia ruta —la página
 * 1— para que el enlace al Historial hable el mismo contrato y no haya dos formas
 * del mismo dato.
 */

import { profileResponseSchema } from '@nn-anime/core'
import type { Hono } from 'hono'
import { sinMarcadas } from '../adultos'
import type { ServerContainer } from '../container'
import { adultContentOf } from './settings'
import { historyItems } from './watch'

/**
 * Cuántos visionados enseña el Perfil antes de mandar al Historial.
 *
 * Una fila de tarjetas, no la lista entera: el Perfil es un resumen y el Historial
 * es la pantalla que pagina. Se pide **una fila de más** para saber si queda algo
 * detrás sin contar el total.
 */
export const PROFILE_HISTORY_PREVIEW = 6

export interface ProfileRouteOptions {
  readonly container: ServerContainer
}

export function registerProfileRoutes(app: Hono, options: ProfileRouteOptions): void {
  app.get('/api/profile', async (c) => {
    const store = options.container.store

    const [conAdultos, favoritos, vistos, pendientes, filas] = await Promise.all([
      adultContentOf(store),
      store.listFavorites(),
      store.listWatchedTitles(),
      store.listPlanToWatch(),
      store.listWatchHistory(PROFILE_HISTORY_PREVIEW + 1, 0),
    ])

    const hasMore = filas.length > PROFILE_HISTORY_PREVIEW

    // Las cuatro en paralelo: la marca de adultos se lee una vez por lista y no hay
    // ninguna que dependa de otra.
    const [favoritosOk, vistosOk, pendientesOk, historialOk] = await Promise.all([
      sinMarcadas(store, favoritos, conAdultos, (item) => item.ref),
      sinMarcadas(store, vistos, conAdultos, (item) => item.ref),
      sinMarcadas(store, pendientes, conAdultos, (item) => item.ref),
      sinMarcadas(
        store,
        filas.slice(0, PROFILE_HISTORY_PREVIEW),
        conAdultos,
        (fila) => fila.anime.ref,
      ),
    ])

    /*
      Las dos fechas de marca se quitan a mano.

      `WatchedTitle` lleva `watchedAt` y `PlanToWatchTitle` lleva `createdAt`, y los
      dos son para el motor —que desempata con ellas—, no para la pantalla. El
      schema del contrato es estricto, así que dejarlas dentro no es un campo de más
      que se ignora: es un `ApiShapeError` en el navegador.
    */
    const watched = vistosOk.map(({ watchedAt: _watchedAt, ...resumen }) => resumen)
    const planToWatch = pendientesOk.map(({ createdAt: _createdAt, ...resumen }) => resumen)

    return c.json(
      profileResponseSchema.parse({
        favorites: favoritosOk,
        watched,
        planToWatch,
        history: {
          items: historyItems(historialOk),
          page: 1,
          hasMore,
        },
      }),
    )
  })
}
