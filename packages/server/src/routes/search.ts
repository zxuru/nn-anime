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
import type { ServerContainer } from '../container'
import { type AggregateOptions, type SearchEvent, searchAll } from '../search/aggregate'

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

    const selected = selectedProviders(options.providers, parsed.data.provider, parsed.data.media)
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
       */
      if (container !== undefined && parsed.data.q.trim() !== '') {
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

      for await (const event of searchAll(selected, parsed.data.q, {
        signal: disconnected,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        // Con contenedor, la consulta pasa por la caché: un resultado fresco no
        // vuelve a molestar al proveedor, y uno vencido se sirve ya mientras se
        // refresca por detrás.
        call,
      })) {
        // Escribir con el cliente ya ido es un error de escritura, no un evento
        // que nadie vaya a leer.
        if (disconnected.aborted) break

        await escribir(event)
      }
    })
  })
}
