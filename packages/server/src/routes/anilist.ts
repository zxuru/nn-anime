/**
 * Las rutas de AniList: descubrimiento, enriquecimiento e imágenes.
 *
 * Tres familias con la misma forma de trabajar: **nada de lo que pasa aquí tumba
 * una pantalla**. Si AniList no contesta, el descubrimiento devuelve lo que tenía
 * cacheado o una lista vacía —y la interfaz vuelve a lo de la fuente—, el
 * enriquecimiento devuelve `null` y la ficha se queda con lo que ya sabía, y la
 * imagen contesta 404 sólo si su obra no está en la caché. Un tercero caído no es
 * un error del usuario.
 *
 * La imagen se pide **por referencia** (`/api/anilist/image/cover/101922`), nunca
 * por dirección: la URL la resuelve el servidor contra su caché y la lista blanca
 * de hosts de imagen sigue siendo la única puerta. El navegador no puede usar
 * esta ruta como proxy hacia donde quiera, que es la misma garantía que la ruta
 * de portadas de proveedor.
 *
 * El emparejamiento local va en la respuesta, no en el cliente: cada pieza sale
 * con la referencia de una ficha de verdad cuando la base la conoce, y sin ella
 * cuando no. La interfaz sólo decide qué enlace pintar.
 */

import type {
  AiringItem,
  AniListEntry,
  DiscoverItem,
  Enrichment,
  LocalWork,
  MediaFilter,
  ProviderRef,
} from '@nn-anime/core'
import {
  airingResponseSchema,
  anilistImagePath,
  discoverResponseSchema,
  enrichmentBatchRequestSchema,
  enrichmentBatchResponseSchema,
  enrichmentResponseSchema,
  errorResponseSchema,
  kindOfFormat,
  localWork,
} from '@nn-anime/core'
import {
  type FetchLike,
  MAX_COVER_BYTES,
  proxyBytes,
  RASTER_TYPES,
  type Resolver,
} from '@nn-anime/media-proxy'
import type { Provider } from '@nn-anime/provider-sdk'
import type { Hono } from 'hono'
import type { AniListCatalog } from '../anilist/catalog'
import { matchKey } from '../anilist/catalog'
import { isAniListImageUrl } from '../anilist/entries'
import type { ServerContainer } from '../container'
import { findProvider } from './anime'
import { mediaFrom } from './media'

/** La ventana por defecto de la parrilla, en días. */
export const DEFAULT_AIRING_DAYS = 7
/** El techo: más de un mes no es una parrilla, es un catálogo. */
export const MAX_AIRING_DAYS = 31
/** Los días pedidos, saneados: un valor sin sentido es una petición sin preferencia. */
export function airingDays(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_AIRING_DAYS

  const numero = Number(raw)
  if (!Number.isInteger(numero) || numero <= 0) return DEFAULT_AIRING_DAYS

  return Math.min(numero, MAX_AIRING_DAYS)
}

export interface AniListRoutesOptions {
  readonly providers: readonly Provider[]
  readonly container: ServerContainer
  readonly catalog: AniListCatalog
  /** `fetch` de la imagen. Se inyecta en los tests para no salir a la red. */
  readonly fetchImpl?: FetchLike | undefined
  readonly resolver?: Resolver | undefined
  readonly allowLoopback?: boolean | undefined
}

/** Una obra de AniList como pieza de descubrimiento. */
export function discoverItem(entrada: AniListEntry, ref: ProviderRef | undefined): DiscoverItem {
  const kind = kindOfFormat(entrada.format ?? '')

  return {
    anilistId: entrada.id,
    title: entrada.names.romaji,
    cover: anilistImagePath('cover', entrada.id),
    adult: entrada.adult,
    ...(entrada.score === undefined ? {} : { score: entrada.score }),
    ...(entrada.year === undefined ? {} : { year: entrada.year }),
    ...(kind === undefined ? {} : { kind }),
    ...(entrada.format === undefined ? {} : { format: entrada.format }),
    ...(entrada.episodes === undefined ? {} : { episodes: entrada.episodes }),
    ...(ref === undefined ? {} : { ref }),
  }
}

/** Un capítulo de la parrilla como pieza. */
export function airingItem(
  media: AniListEntry,
  airingAt: string | undefined,
  episode: number | undefined,
  ref: ProviderRef | undefined,
  year?: number | undefined,
): AiringItem {
  const kind = kindOfFormat(media.format ?? '')

  return {
    anilistId: media.id,
    title: media.names.romaji,
    cover: anilistImagePath('cover', media.id),
    adult: media.adult,
    ...(episode === undefined ? {} : { episode }),
    ...(airingAt === undefined ? {} : { airingAt }),
    ...(year === undefined ? {} : { year }),
    ...(kind === undefined ? {} : { kind }),
    ...(ref === undefined ? {} : { ref }),
  }
}

/** El enriquecimiento de una obra, en la forma de la frontera. */
export function enrichmentOf(entrada: AniListEntry): Enrichment {
  return {
    anilistId: entrada.id,
    cover: anilistImagePath('cover', entrada.id),
    adult: entrada.adult,
    ...(entrada.bannerUrl === undefined ? {} : { banner: anilistImagePath('banner', entrada.id) }),
    ...(entrada.synopsis === undefined ? {} : { synopsis: entrada.synopsis }),
    genres: [...entrada.genres],
    ...(entrada.score === undefined ? {} : { score: entrada.score }),
    ...(entrada.status === undefined ? {} : { status: entrada.status }),
    ...(entrada.year === undefined ? {} : { year: entrada.year }),
    ...(entrada.format === undefined ? {} : { format: entrada.format }),
    ...(entrada.episodes === undefined ? {} : { episodes: entrada.episodes }),
    ...(entrada.durationMin === undefined ? {} : { durationMin: entrada.durationMin }),
    studios: [...entrada.studios],
    siteUrl: entrada.siteUrl,
    ...(entrada.nextEpisode === undefined ? {} : { nextEpisode: entrada.nextEpisode }),
  }
}

export function registerAniListRoutes(app: Hono, options: AniListRoutesOptions): void {
  const desconocido = (providerId: string) =>
    errorResponseSchema.parse({ error: `no hay ningún proveedor llamado ${providerId}` })

  /**
   * La mitad pedida, con el mismo saneado que el resto de rutas.
   *
   * Sin `media`, la de por defecto —anime, la misma con la que abre la
   * aplicación—. Con `both`, nada: el descubrimiento vive partido en dos y no
   * tiene una mitad «todo»; un 400 lo dice en vez de elegir una por su cuenta.
   */
  const mitad = (raw: string | undefined): MediaFilter | undefined => {
    const pedido = mediaFrom(raw)
    if (!pedido.ok) return undefined
    if (pedido.media === undefined) return 'anime'

    return pedido.media === 'both' ? undefined : pedido.media
  }

  app.get('/api/discover/top', async (c) => {
    const media = mitad(c.req.query('media'))
    if (media === undefined) {
      return c.json(errorResponseSchema.parse({ error: 'media tiene que ser anime o movies' }), 400)
    }

    const resultado = await options.catalog.top(media, c.req.raw.signal)
    if (!resultado.ok) return c.json(discoverResponseSchema.parse({ items: [] }))

    const refs = await options.catalog.localRefs(resultado.value)
    const items = resultado.value.map((entrada) => discoverItem(entrada, refs.get(entrada.id)))

    return c.json(discoverResponseSchema.parse({ items }))
  })

  app.get('/api/discover/airing', async (c) => {
    const media = mitad(c.req.query('media'))
    if (media === undefined) {
      return c.json(errorResponseSchema.parse({ error: 'media tiene que ser anime o movies' }), 400)
    }

    const resultado = await options.catalog.airing(
      media,
      airingDays(c.req.query('days')),
      c.req.raw.signal,
    )
    if (!resultado.ok) return c.json(airingResponseSchema.parse({ items: [] }))

    const refs = await options.catalog.localRefs(resultado.value.map((cita) => cita.media))
    const items = resultado.value.map((cita) =>
      airingItem(cita.media, cita.airingAt, cita.episode, refs.get(cita.media.id), cita.year),
    )

    return c.json(airingResponseSchema.parse({ items }))
  })

  app.get('/api/discover/recent', async (c) => {
    const media = mitad(c.req.query('media'))
    if (media === undefined) {
      return c.json(errorResponseSchema.parse({ error: 'media tiene que ser anime o movies' }), 400)
    }

    const resultado = await options.catalog.recent(media, c.req.raw.signal)
    if (!resultado.ok) return c.json(airingResponseSchema.parse({ items: [] }))

    const refs = await options.catalog.localRefs(resultado.value.map((cita) => cita.media))
    const items = resultado.value.map((cita) =>
      airingItem(cita.media, cita.airingAt, cita.episode, refs.get(cita.media.id), cita.year),
    )

    return c.json(airingResponseSchema.parse({ items }))
  })

  app.get('/api/anime/:providerId/:ref/enrichment', async (c) => {
    const providerId = c.req.param('providerId')
    const ref = c.req.param('ref')

    if (findProvider(options.providers, providerId) === undefined) {
      return c.json(desconocido(providerId), 404)
    }

    const detalle = await options.container.store.readAnime({ providerId, value: ref })
    // Una referencia que la base no conoce no tiene título con el que emparejar:
    // no es un error, es una ficha que nadie ha abierto todavía.
    if (detalle === null) return c.json(enrichmentResponseSchema.parse({ enrichment: null }))

    const key = matchKey(detalle.value.title, detalle.value.year)
    const resultado = await options.catalog.match(
      { key, local: localWorkOf(detalle.value.title, detalle.value.year, detalle.value.titleAlt) },
      c.req.raw.signal,
    )

    if (!resultado.ok) return c.json(enrichmentResponseSchema.parse({ enrichment: null }))

    return c.json(
      enrichmentResponseSchema.parse({
        enrichment: resultado.value === null ? null : enrichmentOf(resultado.value),
      }),
    )
  })

  app.post('/api/enrichment', async (c) => {
    const cuerpo: unknown = await c.req.json().catch(() => undefined)
    const pedido = enrichmentBatchRequestSchema.safeParse(cuerpo)

    if (!pedido.success) {
      return c.json(
        errorResponseSchema.parse({ error: 'la petición no tiene la forma esperada' }),
        400,
      )
    }

    const peticiones: { key: string; local: ReturnType<typeof localWorkOf>; ref: ProviderRef }[] =
      []

    for (const ref of pedido.data.refs) {
      const detalle = await options.container.store.readAnime(ref)
      if (detalle === null) continue

      peticiones.push({
        key: matchKey(detalle.value.title, detalle.value.year),
        local: localWorkOf(detalle.value.title, detalle.value.year, detalle.value.titleAlt),
        ref,
      })
    }

    const emparejados = await options.catalog.matchMany(
      peticiones.map(({ key, local }) => ({ key, local })),
      c.req.raw.signal,
    )

    const items = peticiones.flatMap(({ key, ref }) => {
      const media = emparejados.get(key)

      return media === undefined || media === null ? [] : [{ ref, enrichment: enrichmentOf(media) }]
    })

    return c.json(enrichmentBatchResponseSchema.parse({ items }))
  })

  app.get('/api/anilist/image/:kind/:id', async (c) => {
    const kind = c.req.param('kind')
    if (kind !== 'cover' && kind !== 'banner') {
      return c.json(
        errorResponseSchema.parse({ error: `tipo de imagen desconocido: ${kind}` }),
        404,
      )
    }

    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) {
      return c.json(
        errorResponseSchema.parse({ error: `id de imagen inválido: ${c.req.param('id')}` }),
        404,
      )
    }

    const url = await options.catalog.image(id, kind)
    // La ruta no descubre imágenes: sirve la de una obra que ya está en la caché.
    if (url === undefined || !isAniListImageUrl(url)) {
      return c.json(errorResponseSchema.parse({ error: `no hay imagen ${kind} para ${id}` }), 404)
    }

    const etag = imageEtag(kind, id)
    if (c.req.header('if-none-match') === etag) return c.body(null, 304)

    const respuesta = await proxyBytes({
      url,
      headers: {},
      signal: c.req.raw.signal,
      acceptedTypes: RASTER_TYPES,
      maxBytes: MAX_COVER_BYTES,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
      ...(options.allowLoopback === undefined ? {} : { allowLoopback: options.allowLoopback }),
    })

    if (!respuesta.ok) return respuesta

    const salida = new Response(respuesta.body, {
      status: respuesta.status,
      headers: respuesta.headers,
    })
    salida.headers.set('cache-control', `public, max-age=${IMAGE_MAX_AGE_S}`)
    salida.headers.set('etag', etag)

    return salida
  })
}

/** Una semana, como la portada de un proveedor. */
export const IMAGE_MAX_AGE_S = 604800

/** El ETag de una imagen, derivado de su referencia y no de su dirección. */
export function imageEtag(kind: string, id: number): string {
  const hash = new Bun.CryptoHasher('sha256').update(`${kind}\u0000${id}`).digest('hex')

  return `"${hash.slice(0, 16)}"`
}

/**
 * Los nombres comparables de un título local, con lo que el detalle sabe.
 *
 * `titleAlt` entra: es el otro nombre con el que la fuente reconoce la obra —el
 * original, o el corto— y es exactamente lo que junta «Danmachi» con «Dungeon ni
 * Deai wo Motomeru no wa Machigatteiru Darou ka».
 */
function localWorkOf(
  title: string,
  year: number | undefined,
  titleAlt?: string | undefined,
): LocalWork {
  return localWork({ title, ...(titleAlt === undefined ? {} : { titleAlt }) }, year)
}
