/**
 * Rutas de visionado: `POST /api/watch` y `PATCH /api/watch/:id`.
 *
 * Son dos y no una porque son dos momentos distintos: abrir la fila cuando la
 * reproducción **empieza de verdad**, y moverla mientras avanza. Sin el primer
 * paso, cargar la ficha de un episodio ya contaría como haberlo visto, y
 * «continuar viendo» se llenaría de títulos que nadie reprodujo.
 *
 * El identificador lo devuelve el alta y lo usa el avance: una fila, un
 * visionado. Buscar por episodio y modo en cada avance haría que dos pestañas
 * abiertas con el mismo episodio se pisaran la posición.
 */

import {
  continueWatchingResponseSchema,
  errorResponseSchema,
  type WatchHistoryItem,
  type WatchRecord,
  watchedRatio,
  watchHistoryResponseSchema,
  watchStartRequestSchema,
  watchStartResponseSchema,
  watchUpdateRequestSchema,
} from '@nn-anime/core'
import type { Hono } from 'hono'
import { sinMarcadas } from '../adultos'
import type { ServerContainer } from '../container'
import { parsePage } from './episodes'
import { adultContentOf } from './settings'

export interface WatchRouteOptions {
  readonly container: ServerContainer
}

/**
 * La fila «continuar viendo».
 *
 * Se cortan los visionados terminados y los que no llegaron al 2 %: lo primero
 * porque ya se vio, y lo segundo porque abrir un episodio y cerrarlo no es «estar
 * viendo» nada. **El corte de arriba es la bandera `finished`** —y no una
 * proporción propia— desde que el almacén la escribe con el mismo umbral que lee
 * la ficha: con dos umbrales, un episodio podía salir «visto» en la ficha y
 * seguir en «continuar viendo» en la home.
 *
 * La proporción la calcula el servidor y no el cliente: si la calculara cada
 * pantalla, dos pantallas podrían pintar la misma barra con valores distintos.
 */
export const MIN_CONTINUE_RATIO = 0.02

/** Cuántas tarjetas enseña la fila. */
export const CONTINUE_LIMIT = 20

/**
 * Cuántas filas se leen para llenarla.
 *
 * Más que la cuota porque un episodio tiene **varias filas** —cada reproducción
 * abre la suya— y hay que agruparlas antes de recortar. Leyendo sólo veinte, una
 * tarde de reproducciones del mismo episodio dejaría la fila con una tarjeta.
 */
export const CONTINUE_SCAN = 60

/** Una fila con su proporción vista, ya calculada. */
export interface ContinueCandidate {
  readonly fila: WatchRecord
  readonly ratio: number
}

/**
 * Un episodio, una tarjeta.
 *
 * Cada reproducción abre su propia fila de visionado, así que el mismo episodio
 * aparece tantas veces como se haya abierto: la fila enseñaba la misma tarjeta
 * repetida. Se agrupa por episodio y se queda la que **más avanzó**, que es la
 * que dice dónde se dejó de verdad. Así un episodio terminado desaparece en vez
 * de resucitar por una fila vieja que se quedó a medias.
 *
 * El orden se conserva: el del episodio más reciente, que es el que traía la
 * lista de la consulta.
 */
export function unaPorEpisodio(filas: readonly WatchRecord[]): readonly ContinueCandidate[] {
  const porEpisodio = new Map<string, ContinueCandidate>()

  for (const fila of filas) {
    const ratio = watchedRatio(fila.positionS, fila.durationS)
    // El modo no entra en la clave: el episodio es el mismo se vea como se vea,
    // y la tarjeta se abre en el modo de la fila que gane.
    const clave = `${fila.providerId}\u0000${fila.anime.ref.value}\u0000${fila.episodeNumber}`
    const previo = porEpisodio.get(clave)

    if (previo === undefined || ratio > previo.ratio) porEpisodio.set(clave, { fila, ratio })
  }

  return [...porEpisodio.values()]
}

/** Cuántas filas trae una página del historial. */
export const HISTORY_PAGE_SIZE = 50

/**
 * Un visionado en la forma del contrato del historial.
 *
 * Vive aquí y no dentro de la ruta porque la usan **dos** superficies —la página
 * del Historial y la vista previa del Perfil— y tienen que contar lo mismo: con dos
 * copias, la misma fila saldría con la proporción calculada de dos maneras y las
 * dos pantallas enseñarían barras distintas del mismo episodio.
 *
 * La proporción la calcula el servidor, como en «continuar viendo»: si la calculara
 * cada pantalla, dos pantallas podrían pintar la misma barra con valores distintos.
 */
export function historyItems(filas: readonly WatchRecord[]): readonly WatchHistoryItem[] {
  return filas.map((fila) => ({
    animeRef: fila.anime.ref,
    title: fila.anime.title,
    ...(fila.anime.coverUrl === undefined ? {} : { coverUrl: fila.anime.coverUrl }),
    // La convención de la referencia de un episodio: el número detrás de la
    // almohadilla. Es la misma que arma la fila de «continuar viendo».
    episodeRef: {
      providerId: fila.providerId,
      value: `${fila.anime.ref.value}#${fila.episodeNumber}`,
    },
    episodeNumber: fila.episodeNumber,
    mode: fila.mode,
    positionS: fila.positionS,
    durationS: fila.durationS,
    ratio: watchedRatio(fila.positionS, fila.durationS),
    watchedAt: fila.startedAt.toISOString(),
    finished: fila.finished,
  }))
}

export function registerWatchRoutes(app: Hono, options: WatchRouteOptions): void {
  app.get('/api/watch/recent', async (c) => {
    const conAdultos = await adultContentOf(options.container.store)

    // Lo que se retoma también se calla con el interruptor apagado: una obra marcada no
    // vuelve a la vitrina por la puerta de «continuar viendo».
    const filas = await sinMarcadas(
      options.container.store,
      await options.container.store.listRecentlyWatched(CONTINUE_SCAN),
      conAdultos,
      (fila) => fila.anime.ref,
    )

    /*
      Y lo marcado como visto se cae de la fila.

      El filtro vive **aquí y no en `listRecentlyWatched`**: esa lectura es también
      la señal de afinidad del motor, así que filtrarla en la consulta borraría del
      motor un título que sí se vio —dejaría de saber que se reprodujo—. La tabla
      se lee entera porque es pequeña por construcción —una fila por obra marcada—
      y preguntar por cada fila sería la consulta de mil parámetros que el spec del
      almacén prohíbe.
    */
    const marcadas = new Set(
      (await options.container.store.listWatchedTitles()).map(
        (marcada) => `${marcada.ref.providerId}#${marcada.ref.value}`,
      ),
    )
    const reanudables = filas.filter(
      (fila) => !marcadas.has(`${fila.anime.ref.providerId}#${fila.anime.ref.value}`),
    )

    const items = unaPorEpisodio(reanudables)
      .filter(({ fila, ratio }) => !fila.finished && ratio >= MIN_CONTINUE_RATIO)
      .slice(0, CONTINUE_LIMIT)
      .map(({ fila, ratio }) => ({
        animeRef: fila.anime.ref,
        title: fila.anime.title,
        ...(fila.anime.coverUrl === undefined ? {} : { coverUrl: fila.anime.coverUrl }),
        episodeRef: {
          providerId: fila.providerId,
          value: `${fila.anime.ref.value}#${fila.episodeNumber}`,
        },
        episodeNumber: fila.episodeNumber,
        mode: fila.mode,
        positionS: fila.positionS,
        durationS: fila.durationS,
        ratio,
        watchedAt: fila.startedAt.toISOString(),
      }))

    return c.json(continueWatchingResponseSchema.parse({ items }))
  })

  /**
   * El historial completo, por páginas.
   *
   * Va en la misma ruta base que «continuar viendo» y no en `/api/watch/:id`
   * porque comparte el recurso: son dos lecturas de `watch_event` y la dirección lo
   * dice. Lo que **no** comparte es el recorte —aquí nada se descarta y nada se
   * agrupa— ni la lectura del almacén, que es otra a propósito.
   *
   * La página se valida con el mismo analizador que la lista de episodios: una
   * página inventada es un 400 con el motivo, y una convención de páginas distinta
   * en dos rutas de la misma aplicación es dos veces la misma pregunta con dos
   * respuestas.
   */
  app.get('/api/watch/history', async (c) => {
    const pagina = parsePage(c.req.query('page'))
    if (!pagina.ok) {
      return c.json(errorResponseSchema.parse({ error: pagina.error }), 400)
    }

    const conAdultos = await adultContentOf(options.container.store)
    const offset = (pagina.value - 1) * HISTORY_PAGE_SIZE

    // Una fila de más que la página: ver si queda algo detrás sin contar el total,
    // que en una tabla que crece con cada reproducción sería una consulta más para
    // un dato que nadie mira.
    const filas = await options.container.store.listWatchHistory(HISTORY_PAGE_SIZE + 1, offset)
    const hasMore = filas.length > HISTORY_PAGE_SIZE

    const visibles = await sinMarcadas(
      options.container.store,
      filas.slice(0, HISTORY_PAGE_SIZE),
      conAdultos,
      (fila) => fila.anime.ref,
    )

    return c.json(
      watchHistoryResponseSchema.parse({
        items: historyItems(visibles),
        page: pagina.value,
        hasMore,
      }),
    )
  })

  app.post('/api/watch', async (c) => {
    let crudo: unknown
    try {
      crudo = await c.req.json()
    } catch {
      return c.json(errorResponseSchema.parse({ error: 'el cuerpo no es JSON válido' }), 400)
    }

    const parsed = watchStartRequestSchema.safeParse(crudo)
    if (!parsed.success) {
      return c.json(
        errorResponseSchema.parse({ error: `petición inválida: ${parsed.error.message}` }),
        400,
      )
    }

    const { animeRef, episodeRef, mode, startAtS } = parsed.data

    try {
      const id = await options.container.store.recordWatch({
        animeRef,
        episodeRef,
        mode,
        positionS: startAtS ?? 0,
        durationS: 0,
        startedAt: new Date(),
      })

      return c.json(watchStartResponseSchema.parse({ id }), 201)
    } catch (cause) {
      // El caso normal: el episodio no está en la base porque nadie abrió su
      // ficha. Es un 404, no un 500.
      return c.json(
        errorResponseSchema.parse({
          error: cause instanceof Error ? cause.message : String(cause),
        }),
        404,
      )
    }
  })

  app.patch('/api/watch/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) {
      return c.json(errorResponseSchema.parse({ error: 'ese identificador no es válido' }), 400)
    }

    let crudo: unknown
    try {
      crudo = await c.req.json()
    } catch {
      return c.json(errorResponseSchema.parse({ error: 'el cuerpo no es JSON válido' }), 400)
    }

    const parsed = watchUpdateRequestSchema.safeParse(crudo)
    if (!parsed.success) {
      return c.json(
        errorResponseSchema.parse({ error: `petición inválida: ${parsed.error.message}` }),
        400,
      )
    }

    try {
      await options.container.store.updateWatchPosition(
        id,
        parsed.data.positionS,
        parsed.data.durationS,
      )
    } catch (cause) {
      return c.json(
        errorResponseSchema.parse({
          error: cause instanceof Error ? cause.message : String(cause),
        }),
        404,
      )
    }

    return c.body(null, 204)
  })
}
