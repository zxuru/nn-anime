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

import { refKey } from '@nn-anime/catalog-store'
import type {
  AiringItem,
  AniListEntry,
  AniListRelatedItem,
  AniListRelation,
  DiscoverItem,
  Enrichment,
  MediaFilter,
  ProviderRef,
} from '@nn-anime/core'
import {
  airingResponseSchema,
  anilistImagePath,
  anilistRelatedResponseSchema,
  discoverResponseSchema,
  enrichmentBatchRequestSchema,
  enrichmentBatchResponseSchema,
  enrichmentResponseSchema,
  errorResponseSchema,
  kindOfFormat,
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
import { localWorkOf } from '../adultos'
import type { AniListCatalog } from '../anilist/catalog'
import { matchKey } from '../anilist/catalog'
import { isAniListImageUrl, type RelatedEntry } from '../anilist/entries'
import type { ServerContainer } from '../container'
import { findProvider } from './anime'
import { mediaFrom } from './media'
import { adultContentOf } from './settings'

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

/**
 * Lo que se puede servir, según el interruptor.
 *
 * Con el interruptor apagado no sale ninguna obra marcada, venga de la consulta o de
 * la caché. En la parrilla y en lo recién emitido es **el único** filtro que hay: su
 * consulta cuelga de `airingSchedules`, que no admite `isAdult`.
 */
function sinAdultos<T>(
  items: readonly T[],
  conAdultos: boolean,
  esAdulto: (item: T) => boolean,
): readonly T[] {
  return conAdultos ? items : items.filter((item) => !esAdulto(item))
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

/** El tope de la fila: el mismo que el de los relacionados locales. */
export const ANILIST_RELATED_LIMIT = 24

/**
 * El puesto de cada relación en la fila.
 *
 * Primero lo que **encadena** —la secuela, la precuela, la obra madre—, que es
 * lo que se busca al abrir una ficha; después el resto de la franquicia. El orden
 * no es el de AniList, que mezcla un crossover con la secuela.
 */
const PUESTO: Readonly<Record<AniListRelation, number>> = {
  sequel: 0,
  prequel: 1,
  parent: 2,
  sideStory: 3,
  spinOff: 4,
  alternative: 5,
  summary: 6,
  special: 7,
}

/**
 * Las piezas de la fila, en orden y con su tope.
 *
 * Dentro de cada puesto manda el año, lo más antiguo primero —la secuela de 2020
 * antes que la de 2024—, y sin año van al final: inventarles un año las pondría
 * delante de las que sí lo tienen. El título desempata para que dos llamadas
 * seguidas pinten lo mismo.
 */
export function relatedItems(
  entradas: readonly RelatedEntry[],
  refs: ReadonlyMap<number, ProviderRef>,
): readonly AniListRelatedItem[] {
  return [...entradas]
    .sort((una, otra) => {
      const puesto = PUESTO[una.relation] - PUESTO[otra.relation]
      if (puesto !== 0) return puesto

      const ano =
        (una.media.year ?? Number.POSITIVE_INFINITY) - (otra.media.year ?? Number.POSITIVE_INFINITY)
      if (ano !== 0) return ano

      return una.media.names.romaji.localeCompare(otra.media.names.romaji)
    })
    .slice(0, ANILIST_RELATED_LIMIT)
    .map((entrada) => ({
      relation: entrada.relation,
      ...discoverItem(entrada.media, refs.get(entrada.media.id)),
    }))
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

    const conAdultos = await adultContentOf(options.container.store)
    const resultado = await options.catalog.top(media, conAdultos, c.req.raw.signal)
    if (!resultado.ok) return c.json(discoverResponseSchema.parse({ items: [] }))

    const visibles = sinAdultos(resultado.value, conAdultos, (entrada) => entrada.adult)
    const refs = await options.catalog.localRefs(visibles)
    const items = visibles.map((entrada) => discoverItem(entrada, refs.get(entrada.id)))

    return c.json(discoverResponseSchema.parse({ items }))
  })

  app.get('/api/discover/airing', async (c) => {
    const media = mitad(c.req.query('media'))
    if (media === undefined) {
      return c.json(errorResponseSchema.parse({ error: 'media tiene que ser anime o movies' }), 400)
    }

    const conAdultos = await adultContentOf(options.container.store)
    const resultado = await options.catalog.airing(
      media,
      airingDays(c.req.query('days')),
      c.req.raw.signal,
    )
    if (!resultado.ok) return c.json(airingResponseSchema.parse({ items: [] }))

    const visibles = sinAdultos(resultado.value, conAdultos, (cita) => cita.media.adult)
    const refs = await options.catalog.localRefs(visibles.map((cita) => cita.media))
    const items = visibles.map((cita) =>
      airingItem(cita.media, cita.airingAt, cita.episode, refs.get(cita.media.id), cita.year),
    )

    return c.json(airingResponseSchema.parse({ items }))
  })

  app.get('/api/discover/recent', async (c) => {
    const media = mitad(c.req.query('media'))
    if (media === undefined) {
      return c.json(errorResponseSchema.parse({ error: 'media tiene que ser anime o movies' }), 400)
    }

    const conAdultos = await adultContentOf(options.container.store)
    const resultado = await options.catalog.recent(media, conAdultos, c.req.raw.signal)
    if (!resultado.ok) return c.json(airingResponseSchema.parse({ items: [] }))

    const visibles = sinAdultos(resultado.value, conAdultos, (cita) => cita.media.adult)
    const refs = await options.catalog.localRefs(visibles.map((cita) => cita.media))
    const items = visibles.map((cita) =>
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

    const providerRef = { providerId, value: ref }
    const conAdultos = await adultContentOf(options.container.store)

    // Lo que ya consta marcado no se pregunta otra vez: la marca es local y no caduca.
    if (!conAdultos && (await options.container.store.listAdultRefs([providerRef])).length > 0) {
      return c.json(enrichmentResponseSchema.parse({ enrichment: null }))
    }

    const detalle = await options.container.store.readAnime(providerRef)
    // Una referencia que la base no conoce no tiene título con el que emparejar:
    // no es un error, es una ficha que nadie ha abierto todavía.
    if (detalle === null) return c.json(enrichmentResponseSchema.parse({ enrichment: null }))

    const key = matchKey(detalle.value.title, detalle.value.year)
    const resultado = await options.catalog.match(
      { key, local: localWorkOf(detalle.value.title, detalle.value.year, detalle.value.titleAlt) },
      conAdultos,
      c.req.raw.signal,
    )

    if (!resultado.ok) return c.json(enrichmentResponseSchema.parse({ enrichment: null }))

    const entrada = resultado.value
    if (entrada?.adult === true) {
      // La marca es conocimiento y se apunta en los **dos** estados del interruptor: es lo
      // que pinta el `+18` cuando el contenido está encendido y lo que lo esconde —sin
      // volver a preguntar— cuando está apagado.
      await options.container.store.markAdult(providerRef)

      if (!conAdultos) return c.json(enrichmentResponseSchema.parse({ enrichment: null }))
    }

    return c.json(
      enrichmentResponseSchema.parse({
        enrichment: entrada === null ? null : enrichmentOf(entrada),
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

    const conAdultos = await adultContentOf(options.container.store)
    // Lo que ya consta marcado no gasta una petición: se descarta antes de preguntar.
    const yaMarcadas = new Set(
      (await options.container.store.listAdultRefs(pedido.data.refs)).map((ref) => refKey(ref)),
    )

    const peticiones: { key: string; local: ReturnType<typeof localWorkOf>; ref: ProviderRef }[] =
      []

    for (const ref of pedido.data.refs) {
      if (!conAdultos && yaMarcadas.has(refKey(ref))) continue

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
      conAdultos,
      c.req.raw.signal,
    )

    const porMarcar: ProviderRef[] = []
    const items = peticiones.flatMap(({ key, ref }) => {
      const media = emparejados.get(key)
      if (media === undefined || media === null) return []

      if (media.adult) {
        porMarcar.push(ref)
        if (!conAdultos) return []
      }

      return [{ ref, enrichment: enrichmentOf(media) }]
    })

    // Se apunta lo visto —en los dos estados— y con el interruptor apagado no se sirve: la
    // marca es lo que puede esconder esa obra del feed, de las tendencias y de las filas de
    // la base, donde no hay entrada que consultar. Sin ella, cada carga volvería a
    // preguntar por lo mismo.
    await Promise.all(porMarcar.map((ref) => options.container.store.markAdult(ref)))

    return c.json(enrichmentBatchResponseSchema.parse({ items }))
  })

  /**
   * Las relaciones que AniList declara de la obra emparejada.
   *
   * Tres preguntas encadenadas y ninguna sale a la red si la anterior no tiene
   * respuesta: qué obra local es (la base), con qué obra de AniList se empareja
   * (la caché de emparejamientos, que la ficha ya pidió) y qué relaciona. Sin
   * emparejamiento, sin relaciones o con AniList caído, la respuesta es una lista
   * vacía: la sección no se pinta y la ficha sigue entera. Un proveedor
   * desconocido sigue siendo 404, como en el resto de la ficha.
   */
  app.get('/api/anime/:providerId/:ref/anilist-related', async (c) => {
    const providerId = c.req.param('providerId')
    const ref = c.req.param('ref')

    if (findProvider(options.providers, providerId) === undefined) {
      return c.json(desconocido(providerId), 404)
    }

    const vacio = anilistRelatedResponseSchema.parse({ items: [] })
    const detalle = await options.container.store.readAnime({ providerId, value: ref })
    if (detalle === null) return c.json(vacio)

    const key = matchKey(detalle.value.title, detalle.value.year)
    const emparejado = await options.catalog.match(
      { key, local: localWorkOf(detalle.value.title, detalle.value.year, detalle.value.titleAlt) },
      c.req.raw.signal,
    )
    if (!emparejado.ok || emparejado.value === null) return c.json(vacio)

    const relaciones = await options.catalog.related(emparejado.value.id, c.req.raw.signal)
    if (!relaciones.ok) return c.json(vacio)

    const refs = await options.catalog.localRefs(relaciones.value.map((entrada) => entrada.media))

    return c.json(
      anilistRelatedResponseSchema.parse({ items: relatedItems(relaciones.value, refs) }),
    )
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
