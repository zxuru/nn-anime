/**
 * La ruta de los saltos de un episodio: `GET /api/skip-times/:anilistId/:episode`.
 *
 * El cliente web no llama a AniSkip nunca. Esta ruta es la que resuelve el id de
 * MAL —un dato que el navegador no tiene— y la que compone la URL del tercero
 * dentro de la lista blanca del servidor. Lo que sale por aquí ya está
 * normalizado y validado con el schema del contrato.
 *
 * El estado del camino feliz y del camino roto es el mismo: **200 con la lista**,
 * vacía si no hay datos, si la obra no tiene ficha de MAL o si AniSkip no
 * contesta. El reproductor no distingue esos tres casos y no tiene por qué; un
 * 4xx o un 5xx aquí sólo serviría para que la interfaz tuviera que tragárselo.
 * El 400 queda para lo que sí es una petición mal escrita: parámetros inválidos.
 */

import { errorResponseSchema, skipTimesResponseSchema } from '@rona/core'
import type { FetchLike, Resolver } from '@rona/media-proxy'
import type { Hono } from 'hono'
import { type AniSkipClient, aniskipOfflineFromEnv, createAniSkipClient } from '../aniskip/client'
import { createSkipTimesService } from '../aniskip/service'
import type { ServerContainer } from '../container'

/**
 * Tope de duración que se acepta, en segundos.
 *
 * Un episodio no dura un día: el tope existe para que un `length` absurdo —o una
 * cadena de un megabyte— no llegue a la URL del tercero. 24 horas es holgado y
 * sigue siendo un número.
 */
export const MAX_EPISODE_LENGTH_S = 86_400

/**
 * Lo que la ruta acepta de `length`: segundos positivos, con decimales.
 *
 * El reproductor publica la duración con decimales —`1441.94`—, así que la
 * rechazar por no ser entera rompería justo el camino normal.
 */
const LENGTH_PATTERN = /^\d+(?:\.\d+)?$/

/**
 * La caché que la interfaz puede guardar.
 *
 * Es privada porque la respuesta depende de la sesión —los guards la exigen— y no
 * se comparte entre usuarios. Una hora: el servidor ya cachea el dato, y esto
 * sólo evita que mover la barra de progreso vuelva a pedirlo. El borde de AniSkip
 * cachea cinco minutos (medido), así que no se está sirviendo nada que el tercero
 * considere más fresco que esto; y más tiempo retrasaría ver un intervalo
 * corregido sin ganar nada.
 */
const CACHE_CONTROL = 'private, max-age=3600'

/** Un entero positivo de la URL, o `undefined` si no lo es. */
function parsePositiveInt(raw: string): number | undefined {
  if (!/^[1-9]\d*$/.test(raw)) return undefined

  const valor = Number(raw)

  return Number.isSafeInteger(valor) ? valor : undefined
}

/** Un entero no negativo —el episodio 0 existe como especial— o `undefined`. */
function parseNonNegativeInt(raw: string): number | undefined {
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) return undefined

  const valor = Number(raw)

  return Number.isSafeInteger(valor) ? valor : undefined
}

/** La duración opcional, acotada; `undefined` si no vino o si no es válida. */
type LengthParse =
  | { readonly kind: 'absent' }
  | { readonly kind: 'valid'; readonly value: number }
  | { readonly kind: 'invalid' }

function parseLength(raw: string | undefined): LengthParse {
  if (raw === undefined) return { kind: 'absent' }
  if (!LENGTH_PATTERN.test(raw)) return { kind: 'invalid' }

  const valor = Number(raw)
  if (!Number.isFinite(valor) || valor <= 0 || valor > MAX_EPISODE_LENGTH_S) {
    return { kind: 'invalid' }
  }

  return { kind: 'valid', value: valor }
}

export interface SkipTimesRouteOptions {
  readonly container: ServerContainer
  /** Cliente ya construido, para una prueba de ruta que no quiera pasar por `fetch`. */
  readonly client?: AniSkipClient | undefined
  /** Se inyecta en las pruebas: la ruta nunca sale a la red real en un test. */
  readonly fetchImpl?: FetchLike | undefined
  readonly resolver?: Resolver | undefined
  /** Sin salida a AniSkip, para el arnés. Por defecto lo dice el entorno. */
  readonly offline?: boolean | undefined
}

export function registerSkipTimesRoute(app: Hono, options: SkipTimesRouteOptions): void {
  const client =
    options.client ??
    createAniSkipClient({
      offline: options.offline ?? aniskipOfflineFromEnv(),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
    })

  const servicio = createSkipTimesService({ store: options.container.store, client })

  app.get('/api/skip-times/:anilistId/:episode', async (c) => {
    const anilistId = parsePositiveInt(c.req.param('anilistId'))
    if (anilistId === undefined) {
      return c.json(
        errorResponseSchema.parse({ error: 'anilistId tiene que ser un entero positivo' }),
        400,
      )
    }

    const episode = parseNonNegativeInt(c.req.param('episode'))
    if (episode === undefined) {
      return c.json(
        errorResponseSchema.parse({ error: 'episode tiene que ser un entero no negativo' }),
        400,
      )
    }

    const length = parseLength(c.req.query('length'))
    if (length.kind === 'invalid') {
      return c.json(
        errorResponseSchema.parse({
          error: `length tiene que ser un número mayor que 0 y como mucho ${MAX_EPISODE_LENGTH_S}`,
        }),
        400,
      )
    }

    // Sin `length` el servicio no consulta: AniSkip la exige y con ella elige la
    // entrada. La petición no es un 400 —no está mal escrita—, pero la respuesta
    // honesta es la lista vacía; el reproductor siempre manda la duración.
    const intervals = await servicio.skipTimes({
      anilistId,
      episode,
      ...(length.kind === 'valid' ? { length: length.value } : {}),
    })

    c.header('cache-control', CACHE_CONTROL)

    return c.json(skipTimesResponseSchema.parse(intervals))
  })
}
