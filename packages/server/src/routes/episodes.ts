/**
 * Rutas de episodios: la lista por páginas, el último y uno por número.
 *
 * Van aparte del detalle porque se piden en momentos distintos: el detalle al
 * abrir la ficha y los episodios al desplegar la lista, con TTL distintos
 * (86400 y 21600). Juntarlos obligaría a pedir y guardar lo que nadie ha pedido
 * todavía.
 *
 * El `X-Cache` que se anuncia es el **de la lista o de la página**, no el del
 * detalle: si el detalle hubo que traerlo para poder guardar los episodios, eso
 * es un detalle interno de la implementación, y quien pregunta por los episodios
 * quiere saber de dónde salieron los episodios.
 *
 * La ruta valida y compone; la caché, el TTL y el troceado de un proveedor que
 * no pagina viven en el contenedor. Aquí no se toca el almacén.
 */

import {
  type Episode,
  episodeResponseSchema,
  episodesResponseSchema,
  err,
  errorResponseSchema,
  ok,
  type ProviderError,
  type Result,
} from '@nn-anime/core'
import type { CallOptions, Provider } from '@nn-anime/provider-sdk'
import type { Context, Hono } from 'hono'
import type { ServerContainer } from '../container'
import { findProvider } from './anime'

export interface EpisodesRouteOptions {
  readonly providers: readonly Provider[]
  readonly container: ServerContainer
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 8000

/**
 * El estado HTTP de un fallo del proveedor.
 *
 * Se repite el criterio del detalle —404 del upstream es 404, lo demás es 502—
 * en una función propia: la comprobación es del recurso, no del tipo de dato,
 * pero el criterio tiene que ser el mismo en las dos rutas para que la interfaz
 * no trate de forma distinta dos fallos iguales.
 */
export function statusForEpisodes(error: ProviderError): 404 | 502 {
  return error.context.estado === 404 ? 404 : 502
}

/**
 * La página pedida en `?page=`, base 1.
 *
 * Ausente es la 1, que es lo que hacía la ruta de siempre: un cliente viejo que
 * no manda el parámetro sigue viendo la primera página. Cualquier otra cosa
 * —cero, negativa, decimal, texto, vacío— es un 400 con el motivo, porque
 * inventarse una página es servir datos que nadie pidió.
 */
export function parsePage(raw: string | undefined): Result<number, string> {
  if (raw === undefined) return ok(1)

  const page = Number(raw)
  if (!Number.isInteger(page) || page < 1) {
    return err(`la página tiene que ser un número entero mayor o igual que 1, no «${raw}»`)
  }

  return ok(page)
}

/**
 * El número de episodio de `number/:n`.
 *
 * Admite decimales —una fuente numera `7.5`— y no admite ni negativos ni
 * infinitos: el schema del episodio exige un número no negativo, así que
 * dejarlo pasar sólo cambiaría un 400 claro por un error de validación opaco.
 */
export function parseEpisodeNumber(raw: string): Result<number, string> {
  const numero = Number(raw)

  if (!Number.isFinite(numero) || numero < 0) {
    return err(`el número de episodio tiene que ser un número mayor o igual que 0, no «${raw}»`)
  }

  return ok(numero)
}

function callOptionsOf(c: Context, timeoutMs: number | undefined): CallOptions {
  return {
    signal: c.req.raw.signal,
    timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }
}

export function registerEpisodesRoute(app: Hono, options: EpisodesRouteOptions): void {
  app.get('/api/anime/:providerId/:ref/episodes', async (c) => {
    const providerId = c.req.param('providerId')
    const ref = c.req.param('ref')

    const provider = findProvider(options.providers, providerId)
    if (provider === undefined) {
      return errorJson(c, 404, `no hay ningún proveedor llamado ${providerId}`)
    }

    const page = parsePage(c.req.query('page'))
    if (!page.ok) {
      return c.json(errorResponseSchema.parse({ error: page.error }), 400)
    }

    const resultado = await options.container.getEpisodesPage(
      provider,
      { providerId, value: ref },
      page.value,
      callOptionsOf(c, options.timeoutMs),
    )

    if (!resultado.ok) {
      return c.json(
        errorResponseSchema.parse({ error: resultado.error.message }),
        statusForEpisodes(resultado.error),
      )
    }

    c.header('X-Cache', resultado.value.source)

    // La forma compartida envuelve la lista: un cuerpo que es un array a secas
    // no se puede ampliar después sin romper a quien lo lee. El total sólo se
    // manda cuando se conoce; inventarlo sería peor que no darlo.
    const { episodes, page: numero, hasMore, total } = resultado.value.value

    return c.json(
      episodesResponseSchema.parse({
        episodes,
        page: numero,
        hasMore,
        ...(total === undefined ? {} : { total }),
      }),
    )
  })

  app.get('/api/anime/:providerId/:ref/episodes/latest', async (c) => {
    const providerId = c.req.param('providerId')
    const ref = c.req.param('ref')

    const provider = findProvider(options.providers, providerId)
    if (provider === undefined) {
      return errorJson(c, 404, `no hay ningún proveedor llamado ${providerId}`)
    }

    const resultado = await options.container.getLatestEpisode(
      provider,
      { providerId, value: ref },
      callOptionsOf(c, options.timeoutMs),
    )

    if (!resultado.ok) {
      return errorJson(c, statusForEpisodes(resultado.error), resultado.error.message)
    }

    return episodeJson(c, resultado.value)
  })

  app.get('/api/anime/:providerId/:ref/episodes/number/:n', async (c) => {
    const providerId = c.req.param('providerId')
    const ref = c.req.param('ref')

    const provider = findProvider(options.providers, providerId)
    if (provider === undefined) {
      return errorJson(c, 404, `no hay ningún proveedor llamado ${providerId}`)
    }

    const numero = parseEpisodeNumber(c.req.param('n'))
    if (!numero.ok) {
      return errorJson(c, 400, numero.error)
    }

    const resultado = await options.container.getEpisode(
      provider,
      { providerId, value: ref },
      numero.value,
      callOptionsOf(c, options.timeoutMs),
    )

    if (!resultado.ok) {
      return errorJson(c, statusForEpisodes(resultado.error), resultado.error.message)
    }

    return episodeJson(c, resultado.value)
  })
}

/** El cuerpo de error de las tres rutas: una forma, un sitio. */
function errorJson(c: Context, status: 400 | 404 | 502, message: string): Response {
  return c.json(errorResponseSchema.parse({ error: message }), status)
}

/** Un episodio suelto, envuelto como el resto de la api. */
function episodeJson(c: Context, episode: Episode): Response {
  return c.json(episodeResponseSchema.parse({ episode }))
}
