/**
 * La caché delante de AniList: qué se pide, cuándo se reutiliza y qué se sirve
 * cuando el tercero no contesta.
 *
 * Es el mismo patrón que el resto de lecturas del proyecto, con una diferencia
 * declarada: aquí no hay `readThrough` ni revalidación de fondo porque no hay un
 * proveedor detrás al que revalidar. La regla es más simple y se lee en un sitio:
 *
 * - Dentro del TTL, la caché manda y no se sale a la red.
 * - Vencida, se pide otra vez **y se espera**: es una lectura de un dato que la
 *   pantalla está enseñando.
 * - Si la petición falla, se sirve lo viejo antes que nada. Una fila de la home
 *   no se vacía porque un tercero esté caído, y el 429 de AniList no puede
 *   convertirse en una pantalla en blanco.
 * - Nada se pide «por si acaso»: cada consulta responde a algo que se está
 *   pintando. Sus términos de uso prohíben el `hoarding` y esto no es un espejo.
 *
 * Las tres lecturas de lista van con **una sola petición en vuelo por clave**: dos
 * pantallas pidiendo el top a la vez comparten la respuesta, y el presupuesto del
 * cliente deja de gastarse dos veces en lo mismo.
 */

import type { CatalogStore } from '@nn-anime/catalog-store'
import { TTL_SECONDS } from '@nn-anime/catalog-store'
import {
  type AniListAiringEntry,
  type AniListEntry,
  type AniListImageKind,
  type AppError,
  anilistAiringEntrySchema,
  anilistEntrySchema,
  err,
  kindOfFormat,
  type LocalWork,
  type Logger,
  type MediaFilter,
  namesOf,
  normalizeQuery,
  ok,
  type ProviderRef,
  pickAniListMatch,
  type Result,
  sameAniListWork,
} from '@nn-anime/core'
import type { z } from 'zod'
import type { AniListClient, AniListOutcome } from './client'
import {
  airingPageSchema,
  mediaOfAlias,
  mediaPageSchema,
  mediaPagesSchema,
  type RawMedia,
  type RelatedEntry,
  relatedEntrySchema,
  relationsSchema,
  toAiringEntry,
  toEntry,
  toRelatedEntries,
} from './entries'
import {
  AIRED_QUERY,
  AIRING_QUERY,
  matchQuery,
  moviesReleasedQuery,
  RELATED_QUERY,
  topQuery,
} from './queries'

/** Los formatos de cada mitad: la interfaz llama «anime» a lo que no es película. */
const FORMATOS = {
  anime: ['TV', 'TV_SHORT', 'SPECIAL', 'OVA', 'ONA'],
  movies: ['MOVIE'],
} as const

/** El tope que admite AniList por página. */
const PER_PAGE = 50
/** Lo que se enseña del top: diez puestos y «mostrar más». */
export const TOP_LIMIT = 30
/** La ventana de lo recién emitido. */
export const RECENT_DAYS = 3
/** La ventana de la parrilla de películas: un estreno no cae en una semana. */
export const MOVIE_WINDOW_DAYS = 30
/** La ventana de los estrenos recientes de películas, hacia atrás. */
export const MOVIE_RELEASED_DAYS = 365
/** Las obras que caben en una consulta de búsqueda. */
export const MATCH_BATCH = 8
/** Lo que se mira de la base al emparejar una obra: el prefiltro ya descarta. */
const LOCAL_SCAN_LIMIT = 200

export interface AniListMatchRequest {
  /** La clave de la caché: el título normalizado y su año. */
  readonly key: string
  readonly local: LocalWork
}

/**
 * La clave con la que se cachea un emparejamiento.
 *
 * El título normalizado y el año: dos obras homónimas de años distintos son dos
 * obras, y la misma obra del mismo año es la misma aunque una fuente la llame con
 * mayúsculas y otra sin ellas. La normalización es la de la búsqueda —recorte,
 * minúsculas, NFC—, no una tercera inventada.
 */
export function matchKey(title: string, year: number | undefined): string {
  return `${normalizeQuery(title)}|${year ?? ''}`
}

export interface AniListCatalogOptions {
  readonly store: CatalogStore
  readonly client: AniListClient
  readonly logger?: Logger | undefined
  readonly now?: (() => number) | undefined
}

export interface AniListCatalog {
  /**
   * El ranking de una mitad.
   *
   * `adultAllowed` decide si la consulta filtra, y **la clave de caché lleva ese
   * eje**: encender el interruptor pide otra cosa, y servir la lista del estado
   * anterior hasta que venza el TTL haría que pareciera roto media hora.
   */
  top(
    media: MediaFilter,
    adultAllowed: boolean,
    signal?: AbortSignal | undefined,
  ): Promise<Result<readonly AniListEntry[], AppError>>
  airing(
    media: MediaFilter,
    days: number,
    signal?: AbortSignal | undefined,
  ): Promise<Result<readonly AniListAiringEntry[], AppError>>
  /**
   * Lo recién emitido. La mitad de anime no se puede filtrar en la consulta
   * —`airingSchedules` no acepta `isAdult`—, así que su caché se comparte entre los
   * dos estados y el descarte lo hace la ruta. La de películas sí lleva el eje.
   */
  recent(
    media: MediaFilter,
    adultAllowed: boolean,
    signal?: AbortSignal | undefined,
  ): Promise<Result<readonly AniListAiringEntry[], AppError>>
  /**
   * Empareja una obra con AniList, **sin filtrar**: preguntar es la única forma de
   * saber que una obra es para adultos. `adultAllowed` decide si su entrada se
   * guarda; con el interruptor apagado, de una obra marcada queda sólo la marca de
   * su referencia.
   */
  match(
    request: AniListMatchRequest,
    adultAllowed: boolean,
    signal?: AbortSignal | undefined,
  ): Promise<Result<AniListEntry | null, AppError>>
  matchMany(
    requests: readonly AniListMatchRequest[],
    adultAllowed: boolean,
    signal?: AbortSignal | undefined,
  ): Promise<ReadonlyMap<string, AniListEntry | null>>
  /**
   * Las relaciones de una obra, por su id de AniList.
   *
   * Lista vacía es una respuesta: la obra no tiene secuelas ni precuelas que
   * enseñar. Un fallo del tercero sólo es un error si no hay nada cacheado.
   */
  related(
    mediaId: number,
    signal?: AbortSignal | undefined,
  ): Promise<Result<readonly RelatedEntry[], AppError>>
  /** Las obras de estas listas que la base ya conoce, por id de AniList. */
  localRefs(entries: readonly AniListEntry[]): Promise<ReadonlyMap<number, ProviderRef>>
  image(mediaId: number, kind: AniListImageKind): Promise<string | undefined>
}

/**
 * Una lectura de caché que no puede tumbar la pantalla.
 *
 * El repositorio valida lo que guardó y **lanza** si no lo entiende —es su
 * contrato—, pero aquí una fila corrupta no puede convertirse en un 500: se trata
 * como si no estuviera, se vuelve a pedir y la escritura la reemplaza. Un dato
 * ilegible es un dato que falta, no un error que el usuario tenga que ver.
 */
async function leerSinRomper<T>(leer: () => Promise<T | null>): Promise<T | null> {
  try {
    return await leer()
  } catch {
    return null
  }
}

/** Una fecha de AniList: `AAAAMMDD`, que es lo que aceptan sus filtros. */
export function fuzzyDate(epochMs: number): number {
  const fecha = new Date(epochMs)

  return fecha.getUTCFullYear() * 10_000 + (fecha.getUTCMonth() + 1) * 100 + fecha.getUTCDate()
}

/** El día de un estreno de AniList, o nada si no lo dice entero. */
function releaseDate(startDate: {
  readonly year?: number | null | undefined
  readonly month?: number | null | undefined
  readonly day?: number | null | undefined
}): string | undefined {
  const { year, month, day } = startDate
  if (year === null || year === undefined) return undefined
  if (month === null || month === undefined) return undefined
  if (day === null || day === undefined) return undefined

  return new Date(Date.UTC(year, month - 1, day)).toISOString()
}

/** Las palabras con las que se prefiltra la base para una obra de AniList. */
function palabrasDe(entrada: AniListEntry): readonly string[] {
  // El romaji, el inglés y el **primer sinónimo**: es donde AniList pone el
  // nombre corto con el que las fuentes titulan la obra —«Danmachi» para
  // «Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka»—, que es justo
  // el caso que el prefiltro tiene que dejar pasar para que el emparejamiento
  // ocurra.
  return [entrada.names.romaji, entrada.names.english, entrada.names.synonyms?.[0]]
    .filter((nombre): nombre is string => nombre !== undefined)
    .map((nombre) => nombre.split(' ')[0] ?? '')
    .filter((palabra) => palabra !== '')
}

/** Las obras que se guardan de una página, sin las que no se pueden pintar. */
function entriesOf(media: readonly RawMedia[]): readonly AniListEntry[] {
  return media.flatMap((una) => {
    const entrada = toEntry(una)

    return entrada === undefined ? [] : [entrada]
  })
}

/**
 * Una lectura de lista con caché y una sola petición en vuelo por clave.
 *
 * `imagenes` saca las obras del contenido para que la ruta de la imagen pueda
 * resolver sus portadas: una lista del top que no declare sus imágenes deja las
 * tarjetas sin poder pedirlas.
 */
async function cachedList<T>(
  options: {
    readonly store: CatalogStore
    readonly clave: string
    readonly schema: z.ZodType<T>
    readonly ttlS: number
    readonly enVuelo: Map<string, Promise<Result<readonly T[], AppError>>>
    readonly imagenes: (items: readonly T[]) => readonly AniListEntry[]
  },
  buscar: () => Promise<Result<readonly T[], AppError>>,
): Promise<Result<readonly T[], AppError>> {
  const guardado = await leerSinRomper(() =>
    options.store.readAniListList(options.clave, options.schema),
  )
  if (guardado !== null && !guardado.stale) return ok(guardado.value)

  const enCurso = options.enVuelo.get(options.clave)
  if (enCurso !== undefined) return enCurso

  const promesa = (async (): Promise<Result<readonly T[], AppError>> => {
    const resultado = await buscar()

    if (!resultado.ok) {
      // Lo viejo antes que nada: un tercero caído no vacía una fila.
      if (guardado !== null) return ok(guardado.value)

      return resultado
    }

    await options.store.writeAniListList(options.clave, resultado.value, {
      ttlS: options.ttlS,
      images: options.imagenes(resultado.value),
    })

    return resultado
  })().finally(() => options.enVuelo.delete(options.clave))

  options.enVuelo.set(options.clave, promesa)

  return promesa
}

/** Una búsqueda por lotes, sin caché: eso lo lleva quien llama. */
async function searchBatch(
  client: AniListClient,
  lote: readonly AniListMatchRequest[],
  signal: AbortSignal | undefined,
): Promise<
  | { readonly ok: true; readonly encontrados: Map<string, AniListEntry | null> }
  | { readonly ok: false; readonly error: AppError }
> {
  const variables: Record<string, string> = {}
  lote.forEach((item, indice) => {
    variables[`q${indice}`] = item.local.names.title
  })

  const outcome: AniListOutcome<z.infer<typeof mediaPagesSchema>> = await client.query({
    key: `match:${lote.map((item) => item.key).join('|')}`,
    query: matchQuery(lote.length),
    variables,
    schema: mediaPagesSchema,
    signal,
  })

  if (!outcome.ok) return { ok: false, error: outcome.error }

  const encontrados = new Map<string, AniListEntry | null>()
  lote.forEach((item, indice) => {
    const pagina = outcome.value[`t${indice}`]
    const candidatas = pagina === undefined ? [] : entriesOf(mediaOfAlias(pagina))
    const elegida = pickAniListMatch(
      item.local.names,
      item.local.year,
      candidatas.flatMap((entrada) => {
        const kind = kindOfFormat(entrada.format ?? '')

        return [
          {
            id: entrada.id,
            names: entrada.names,
            ...(entrada.year === undefined ? {} : { year: entrada.year }),
            ...(kind === undefined ? {} : { kind }),
          },
        ]
      }),
    )

    encontrados.set(
      item.key,
      elegida === undefined
        ? null
        : (candidatas.find((entrada) => entrada.id === elegida.id) ?? null),
    )
  })

  return { ok: true, encontrados }
}

/**
 * El eje del interruptor, para las claves que dependen de él.
 *
 * Sin el eje, la lista pedida con un estado se sirve en el otro hasta que vence el
 * TTL, y el interruptor parece no hacer nada.
 */
function ejeDeAdultos(adultAllowed: boolean): 'all' | 'safe' {
  return adultAllowed ? 'all' : 'safe'
}

/**
 * Si la entrada emparejada se puede guardar.
 *
 * Con el interruptor apagado, de una obra marcada se guarda **sólo la marca de su
 * referencia** —lo hace la ruta, que es quien la conoce— y no la entrada: ni
 * portada, ni sinopsis, ni id de AniList. Así la caché no llega a tener lo que el
 * usuario ha pedido no ver, y la marca evita volver a preguntarlo.
 *
 * Un `null` siempre se guarda: «esta obra no está en AniList» es un dato, y sin él
 * cada carga de la home volvería a preguntar por lo que ya se sabe que no está.
 */
function seGuarda(media: AniListEntry | null, adultAllowed: boolean): boolean {
  return media === null || !media.adult || adultAllowed
}

export function createAniListCatalog(options: AniListCatalogOptions): AniListCatalog {
  const { store, client } = options
  const ahora = options.now ?? Date.now

  const enVueloEntradas = new Map<string, Promise<Result<readonly AniListEntry[], AppError>>>()
  const enVueloParrilla = new Map<
    string,
    Promise<Result<readonly AniListAiringEntry[], AppError>>
  >()
  const enVueloEmparejamiento = new Map<string, Promise<Result<AniListEntry | null, AppError>>>()
  // Las relaciones van con su propia lista en vuelo: abrir dos fichas de la misma
  // obra a la vez comparte la consulta, como el top y la parrilla.
  const enVueloRelaciones = new Map<string, Promise<Result<readonly RelatedEntry[], AppError>>>()

  const avisar = (mensaje: string, contexto: Readonly<Record<string, string | number>>): void => {
    options.logger?.warn(mensaje, contexto)
  }

  const listasDeObras = (items: readonly AniListEntry[]): readonly AniListEntry[] => items
  const listasDeCapitulos = (items: readonly AniListAiringEntry[]): readonly AniListEntry[] =>
    items.map((item) => item.media)

  async function top(
    media: MediaFilter,
    adultAllowed: boolean,
    signal?: AbortSignal,
  ): Promise<Result<readonly AniListEntry[], AppError>> {
    const clave = `top:${media}:${ejeDeAdultos(adultAllowed)}`

    return cachedList(
      {
        store,
        clave,
        schema: anilistEntrySchema,
        ttlS: TTL_SECONDS.anilistTop,
        enVuelo: enVueloEntradas,
        imagenes: listasDeObras,
      },
      async () => {
        const outcome = await client.query({
          key: clave,
          query: topQuery(adultAllowed),
          variables: { perPage: PER_PAGE, formatos: FORMATOS[media] },
          schema: mediaPageSchema,
          signal,
        })

        if (!outcome.ok) return err(outcome.error)

        return ok(entriesOf(outcome.value.Page.media).slice(0, TOP_LIMIT))
      },
    )
  }

  async function airing(
    media: MediaFilter,
    days: number,
    signal?: AbortSignal,
  ): Promise<Result<readonly AniListAiringEntry[], AppError>> {
    const ventana = media === 'movies' ? Math.max(days, MOVIE_WINDOW_DAYS) : days
    const clave = `airing:${media}:${ventana}`
    const desde = ahora()
    const hasta = desde + ventana * 86_400_000

    return cachedList(
      {
        store,
        clave,
        schema: anilistAiringEntrySchema,
        ttlS: TTL_SECONDS.anilistSchedule,
        enVuelo: enVueloParrilla,
        imagenes: listasDeCapitulos,
      },
      async () => {
        // La parrilla de películas **no existe**, y se dice aquí: sus estrenos se
        // anuncian con precisión de año —medido: la API devuelve `{"year": 2026}`
        // para las que vienen— y colocarlas en un calendario por días sería
        // inventar la fecha. Los estrenos recientes sí se listan, sin día.
        if (media === 'movies') return ok([])

        const outcome = await client.query({
          key: clave,
          query: AIRING_QUERY,
          variables: {
            desde: Math.floor(desde / 1000),
            hasta: Math.floor(hasta / 1000),
            perPage: PER_PAGE,
          },
          schema: airingPageSchema,
          signal,
        })

        if (!outcome.ok) return err(outcome.error)

        return ok(
          outcome.value.Page.airingSchedules.flatMap((capitulo) => {
            const entrada = toAiringEntry(capitulo)

            return entrada === undefined ? [] : [entrada]
          }),
        )
      },
    )
  }

  async function recent(
    media: MediaFilter,
    adultAllowed: boolean,
    signal?: AbortSignal,
  ): Promise<Result<readonly AniListAiringEntry[], AppError>> {
    // El eje sólo en la mitad que se puede filtrar: la de anime pide la misma
    // parrilla en los dos estados, así que comparten caché y el descarte lo hace la
    // ruta que sirve.
    const clave =
      media === 'movies' ? `recent:movies:${ejeDeAdultos(adultAllowed)}` : 'recent:anime'
    const hasta = ahora()
    const desde = hasta - RECENT_DAYS * 86_400_000

    return cachedList(
      {
        store,
        clave,
        schema: anilistAiringEntrySchema,
        ttlS: TTL_SECONDS.anilistSchedule,
        enVuelo: enVueloParrilla,
        imagenes: listasDeCapitulos,
      },
      async () => {
        if (media === 'movies') {
          const outcome = await client.query({
            key: clave,
            query: moviesReleasedQuery(adultAllowed),
            variables: {
              desde: fuzzyDate(hasta - MOVIE_RELEASED_DAYS * 86_400_000),
              hasta: fuzzyDate(hasta),
              perPage: PER_PAGE,
            },
            schema: mediaPageSchema,
            signal,
          })

          if (!outcome.ok) return err(outcome.error)

          // Películas ya estrenadas, con el día cuando lo traen —la mayoría— y con
          // el año cuando la API no publica más precisión. Se ordena aquí: con
          // fechas incompletas el orden de la API no significa lo mismo.
          const estrenos = outcome.value.Page.media.flatMap((una) => {
            const entrada = toEntry(una)
            if (entrada === undefined) return []

            const fecha = releaseDate(una.startDate ?? {})
            const anio = una.startDate?.year

            return [
              {
                media: entrada,
                ...(fecha === undefined ? {} : { airingAt: fecha }),
                ...(anio === null || anio === undefined ? {} : { year: anio }),
              },
            ]
          })

          return ok(
            estrenos
              .sort((a, b) => Date.parse(b.airingAt ?? '') - Date.parse(a.airingAt ?? ''))
              .slice(0, TOP_LIMIT),
          )
        }

        const outcome = await client.query({
          key: clave,
          query: AIRED_QUERY,
          variables: {
            desde: Math.floor(desde / 1000),
            hasta: Math.floor(hasta / 1000),
            perPage: PER_PAGE,
          },
          schema: airingPageSchema,
          signal,
        })

        if (!outcome.ok) return err(outcome.error)

        return ok(
          outcome.value.Page.airingSchedules.flatMap((capitulo) => {
            const entrada = toAiringEntry(capitulo)

            return entrada === undefined ? [] : [entrada]
          }),
        )
      },
    )
  }

  /**
   * Lo que la base ya conoce de estas obras, por su id de AniList.
   *
   * Una consulta por lectura —la misma de los relacionados— y la identidad de
   * siempre en memoria. La pieza que se enseña enlaza a una ficha de verdad
   * cuando la hay; si no, a la búsqueda, que es la salida honesta.
   *
   * Se piden las palabras de todas las obras en una sola consulta: una fila de la
   * vitrina puede llevar treinta títulos, y treinta consultas para pintar una fila
   * es justo lo que el spec del almacén prohíbe.
   */
  async function localRefs(
    entradas: readonly AniListEntry[],
  ): Promise<ReadonlyMap<number, ProviderRef>> {
    const palabras = entradas.flatMap((entrada) => palabrasDe(entrada))
    if (palabras.length === 0) return new Map()

    const candidatos = await store.listLocalCandidates(palabras, LOCAL_SCAN_LIMIT)
    const encontrados = new Map<number, ProviderRef>()

    for (const entrada of entradas) {
      let elegido: (typeof candidatos)[number] | undefined

      for (const fila of candidatos) {
        const nombres = namesOf({ title: fila.title, ref: fila.ref.value })
        if (!sameAniListWork(nombres, entrada.names)) continue

        // Entre las candidatas, la del año: dos obras homónimas de años distintos
        // son dos obras, y la tarjeta no puede abrir la del año que no es.
        if (elegido === undefined || fila.year === entrada.year) elegido = fila
        if (fila.year === entrada.year) break
      }

      if (elegido !== undefined) encontrados.set(entrada.id, elegido.ref)
    }

    return encontrados
  }

  async function match(
    request: AniListMatchRequest,
    adultAllowed: boolean,
    signal?: AbortSignal,
  ): Promise<Result<AniListEntry | null, AppError>> {
    const guardado = await leerSinRomper(() => store.readAniListMedia(request.key))
    if (guardado !== null && !guardado.stale) return ok(guardado.value)

    const enCurso = enVueloEmparejamiento.get(request.key)
    if (enCurso !== undefined) return enCurso

    const promesa = (async (): Promise<Result<AniListEntry | null, AppError>> => {
      const lote = await searchBatch(client, [request], signal)

      if (!lote.ok) {
        // El emparejamiento viejo, si lo hay: la ficha sigue enriqueciéndose.
        return guardado === null ? err(lote.error) : ok(guardado.value)
      }

      const media = lote.encontrados.get(request.key) ?? null
      if (seGuarda(media, adultAllowed)) await store.writeAniListMedia(request.key, media)

      return ok(media)
    })().finally(() => enVueloEmparejamiento.delete(request.key))

    enVueloEmparejamiento.set(request.key, promesa)

    return promesa
  }

  async function matchMany(
    requests: readonly AniListMatchRequest[],
    adultAllowed: boolean,
    signal?: AbortSignal,
  ): Promise<ReadonlyMap<string, AniListEntry | null>> {
    const encontrados = new Map<string, AniListEntry | null>()
    const viejos = new Map<string, AniListEntry | null>()
    const porBuscar: AniListMatchRequest[] = []

    const vistos = new Set<string>()
    for (const request of requests) {
      if (vistos.has(request.key)) continue

      vistos.add(request.key)
      const guardado = await leerSinRomper(() => store.readAniListMedia(request.key))
      if (guardado !== null && !guardado.stale) {
        encontrados.set(request.key, guardado.value)
        continue
      }
      if (guardado !== null) viejos.set(request.key, guardado.value)

      porBuscar.push(request)
    }

    for (let inicio = 0; inicio < porBuscar.length; inicio += MATCH_BATCH) {
      const lote = porBuscar.slice(inicio, inicio + MATCH_BATCH)
      const resultado = await searchBatch(client, lote, signal)

      if (!resultado.ok) {
        avisar('no se pudo emparejar un lote con AniList', {
          obras: lote.length,
          motivo: resultado.error.message,
        })
        for (const item of lote) encontrados.set(item.key, viejos.get(item.key) ?? null)
        continue
      }

      for (const item of lote) {
        const media = resultado.encontrados.get(item.key) ?? null
        encontrados.set(item.key, media)
        if (seGuarda(media, adultAllowed)) await store.writeAniListMedia(item.key, media)
      }
    }

    return encontrados
  }

  /**
   * Las relaciones de una obra.
   *
   * La clave es el id de AniList y no el título local: la misma obra en dos
   * fuentes es la misma consulta, y el emparejamiento ya la resolvió antes.
   */
  async function related(
    mediaId: number,
    signal?: AbortSignal,
  ): Promise<Result<readonly RelatedEntry[], AppError>> {
    const clave = `related:${mediaId}`

    return cachedList(
      {
        store,
        clave,
        schema: relatedEntrySchema,
        ttlS: TTL_SECONDS.anilistRelated,
        enVuelo: enVueloRelaciones,
        // La media entera entra en la caché de imágenes: sin ella, la ruta de la
        // portada no tendría con qué resolver la de una secuela.
        imagenes: (items) => items.map((item) => item.media),
      },
      async () => {
        const outcome = await client.query({
          key: clave,
          query: RELATED_QUERY,
          variables: { id: mediaId },
          schema: relationsSchema,
          signal,
        })

        if (!outcome.ok) return err(outcome.error)

        return ok(toRelatedEntries(outcome.value))
      },
    )
  }

  return {
    top,
    airing,
    recent,
    match,
    matchMany,
    related,
    localRefs,
    async image(mediaId, kind) {
      return store.readAniListImage(mediaId, kind)
    },
  }
}
