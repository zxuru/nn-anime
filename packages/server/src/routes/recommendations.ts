/**
 * Ruta de recomendaciones: `GET /api/recommendations`.
 *
 * El motor es puro y este es el cableado: junta las señales locales, añade lo que
 * sólo el proveedor puede dar —tendencias—, llama a `recommend()` y traduce el
 * resultado a la forma pública.
 *
 * Tres reglas del spec, y las tres se ven aquí:
 *
 * 1. **Sin historial no se llama al proveedor salvo `getTrending`.** Si no hay
 *    nada que recomendar, pedirle detalles a un sitio de terceros es gastar su
 *    ancho de banda para nada.
 * 2. **Cada candidato se enriquece con tags desde el store.** Un título sin tags
 *    no entra en el ranking de afinidad y sólo puede entrar por popularidad: es
 *    lo que hace que un título recién cacheado no desaparezca.
 * 3. **La respuesta no lleva `components` por defecto.** Es información de
 *    depuración, y exponerla sin que nadie la pida es contar cómo funciona el
 *    motor sin motivo.
 */

import type { Candidate, SearchResult } from '@rona/core'
import {
  errorResponseSchema,
  mediaOf,
  pasaElFiltroDeMedia,
  puedeServir,
  recommendationsResponseSchema,
  trendingResponseSchema,
  uniqueByWork,
} from '@rona/core'
import type { CallOptions, Provider } from '@rona/provider-sdk'
import { recommend } from '@rona/recsys'
import type { Hono } from 'hono'
import { adultosDeLaFila, TOPE_DE_VERIFICACION } from '../adultos'
import type { AniListCatalog } from '../anilist/catalog'
import type { ServerContainer } from '../container'
import { gatherSignals, refKey } from '../recommend/signals'
import { providerAudio } from '../recommend/taste'
import { cacheHeader } from './cache-header'
import { enMedia, mediaFrom, mediaPorProveedor } from './media'
import { adultContentOf } from './settings'

/** Tope de la lista: más de veinte recomendaciones no las mira nadie. */
export const MAX_LIMIT = 20

export interface RecommendationsRouteOptions {
  readonly providers: readonly Provider[]
  readonly container: ServerContainer
  /** El catálogo de AniList: las tendencias lo necesitan para saber qué es para adultos. */
  readonly catalog: AniListCatalog
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 8000

/**
 * El límite pedido, recortado al tope y con valor por defecto.
 *
 * Es una función y no dos líneas dentro de la ruta porque el recorte es una
 * decisión con tres casos —vacío, fuera de rango y absurdo— y así se prueba sola.
 * Una mutación que quitaba el recorte sobrevivía cuando la lista de candidatos era
 * más corta que el tope, que es lo normal en una prueba.
 */
export function clampLimit(raw: string | undefined): number {
  const pedido = Number(raw ?? '10')
  if (!Number.isFinite(pedido)) return 10

  return Math.min(Math.max(Math.trunc(pedido), 1), MAX_LIMIT)
}

/**
 * Una tarjeta por anime, en el orden en que llegaron.
 *
 * Se repite por dos caminos distintos y los dos se vieron en la home: la
 * **referencia** —una fuente publica el mismo puesto dos veces— y la **obra**
 * —dos fuentes publican el mismo anime con referencias propias—. Por referencia
 * no se reconocen, así que hay que mirar el título: lo hace `uniqueByWork`, con
 * el título, su alternativa y la referencia de cada fuente.
 *
 * El año no entra aquí: estos resultados salen de los proveedores y casi ninguno
 * lo devuelve, así que exigir que coincida no separaría nada y dejaría fuera la
 * misma obra cuando sólo una fuente lo trae.
 *
 * Gana el primero. El orden de las fuentes es la única preferencia que hay, y
 * preferir la portada de una sobre la de otra no está escrito en ningún sitio.
 */
export function sinRepetir(resultados: readonly SearchResult[]): readonly SearchResult[] {
  const refs = new Set<string>()
  const unicos: SearchResult[] = []

  for (const resultado of resultados) {
    const ref = refKey(resultado.ref)
    if (refs.has(ref)) continue

    refs.add(ref)
    unicos.push(resultado)
  }

  return uniqueByWork(unicos, () => true)
}

/**
 * Una candidata por obra, y la que más señales trae.
 *
 * El motor recibe una candidata por título cacheado y una por cada puesto de
 * tendencias. Dos fuentes que publican la misma obra con referencias propias dan
 * **dos** candidatas —por referencia no se reconocen—, y las dos entraban al
 * ranking: la fila enseñaba el mismo cartel dos veces y gastaba dos de sus puestos
 * en una sola obra. Se vio en la home con «Sousou no Frieren» y su segunda
 * temporada, cada una por duplicado.
 *
 * La identidad es el **nombre**, con la temporada dentro (`sameWork`: «Sousou no
 * Frieren» y «Sousou no Frieren 2nd Season» son dos obras). El año no se exige:
 * casi ninguna fuente lo devuelve, y con la regla estricta la misma obra se
 * quedaría duplicada en cuanto una de las dos no lo trae.
 *
 * Cuando hay varias copias gana la que más etiquetas tiene: es la que el motor
 * puede puntuar por afinidad, y quedarse con la copia vacía la dejaría fuera del
 * ranking aunque el catálogo sí la conozca. El orden de llegada desempata, así que
 * la lista no cambia entre dos lecturas iguales.
 */
export function sinRepetirCandidatos(candidatos: readonly Candidate[]): readonly Candidate[] {
  const porCompletitud = [...candidatos].sort((uno, otro) => otro.tags.length - uno.tags.length)

  return uniqueByWork(porCompletitud, () => true)
}

/**
 * Tendencias del proveedor, como fila propia.
 *
 * Va aparte del motor porque es otra cosa: las recomendaciones son para el
 * usuario y esto es lo que está de moda en general. Y sólo se pide a quien dice
 * saber hacerlo: un proveedor sin `getTrending` no se consulta.
 */
export function registerTrendingRoute(app: Hono, options: RecommendationsRouteOptions): void {
  app.get('/api/trending', async (c) => {
    const pedido = mediaFrom(c.req.query('media'))
    if (!pedido.ok) return c.json(errorResponseSchema.parse({ error: pedido.error }), 400)

    const conTendencias = options.providers.filter(
      (provider) =>
        provider.capabilities.trending &&
        provider.getTrending !== undefined &&
        // La fuente mixta entra en las dos mitades: se le pregunta y se reparte lo
        // que devuelva. Descartarla aquí dejaría la pestaña de películas sin
        // preguntarle a la única fuente que puede tenerlas.
        puedeServir(pedido.media, mediaOf(provider.capabilities)),
    )

    // Primero la caché, y con su TTL: la segunda carga de la home no puede volver
    // a pedir las tendencias —lo encontró la auditoría de T47 midiendo las
    // llamadas—, pero servirlas caducadas para siempre es lo que T54 corrigió.
    const callOptions: CallOptions = {
      signal: c.req.raw.signal,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    }

    const lecturas = await Promise.all(
      conTendencias.map(async (provider) => {
        const lectura = await options.container.getTrending(provider, callOptions)

        // Un proveedor que no responde a tendencias no puede tumbar la lista.
        if (!lectura.ok) return { items: [], source: undefined }

        // El filtro va **después de la caché**: lo que se guarda es la lista de la
        // fuente, y cada pestaña se queda con su mitad al leerla.
        return {
          items: lectura.value.value.filter((resultado) =>
            pasaElFiltroDeMedia(pedido.media, mediaOf(provider.capabilities), resultado.kind),
          ),
          source: lectura.value.source,
        }
      }),
    )

    // La fila mezcla fuentes: el encabezado es el del peor origen, no el de la
    // primera que contestó.
    const cache = cacheHeader(
      lecturas.flatMap((lectura) => (lectura.source === undefined ? [] : [lectura.source])),
    )
    const candidatos = sinRepetir(lecturas.flatMap((lectura) => lectura.items))
    const conAdultos = await adultContentOf(options.container.store)

    // La fila no tiene tope propio, así que la ventana la pone el tope de verificación:
    // por encima de él la pieza se sirve sin verificar, y eso está declarado en
    // `SECURITY.md`. Una referencia ya marcada no gasta una petición nunca más.
    const ventana = candidatos.slice(0, TOPE_DE_VERIFICACION)
    const adultos = await adultosDeLaFila(
      { container: options.container, catalog: options.catalog },
      ventana,
      conAdultos,
      c.req.raw.signal,
    )
    const visibles = ventana.filter((pieza) => conAdultos || !adultos.has(refKey(pieza.ref)))

    const items = visibles.map((resultado) => ({
      ref: resultado.ref,
      title: resultado.title,
      ...(resultado.coverUrl === undefined ? {} : { coverUrl: resultado.coverUrl }),
      ...(resultado.year === undefined ? {} : { year: resultado.year }),
      ...(resultado.kind === undefined ? {} : { kind: resultado.kind }),
    }))

    if (cache !== undefined) c.header('X-Cache', cache)

    return c.json(trendingResponseSchema.parse({ items }))
  })
}

export function registerRecommendationsRoute(
  app: Hono,
  options: RecommendationsRouteOptions,
): void {
  app.get('/api/recommendations', async (c) => {
    const limite = clampLimit(c.req.query('limit'))
    const ahora = Date.now()

    // La consulta que se está escribiendo entra como búsqueda **de ahora**: el
    // panel tiene que cambiar con lo que el usuario busca, y sin esto la petición
    // viajaba con `q` y el servidor la ignoraba. Lo encontró la revisión del
    // Checkpoint G, no una prueba: la prueba comprobaba que la consulta viajaba,
    // no que sirviera de algo.
    const consulta = c.req.query('q')?.trim() ?? ''
    const pedido = mediaFrom(c.req.query('media'))
    if (!pedido.ok) return c.json(errorResponseSchema.parse({ error: pedido.error }), 400)

    // El filtro va **antes** de recomendar: recortar después deja la fila con menos
    // piezas de las que hay, porque el motor ya habría llenado su tope con títulos que
    // no se van a enseñar.
    const conAdultos = await adultContentOf(options.container.store)
    const señales = await gatherSignals(options.container.store, {
      includeAdult: conAdultos,
      audioByProvider: providerAudio(options.providers),
    })
    const conConsulta =
      consulta === ''
        ? señales
        : {
            ...señales,
            searches: [{ query: consulta, at: new Date(ahora), hits: 1 }, ...señales.searches],
          }
    // Las medias de las fuentes cargadas: lo que ya está en la base se reparte por
    // la fuente que lo trajo, y una referencia de un plugin que ya no está cuenta
    // como anime.
    const medias = mediaPorProveedor(options.providers)
    // El filtro va **antes de recomendar**: recortar después deja la pestaña con
    // menos piezas de las que hay, porque el motor ya habría llenado su tope con
    // títulos de la otra mitad.
    const candidatos: Candidate[] = [...enMedia(señales.candidates, pedido.media, medias)]

    // Tendencias: lo único que se pide al proveedor, y sólo si dice saber hacerlo.
    const conTendencias = options.providers.filter(
      (provider) =>
        provider.capabilities.trending &&
        provider.getTrending !== undefined &&
        puedeServir(pedido.media, mediaOf(provider.capabilities)),
    )
    if (conTendencias.length > 0) {
      const callOptions: CallOptions = {
        signal: c.req.raw.signal,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      }

      // La caché va también aquí: esta ruta es la que alimenta el panel de la home,
      // y sin ella la segunda carga volvía a pedir las tendencias. Lo encontró la
      // auditoría de T47 midiendo las llamadas.
      const resultados = await Promise.all(
        conTendencias.map(async (provider) => {
          const media = mediaOf(provider.capabilities)
          const suyos = (lista: readonly SearchResult[]): readonly SearchResult[] =>
            lista.filter((resultado) => pasaElFiltroDeMedia(pedido.media, media, resultado.kind))

          try {
            // El mismo camino que `/api/trending`: respeta `stale`, revalida por
            // detrás y comparte el «en vuelo» con la otra fila. Leer la caché a
            // mano servía tendencias vencidas y duplicaba llamadas.
            const resultado = await options.container.getTrending(provider, callOptions)
            if (!resultado.ok) return []

            return suyos(resultado.value.value)
          } catch {
            // Un proveedor que no responde a tendencias no puede tumbar la lista:
            // lo local sigue estando.
            return []
          }
        }),
      )

      const yaEstan = new Set(candidatos.map((candidato) => refKey(candidato.ref)))
      // Los títulos que ya están en la base traen sus géneros: un candidato de
      // tendencias que además está cacheado **no** pierde sus características por
      // venir de otra fuente. Sin esto, el cartel de destacado y la lista de
      // géneros se quedaban vacíos cuando el top venía de tendencias.
      const enLaBase = new Map(candidatos.map((candidato) => [refKey(candidato.ref), candidato]))

      // Las tendencias entran por aquí y no por `gatherSignals`, así que se filtran con
      // la misma pasada que la fila de tendencias: si no, el motor elegiría una obra
      // marcada que la fila de al lado no enseña.
      const planas = resultados.flat()
      const adultos = await adultosDeLaFila(
        { container: options.container, catalog: options.catalog },
        planas,
        conAdultos,
        c.req.raw.signal,
      )

      for (const resultado of planas) {
        const clave = refKey(resultado.ref)
        if (yaEstan.has(clave)) continue
        if (!conAdultos && adultos.has(clave)) continue

        yaEstan.add(clave)
        const cacheado = enLaBase.get(clave)

        candidatos.push({
          ref: resultado.ref,
          title: resultado.title,
          tags: cacheado === undefined ? [] : [...cacheado.tags],
          studios: cacheado === undefined ? [] : [...cacheado.studios],
          ...(resultado.coverUrl === undefined ? {} : { coverUrl: resultado.coverUrl }),
          ...(resultado.year === undefined ? {} : { year: resultado.year }),
          // El tipo viaja: la pieza de la home lo enseña y es lo que reparte una
          // fuente mixta. Sin él, lo que entra por tendencias no se podría filtrar
          // en la interfaz si cambiara de pestaña sin volver a pedir.
          ...(resultado.kind === undefined ? {} : { kind: resultado.kind }),
          popularity: 1,
        })
      }
    }

    const salida = recommend(conConsulta, sinRepetirCandidatos(candidatos), {
      limit: limite,
      now: ahora,
    })

    return c.json(
      recommendationsResponseSchema.parse({
        coldStart: salida.coldStart,
        items: salida.items.map((entrada) => ({
          ref: entrada.candidate.ref,
          title: entrada.candidate.title,
          ...(entrada.candidate.coverUrl === undefined
            ? {}
            : { coverUrl: entrada.candidate.coverUrl }),
          ...(entrada.candidate.year === undefined ? {} : { year: entrada.candidate.year }),
          // El tipo del título sale de aquí y no se deduce: es lo que reparte la
          // pestaña de anime de la de películas cuando la fuente sirve las dos.
          ...(entrada.candidate.kind === undefined ? {} : { kind: entrada.candidate.kind }),
          score: entrada.score,
          tags: [...entrada.candidate.tags],
          reason: { kind: entrada.reason.kind, text: entrada.reason.text },
          reasons: entrada.reasons.map((razon) => ({ kind: razon.kind, text: razon.text })),
        })),
      }),
    )
  })

  // El guard de errores de la aplicación ya devuelve `errorResponseSchema`; este
  // importe existe para que la ruta no pueda olvidarse de la forma del error.
  void errorResponseSchema
}
