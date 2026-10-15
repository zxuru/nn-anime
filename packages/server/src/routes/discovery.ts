/**
 * Las dos rutas del arranque en frío: `GET /api/feed` y `GET /api/catalog/recent`.
 *
 * Existen por el mismo motivo y son distintas: la home no puede depender de que
 * el usuario haya buscado antes. `recent` mira **lo que la aplicación ya conoce**
 * —lo abierto y lo encontrado por una búsqueda— y `feed` pregunta **a la fuente**,
 * sólo a quien declara que publica novedades.
 *
 * Cuatro reglas que se ven aquí:
 *
 * 1. **La caché va primero.** La segunda carga de la home no puede volver a
 *    pedirle el feed a un sitio de terceros: es la lección que la auditoría de T47
 *    encontró midiendo las tendencias, aplicada desde el principio.
 * 2. **Un proveedor que falla no tumba la fila.** Devuelve lista vacía y lo demás
 *    se pinta; un feed roto no puede dejar la página en blanco.
 * 3. **El tope de entradas lo pone quien lee, no el plugin.** Un feed con miles de
 *    entradas se recorta **antes** de escribir en la caché: una fuente no puede
 *    llenar el disco ni hacer que la home pinte mil tarjetas.
 * 4. **Una tarjeta por obra.** La misma obra publicada por dos fuentes es una
 *    entrada y no dos: la referencia no lo delata —cada una tiene la suya— y la
 *    fila se leía como títulos distintos. La clave es el título normalizado y el
 *    año, la misma que usa la búsqueda.
 *
 * Desde T54 el TTL y el refresco de fondo los lleva el contenedor: la ruta pide
 * «el feed de este proveedor» y recibe lo que hay, caducado o no. Servir la caché
 * sin mirar si estaba vencida era el defecto que dejaba la fila congelada para
 * siempre.
 */

import { refKey } from '@nn-anime/catalog-store'
import type { FeedResponse } from '@nn-anime/core'
import {
  errorResponseSchema,
  feedResponseSchema,
  mediaOf,
  pasaElFiltro,
  puedeServir,
  recentResponseSchema,
  uniqueByWork,
  type WorkItem,
} from '@nn-anime/core'
import type { CallOptions, Provider } from '@nn-anime/provider-sdk'
import type { Hono } from 'hono'
import { adultosDeLaFila, MARGEN_DE_VERIFICACION } from '../adultos'
import type { AniListCatalog } from '../anilist/catalog'
import type { ServerContainer } from '../container'
import { enMedia, mediaFrom, mediaPorProveedor } from './media'
import { clampLimit } from './recommendations'
import { adultContentOf } from './settings'

const DEFAULT_TIMEOUT_MS = 8000

export interface DiscoveryRouteOptions {
  readonly providers: readonly Provider[]
  readonly container: ServerContainer
  /** El catálogo de AniList: el feed lo necesita para saber qué entrada es para adultos. */
  readonly catalog: AniListCatalog
  readonly timeoutMs?: number
}

/**
 * Los proveedores que publican novedades.
 *
 * Se exige la capacidad **y** el método: un plugin que declara `feed` y no lo
 * implementa ya se rechaza al cargar (el test de conformidad lo caza), pero la
 * ruta no puede dar por hecho que el registro lo hizo.
 */
function conFeed(providers: readonly Provider[]): readonly Provider[] {
  return providers.filter(
    (provider) => provider.capabilities.feed && provider.getFeed !== undefined,
  )
}

/**
 * Deduplica por referencia y ordena por fecha, lo más nuevo primero.
 *
 * Las entradas sin fecha van al final y en el orden de la fuente: no se les
 * inventa una fecha para que compitan con las que sí la traen, y el orden de un
 * feed sin fechas es la única información que hay de él.
 */
export function orderFeed(entradas: FeedResponse['items']): FeedResponse['items'] {
  const vistos = new Set<string>()
  const unicas: FeedResponse['items'][number][] = []

  for (const entrada of entradas) {
    const clave = `${entrada.ref.providerId}#${entrada.ref.value}`
    if (vistos.has(clave)) continue

    vistos.add(clave)
    unicas.push(entrada)
  }

  const conFecha = unicas.filter((entrada) => entrada.publishedAt !== undefined)
  const sinFecha = unicas.filter((entrada) => entrada.publishedAt === undefined)

  // `sort` es estable, así que dos entradas con la misma fecha conservan el orden
  // en que llegaron, que es el de la fuente.
  conFecha.sort((a, b) => Date.parse(b.publishedAt ?? '') - Date.parse(a.publishedAt ?? ''))

  return [...conFecha, ...sinFecha]
}

/**
 * La misma obra publicada por dos fuentes deja una entrada.
 *
 * «Novedades» y la lectura de lo último que conoce la aplicación pintaban el mismo
 * título una vez por proveedor —la referencia no lo delata, cada fuente tiene la
 * suya— y la fila se leía como dos obras distintas. La identidad la resuelve
 * `uniqueByWork` con el título, su alternativa y la referencia de cada fuente, así
 * que dos fuentes que nombran la misma obra de otra forma —«Danmachi» y «Dungeon ni
 * Deai wo Motomeru no wa Machigatteiru Darou ka»— también dejan una.
 *
 * El año entra en la comparación porque aquí se tiene: dos fuentes que escriben
 * el mismo título el mismo año son la misma obra, y un año ausente en las dos es
 * tan comparable como un número.
 *
 * Gana la primera, y el orden lo pone quien llama: en las dos filas viene de más
 * nueva a más vieja, así que la que se queda es lo último que se supo de la obra.
 */
export function sinRepetirPorObra<T extends WorkItem>(items: readonly T[]): readonly T[] {
  return uniqueByWork(items, (uno, otro) => (uno.year ?? null) === (otro.year ?? null))
}

export function registerFeedRoute(app: Hono, options: DiscoveryRouteOptions): void {
  app.get('/api/feed', async (c) => {
    const limite = clampLimit(c.req.query('limit'))
    const pedido = mediaFrom(c.req.query('media'))
    if (!pedido.ok) return c.json(errorResponseSchema.parse({ error: pedido.error }), 400)

    // La fuente mixta se consulta en las dos mitades: sus novedades pueden ser de
    // cualquiera de las dos, y sólo se sabe al leer el `kind` de cada entrada.
    const fuentes = conFeed(options.providers).filter((provider) =>
      puedeServir(pedido.media, mediaOf(provider.capabilities)),
    )
    const callOptions: CallOptions = {
      signal: c.req.raw.signal,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    }

    const resultados = await Promise.all(
      fuentes.map(async (provider) => {
        const lectura = await options.container.getFeed(provider, callOptions)

        // Un feed que no responde no puede tumbar la fila: lo local sigue ahí.
        if (!lectura.ok) return []

        // El filtro va después de la caché, como en tendencias: se guarda lo que
        // publica la fuente y cada pestaña se queda con su mitad al leerlo.
        return lectura.value.value.filter((entrada) =>
          pasaElFiltro(pedido.media, mediaOf(provider.capabilities), entrada.kind),
        )
      }),
    )

    const candidatas = sinRepetirPorObra(
      orderFeed(
        resultados.flat().map((entrada) => ({
          ref: entrada.ref,
          title: entrada.title,
          ...(entrada.coverUrl === undefined ? {} : { coverUrl: entrada.coverUrl }),
          ...(entrada.year === undefined ? {} : { year: entrada.year }),
          ...(entrada.kind === undefined ? {} : { kind: entrada.kind }),
          ...(entrada.publishedAt === undefined ? {} : { publishedAt: entrada.publishedAt }),
        })),
      ),
    )

    const conAdultos = await adultContentOf(options.container.store)

    // La verificación va sobre la ventana que se va a enseñar y no sobre el feed entero:
    // la caché guarda hasta doscientas entradas y la fila enseña diez. La primera carga
    // paga esas consultas una vez; después contestan la marca y el emparejamiento.
    const ventana = candidatas.slice(0, limite + MARGEN_DE_VERIFICACION)
    const adultos = await adultosDeLaFila(
      { container: options.container, catalog: options.catalog },
      ventana,
      conAdultos,
      c.req.raw.signal,
    )
    const conMarca = ventana.map((pieza) => ({
      ...pieza,
      ...(adultos.has(refKey(pieza.ref)) ? { adult: true as const } : {}),
    }))

    // El descarte va **antes** del tope: recortar primero dejaría la fila con una pieza
    // menos de las que hay, que es lo mismo que el motor de recomendaciones ya evita.
    const visibles = conAdultos ? conMarca : conMarca.filter((pieza) => pieza.adult === undefined)

    return c.json(feedResponseSchema.parse({ items: visibles.slice(0, limite) }))
  })
}

/**
 * Lo último que la aplicación conoce.
 *
 * Sin proveedores y sin red: es una lectura de la base. Por eso se registra con
 * el contenedor y no con la lista de plugins.
 */
export function registerRecentRoute(app: Hono, options: DiscoveryRouteOptions): void {
  app.get('/api/catalog/recent', async (c) => {
    const limite = clampLimit(c.req.query('limit'))
    const pedido = mediaFrom(c.req.query('media'))
    if (!pedido.ok) return c.json(errorResponseSchema.parse({ error: pedido.error }), 400)

    /**
     * Se lee más de lo que se va a pintar.
     *
     * La lectura de la base agrupa por referencia, y la misma obra puede estar en
     * varias fuentes: agrupar por título después recorta filas, y sin margen la
     * fila devolvería menos entradas de las pedidas. El margen es el número de
     * fuentes —cada una aporta como mucho una entrada por obra— y el recorte de
     * después deja el tope donde estaba.
     *
     * El tipo se filtra **después de leer y antes de recortar**, sobre la misma
     * ventana de siempre: la fila es «lo último que la aplicación conoce» y no un
     * ranking, así que una fuente que copa las últimas fichas se lleva su mitad y
     * la otra mitad enseña lo que haya. Leer el catálogo entero para llenar una
     * fila sería pagar la lectura por lo que no se va a pintar.
     */
    const margen = Math.max(1, options.providers.length)
    const leidas = await options.container.store.listRecentSummaries(limite * margen)
    const delTipo = enMedia(leidas, pedido.media, mediaPorProveedor(options.providers))
    const items = sinRepetirPorObra(delTipo).slice(0, limite)

    return c.json(recentResponseSchema.parse({ items: [...items] }))
  })
}
