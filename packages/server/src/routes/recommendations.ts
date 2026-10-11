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

import type { Candidate, SearchResult } from '@nn-anime/core'
import {
  errorResponseSchema,
  recommendationsResponseSchema,
  trendingResponseSchema,
} from '@nn-anime/core'
import type { CallOptions, Provider } from '@nn-anime/provider-sdk'
import { recommend } from '@nn-anime/recsys'
import type { Hono } from 'hono'
import type { ServerContainer } from '../container'
import { gatherSignals, refKey } from '../recommend/signals'

/** Tope de la lista: más de veinte recomendaciones no las mira nadie. */
export const MAX_LIMIT = 20

export interface RecommendationsRouteOptions {
  readonly providers: readonly Provider[]
  readonly container: ServerContainer
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
 * El título reducido a lo comparable.
 *
 * Dos fuentes escriben el mismo anime de otra manera —mayúsculas, un signo de
 * más, acentos—, y la referencia no lo delata: cada una numera a su aire. Lo que
 * queda es letras y números, que es lo que hace que «One Piece» de una fuente y
 * «one  piece!» de la otra sean el mismo puesto de la fila y no dos.
 *
 * No usa `baseTitle`: quitar el marcador de temporada convertiría «Kimetsu no
 * Yaiba» y su «Hashira Geiko-hen» en el mismo título, y son dos puestos que la
 * fuente publica por separado.
 */
export function claveDeTitulo(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Una tarjeta por anime, en el orden en que llegaron.
 *
 * Se repite por dos caminos distintos y los dos se vieron en la home: la
 * **referencia** —una fuente publica el mismo puesto dos veces— y el **título**
 * —dos fuentes publican el mismo anime con referencias propias—. Por referencia
 * no se reconocen, así que hay que mirar el título.
 *
 * Gana el primero. El orden de las fuentes es la única preferencia que hay, y
 * preferir la portada de una sobre la de otra no está escrito en ningún sitio.
 */
export function sinRepetir(resultados: readonly SearchResult[]): readonly SearchResult[] {
  const refs = new Set<string>()
  const titulos = new Set<string>()
  const unicos: SearchResult[] = []

  for (const resultado of resultados) {
    const ref = refKey(resultado.ref)
    if (refs.has(ref)) continue

    const titulo = claveDeTitulo(resultado.title)
    // Un título vacío no empareja con nada: sin esto, dos entradas sin título se
    // comerían la una a la otra.
    if (titulo !== '' && titulos.has(titulo)) continue

    refs.add(ref)
    titulos.add(titulo)
    unicos.push(resultado)
  }

  return unicos
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
    const conTendencias = options.providers.filter(
      (provider) => provider.capabilities.trending && provider.getTrending !== undefined,
    )

    // Primero la caché: la segunda carga de la home no puede volver a pedir las
    // tendencias. Lo encontró la auditoría de T47 midiendo las llamadas.
    const resultados = await Promise.all(
      conTendencias.map(async (provider) => {
        const cacheado = await options.container.store.readTrending(provider.id)
        if (cacheado !== null) return cacheado.value

        const tendencias = provider.getTrending
        if (tendencias === undefined) return []

        try {
          const lista = await tendencias.call(provider, {
            signal: c.req.raw.signal,
            timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          })
          await options.container.store.writeTrending(provider.id, lista)

          return lista
        } catch {
          // Un proveedor que no responde a tendencias no puede tumbar la lista.
          return []
        }
      }),
    )

    const items = sinRepetir(resultados.flat()).map((resultado) => ({
      ref: resultado.ref,
      title: resultado.title,
      ...(resultado.coverUrl === undefined ? {} : { coverUrl: resultado.coverUrl }),
      ...(resultado.year === undefined ? {} : { year: resultado.year }),
      ...(resultado.kind === undefined ? {} : { kind: resultado.kind }),
    }))

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
    const señales = await gatherSignals(options.container.store)
    const conConsulta =
      consulta === ''
        ? señales
        : {
            ...señales,
            searches: [{ query: consulta, at: new Date(ahora), hits: 1 }, ...señales.searches],
          }
    const candidatos: Candidate[] = [...señales.candidates]

    // Tendencias: lo único que se pide al proveedor, y sólo si dice saber hacerlo.
    const conTendencias = options.providers.filter(
      (provider) => provider.capabilities.trending && provider.getTrending !== undefined,
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
          const cacheado = await options.container.store.readTrending(provider.id)
          if (cacheado !== null) return cacheado.value

          try {
            const tendencias = provider.getTrending
            if (tendencias === undefined) return []

            const lista = await tendencias.call(provider, callOptions)
            await options.container.store.writeTrending(provider.id, lista)

            return lista
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

      for (const resultado of resultados.flat()) {
        const clave = refKey(resultado.ref)
        if (yaEstan.has(clave)) continue

        yaEstan.add(clave)
        const cacheado = enLaBase.get(clave)

        candidatos.push({
          ref: resultado.ref,
          title: resultado.title,
          tags: cacheado === undefined ? [] : [...cacheado.tags],
          studios: cacheado === undefined ? [] : [...cacheado.studios],
          ...(resultado.coverUrl === undefined ? {} : { coverUrl: resultado.coverUrl }),
          ...(resultado.year === undefined ? {} : { year: resultado.year }),
          popularity: 1,
        })
      }
    }

    const salida = recommend(conConsulta, candidatos, { limit: limite, now: ahora })

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
