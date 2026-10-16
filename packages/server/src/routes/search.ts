/**
 * Ruta `/api/search`: búsqueda incremental por SSE.
 *
 * El cuerpo de cada evento es el schema compartido de `core`, validado antes de
 * escribirlo. Un evento que la interfaz no sepa leer no es un detalle de
 * presentación: la interfaz lo descarta y el usuario ve una búsqueda que no
 * termina de llegar.
 *
 * La cancelación es la parte que se olvida: si el cliente corta la conexión
 * —porque cierra la pestaña o cambia de consulta— hay que abortar las peticiones
 * a los proveedores. Sin eso, cada búsqueda abandonada deja trabajo vivo contra
 * sitios de terceros, que es justo lo que el spec prohíbe.
 */

import {
  errorResponseSchema,
  hasGenreToken,
  mediaOf,
  ok,
  type ProviderError,
  type ProviderMedia,
  puedeServir,
  type Result,
  type SearchResult,
  searchEventSchema,
  searchQuerySchema,
} from '@nn-anime/core'
import type { CallOptions, Provider } from '@nn-anime/provider-sdk'
import type { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { AniListCatalog } from '../anilist/catalog'
import type { ServerContainer } from '../container'
import {
  type AggregateOptions,
  mergeEvents,
  type SearchEvent,
  searchAll,
} from '../search/aggregate'
import { discoverItem } from './anilist'
import { adultContentOf } from './settings'

/**
 * Identificador del evento que trae lo que ya está en la base.
 *
 * No es un proveedor y por eso no aparece en `/api/providers`: es el catálogo
 * cacheado. Va con nombre propio para que la interfaz no lo confunda con la
 * respuesta de un plugin, y para que un título que además devuelva su proveedor
 * se pueda reconocer por su referencia.
 */
export const CATALOG_PROVIDER_ID = 'catalog'

/**
 * Cuántos títulos cacheados se ofrecen por término. Una fila, no el catálogo.
 *
 * El tope es del evento entero y no de cada lectura: una consulta que encaje con
 * un género y con un estudio a la vez devuelve la unión, y lo que se enseña sigue
 * siendo una fila.
 */
export const CATALOG_LIMIT = 24

/**
 * Lo que se espera a AniList antes de seguir sin él.
 *
 * Su presupuesto espacia las peticiones dos segundos, así que este plazo es «una
 * espera de turno y una ida y vuelta»: cubre el caso normal y **no** deja la
 * búsqueda colgada del tercero. Cumplido el plazo, el flujo cierra con lo que los
 * proveedores y la base hayan dado, que es lo que ya hacía antes de la cruzada.
 */
export const ANILIST_CROSS_TIMEOUT_MS = 3000

/**
 * Lo que AniList tiene de este término como estudio o como género.
 *
 * Es la mitad que ninguna fuente contesta: los proveedores buscan por título, así
 * que de «ufotable» sólo podían salir los títulos que ya estuvieran en la base. La
 * lista vuelve con la referencia local de cada pieza cuando la base ya la conoce
 * —eso es el cruce: la misma obra, dicha por AniList y por una fuente— y sin ella
 * cuando no, que es una pieza que lleva a la búsqueda de su título.
 *
 * Un fallo del tercero no es un error de la pantalla: devuelve `undefined` y la
 * búsqueda sigue con lo de siempre. Por eso tampoco hay evento de error: no hay
 * nada que el usuario pueda hacer con «AniList no contestó» en una búsqueda que
 * sí trajo resultados.
 */
export async function anilistCrossEvent(
  container: ServerContainer,
  catalog: AniListCatalog,
  term: string,
  media: ProviderMedia | undefined,
  signal: AbortSignal,
): Promise<SearchEvent | undefined> {
  const conAdultos = await adultContentOf(container.store)
  const resultado = await catalog.cross(term, media, conAdultos, signal)

  if (!resultado.ok) return undefined

  // El filtro se aplica también al servir y no sólo en la consulta: con el
  // interruptor apagado, una lista cacheada del estado encendido no puede colarse.
  const visibles = resultado.value.filter((entrada) => conAdultos || !entrada.adult)
  if (visibles.length === 0) return undefined

  const refs = await catalog.localRefs(visibles)

  return {
    type: 'anilist',
    items: visibles.map((entrada) => discoverItem(entrada, refs.get(entrada.id))),
  }
}

/**
 * La unión de dos listas de resultados, sin repetir y con el tope puesto.
 *
 * Se compara por referencia —proveedor y valor— y no por título: dos obras
 * homónimas de fuentes distintas son dos fichas, y una que encaje por género y
 * por estudio es una sola.
 */
function unirSinRepetir(
  listas: readonly (readonly SearchResult[])[],
  limit: number,
): readonly SearchResult[] {
  const vistos = new Set<string>()
  const unidos: SearchResult[] = []

  for (const lista of listas) {
    for (const resultado of lista) {
      const clave = `${resultado.ref.providerId}:${resultado.ref.value}`
      if (vistos.has(clave)) continue

      vistos.add(clave)
      unidos.push(resultado)
      if (unidos.length >= limit) return unidos
    }
  }

  return unidos
}

export interface SearchRouteOptions {
  readonly providers: readonly Provider[]
  /** Tiempo límite por proveedor. Se acorta en los tests. */
  readonly timeoutMs?: number
  /**
   * Contenedor con la caché. Sin él se consulta al proveedor siempre: es lo que
   * usan las pruebas de la ruta que no quieren montar una base.
   */
  readonly container?: ServerContainer
  /**
   * El catálogo de AniList, para la búsqueda cruzada.
   *
   * Es el **mismo** que usan la vitrina y la ficha —lo construye el arranque una
   * sola vez—: dos instancias serían dos cachés y dos consultas a un tercero por
   * lo mismo. Sin él, la búsqueda se queda en lo local y en los proveedores, que
   * es lo que hacía antes de esta ruta.
   */
  readonly catalog?: AniListCatalog
}

/**
 * Los proveedores que entran en la búsqueda, según la consulta.
 *
 * El tipo filtra **antes de preguntar**: una búsqueda de películas no puede gastar
 * el ancho de banda de una fuente de anime, que es el mismo motivo por el que el
 * filtro de proveedores existe. Una fuente que sirve las dos cosas sí entra: sus
 * resultados se reparten después, por el `kind` de cada uno.
 */
export function selectedProviders(
  providers: readonly Provider[],
  wanted: readonly string[],
  media: ProviderMedia | undefined = undefined,
): readonly Provider[] {
  const porTipo = providers.filter((provider) => puedeServir(media, mediaOf(provider.capabilities)))

  if (wanted.length === 0) return porTipo

  return porTipo.filter((provider) => wanted.includes(provider.id))
}

export function registerSearchRoute(app: Hono, options: SearchRouteOptions): void {
  app.get('/api/search', (c) => {
    const parsed = searchQuerySchema.safeParse({
      q: c.req.query('q') ?? '',
      provider: c.req.queries('provider') ?? [],
      ...(c.req.query('media') === undefined ? {} : { media: c.req.query('media') }),
    })

    if (!parsed.success) {
      return c.json(
        errorResponseSchema.parse({ error: `consulta inválida: ${parsed.error.message}` }),
        400,
      )
    }

    /**
     * Con un género en la casilla, a las fuentes no se les pregunta.
     *
     * Un término con `#` no es un título: los proveedores buscan el texto literal y
     * devuelven lo que se les parezca —ruido que además se paga en su ancho de banda—. Esa
     * búsqueda la contesta el catálogo, así que la lista de proveedores queda vacía y el
     * cierre lo dice con cero. La regla es la misma que usa la pantalla para decidir qué
     * pinta, y por eso vive en `core` y no aquí.
     */
    const soloCatalogo = hasGenreToken(parsed.data.q)
    const selected = soloCatalogo
      ? []
      : selectedProviders(options.providers, parsed.data.provider, parsed.data.media)
    const timeoutMs = options.timeoutMs
    const container = options.container

    /**
     * La consulta, con caché si hay contenedor.
     *
     * Lo que no puede hacer esta ruta es anunciar el origen en una cabecera
     * `X-Cache`: en SSE las cabeceras se escriben antes de saber qué proveedor
     * responde. Esa cabecera es de las rutas de metadatos (T23).
     */
    const call: AggregateOptions['call'] =
      container === undefined
        ? undefined
        : async (
            provider: Provider,
            query: string,
            callOptions: CallOptions,
          ): Promise<Result<readonly SearchResult[], ProviderError>> => {
            const resultado = await container.searchProvider(provider, query, callOptions)

            return resultado.ok ? ok(resultado.value.value) : resultado
          }
    // La señal del cliente: `fetch` la aborta al cerrar la conexión.
    const disconnected = c.req.raw.signal

    /**
     * La búsqueda cruzada, arrancada **ya**, en paralelo con lo de abajo.
     *
     * Empieza antes de que la base conteste a propósito: su plazo —el del
     * presupuesto de AniList más una ida y vuelta— corre desde este instante, y
     * esperar a tener los locales para lanzarla sería regalarle esa espera al
     * usuario. Si no hay catálogo, no hay término o el tercero no contesta, se
     * resuelve a `undefined` y el flujo sigue igual.
     */
    const cruzada: Promise<SearchEvent | undefined> =
      options.catalog === undefined || container === undefined || parsed.data.q.trim() === ''
        ? Promise.resolve(undefined)
        : anilistCrossEvent(
            container,
            options.catalog,
            parsed.data.q,
            parsed.data.media,
            AbortSignal.any([disconnected, AbortSignal.timeout(ANILIST_CROSS_TIMEOUT_MS)]),
          ).catch(() => undefined)

    return streamSSE(c, async (stream) => {
      const escribir = async (event: SearchEvent): Promise<void> => {
        const payload = searchEventSchema.parse(event)
        await stream.writeSSE({ event: payload.type, data: JSON.stringify(payload) })
      }

      /**
       * Primero lo que el catálogo ya tiene.
       *
       * Es la única forma de que una consulta por **género o por estudio** devuelva
       * algo: los proveedores buscan por título y ninguno entiende «acción» ni
       * «ufotable». Se filtra por los proveedores seleccionados para que el filtro
       * de la interfaz siga significando lo mismo, y se emite como proveedor propio
       * porque estos títulos son de la base, no de la respuesta que esté por llegar.
       *
       * Las dos lecturas se piden siempre y se unen: quien escribe «acción» puede
       * estar buscando el género o un estudio que se llame así, y ninguna de las dos
       * preguntas se puede descartar sin mirar.
       *
       * Con un género escrito en la casilla, esto no se emite: sus títulos ya salen en la
       * lista del catálogo —con su referencia local, que es lo que abre la ficha— y la
       * pantalla no pinta tarjetas de proveedor en esa búsqueda.
       */
      if (!soloCatalogo && container !== undefined && parsed.data.q.trim() !== '') {
        const permitidos = new Set(selected.map((provider) => provider.id))
        const locales = unirSinRepetir(
          [
            await container.store.searchByGenre(parsed.data.q, CATALOG_LIMIT),
            await container.store.searchByStudio(parsed.data.q, CATALOG_LIMIT),
          ],
          CATALOG_LIMIT,
        ).filter((resultado) => permitidos.has(resultado.ref.providerId))

        if (locales.length > 0 && !disconnected.aborted) {
          await escribir({
            type: 'results',
            providerId: CATALOG_PROVIDER_ID,
            results: locales,
          })
        }
      }

      /**
       * Lo de los proveedores y lo de AniList, según va llegando.
       *
       * Los dos flujos empiezan a la vez y ninguno espera al otro: la lista de
       * AniList sale en cuanto está —es la que contesta por estudio y por género— y
       * un proveedor lento no la retrasa. Lo que sí espera es el **cierre**: el
       * `done` de los proveedores se retiene hasta que la cruzada haya hablado, para
       * que la pantalla no dé la búsqueda por terminada —ni diga que no hay nada—
       * con la lista de AniList todavía en camino.
       */
      for await (const event of mergeEvents(
        searchAll(selected, parsed.data.q, {
          signal: disconnected,
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
          // Con contenedor, la consulta pasa por la caché: un resultado fresco no
          // vuelve a molestar al proveedor, y uno vencido se sirve ya mientras se
          // refresca por detrás.
          call,
        }),
        cruzada,
        (evento) => evento.type === 'done',
      )) {
        // Escribir con el cliente ya ido es un error de escritura, no un evento
        // que nadie vaya a leer.
        if (disconnected.aborted) break

        await escribir(event)
      }
    })
  })
}
