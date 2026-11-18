/**
 * El cliente de la API pública de AniList.
 *
 * Es el **cuarto** camino que sale a la red —después de la capacidad de red de
 * los plugins, el proxy de bytes y la descarga de repositorios— y por eso repite
 * las tres cautelas que el proyecto ya tiene escritas para los otros:
 *
 * 1. **Lista blanca de hosts.** Sólo `graphql.anilist.co` para la API y
 *    `s4.anilist.co`/`img.anilist.co` para las imágenes. La lista blanca va
 *    **dentro** de `fetchAllowed`, en cada salto, para que una redirección no la
 *    esquive: la comprobación de destinos de siempre deja pasar cualquier host
 *    público, y el host de aquí lo elige este archivo, no el usuario.
 * 2. **Presupuesto de peticiones.** AniList limita a 90 por minuto —hoy degradado
 *    a 30—, así que el ritmo sostenido es una cada dos segundos: entra en el peor
 *    de los dos casos y su propio limitador admite ráfagas. La primera carga no
 *    puede esperar y por eso hay una **ráfaga de tres** —las tres filas de la
 *    home—: salen sin esperar y cada crédito se repone a una cada dos segundos,
 *    con lo que no hay más de tres salidas sin turno y un cuarto espera el suyo.
 *    Un 429 se obedece leyendo `Retry-After`, y no se reintenta más de una vez:
 *    insistir es lo que convierte una espera en un bloqueo.
 * 3. **Tiempo límite y validación.** Cada consulta tiene plazo, y la respuesta se
 *    valida con un schema **de quien llama**: un campo de menos es un error, no un
 *    dato a medias.
 *
 * Y una regla de los términos de uso, escrita donde se cumple: esto no es un
 * espejo. La caché vive fuera —`catalog-store`— y este archivo no guarda nada; lo
 * que hace es no repetir una consulta que ya se hizo.
 */

import { AppError } from '@rona/core'
import { createPinnedFetch, type FetchLike, fetchAllowed, type Resolver } from '@rona/media-proxy'
import { z } from 'zod'

/** El único host de la API. */
export const ANILIST_API_HOST = 'graphql.anilist.co'
/** Los hosts desde los que AniList sirve sus imágenes. */
export const ANILIST_IMAGE_HOSTS: readonly string[] = ['s4.anilist.co', 'img.anilist.co']
/** Los hosts a los que este módulo puede salir, para la comprobación en cada salto. */
export const ANILIST_HOSTS: readonly string[] = [ANILIST_API_HOST, ...ANILIST_IMAGE_HOSTS]

export const ANILIST_ENDPOINT = `https://${ANILIST_API_HOST}`

/**
 * Cuánto tarda en reponerse un crédito de la ráfaga.
 *
 * El límite publicado es 90 al minuto, hoy degradado a 30, así que una cada dos
 * segundos es el ritmo sostenido que entra en el peor de los dos casos con el
 * margen que necesita su limitador de ráfagas. Es un presupuesto, no una
 * optimización: la caché hace que en régimen normal no haya ni una petición por
 * carga de la home.
 */
export const ANILIST_MIN_INTERVAL_MS = 2000
/**
 * Las peticiones que pueden salir a la vez al empezar.
 *
 * Tres es lo que pide la home de golpe —top, parrilla y novedades— y el mayor
 * número que no cambia el presupuesto: la ráfaga se gasta **una vez** y cada
 * crédito tarda dos segundos en volver, así que el ritmo sostenido sigue siendo
 * 30 al minuto. El primer minuto puede llevar 33 —las tres de la ráfaga y las
 * treinta del ritmo—, que es la ráfaga que admite el limitador de AniList y
 * queda muy por debajo de sus 90 publicados; a partir del segundo minuto la
 * cuenta es la del modo degradado. Sin la ráfaga esas tres filas se turnan y la
 * primera carga pasa de cuatro segundos; con cuatro o más, deja de ser una
 * primera carga y se convierte en un paralelismo que el ritmo sostenido no
 * justifica.
 */
export const ANILIST_BURST = 3
/** Lo que se espera a AniList antes de dar la consulta por perdida. */
export const ANILIST_TIMEOUT_MS = 10_000
/** Tope del cuerpo de una respuesta. La consulta más grande no llega a tanto. */
export const MAX_ANILIST_BYTES = 2 * 1024 * 1024
/** Lo máximo que se obedece un `Retry-After`, por si el de enfrente se equivoca. */
export const MAX_RETRY_AFTER_MS = 60_000

/**
 * El interruptor del arnés: sin salida a AniList.
 *
 * El e2e no puede depender de que un tercero conteste —una prueba que sale a
 * internet es una prueba rota—, y la home **siempre** pide el descubrimiento, así
 * que apagarlo es la única forma de que el arnés no salga a la red sin que la
 * aplicación cambie de forma. Con esto puesto, el cliente devuelve el mismo error
 * que devolvería un AniList caído: las filas vuelven a lo de la fuente y la
 * parrilla se explica, que es justo el camino que hay que poder probar.
 *
 * No es una excepción de seguridad —no abre ningún destino, cierra uno— y en un
 * arranque normal no se pone.
 */
export const ANILIST_OFFLINE_ENV = 'RONA_ANILIST_OFFLINE'

export function anilistOfflineFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const valor = env[ANILIST_OFFLINE_ENV]

  return valor === '1' || valor === 'true'
}

/** Cómo se identifica esta aplicación, como pide la cortesía de la API. */
const USER_AGENT = 'RoNa/0.1 (AniList API; UNOFFICIAL)'

/** El sobre de GraphQL, validado antes de mirar los datos. */
const envelopeSchema = z.object({
  data: z.unknown().optional(),
  errors: z
    .array(
      z.object({
        message: z.string(),
        status: z.number().int().optional(),
      }),
    )
    .optional(),
})

export interface AniListQuery<T> {
  /**
   * La clave de la consulta.
   *
   * Va en el error y la usa la caché de quien llama; aquí no deduplica nada.
   */
  readonly key: string
  readonly query: string
  readonly variables: Readonly<Record<string, unknown>>
  /** El schema de `data`: lo valida quien conoce la forma que pidió. */
  readonly schema: z.ZodType<T>
  readonly signal?: AbortSignal | undefined
}

export type AniListOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: AppError }

export interface AniListClientOptions {
  /** Sin salida a la red: el interruptor del arnés. Ver `ANILIST_OFFLINE_ENV`. */
  readonly offline?: boolean | undefined
  /** `fetch` inyectable: las pruebas no salen a la red. */
  readonly fetchImpl?: FetchLike | undefined
  /** Resolutor inyectable: las pruebas no resuelven nombres de verdad. */
  readonly resolver?: Resolver | undefined
  /** Reloj inyectable, para medir el espaciado sin esperar. */
  readonly now?: (() => number) | undefined
  /** La espera inyectable, por el mismo motivo. */
  readonly sleep?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined
  readonly minIntervalMs?: number | undefined
  /**
   * Las peticiones que pueden salir a la vez al empezar. `1` deja el turno de
   * siempre; ver `ANILIST_BURST`.
   */
  readonly burst?: number | undefined
  readonly timeoutMs?: number | undefined
}

export interface AniListClient {
  query<T>(request: AniListQuery<T>): Promise<AniListOutcome<T>>
  /** Cuántas peticiones salieron de verdad. Lo mide el presupuesto. */
  calls(): number
}

/** Un fallo de este módulo, con su contexto. */
function failure(
  message: string,
  context: Readonly<Record<string, string | number | boolean>>,
  cause?: unknown,
): AppError {
  return new AppError({
    code: 'upstream',
    message,
    scope: 'anilist',
    op: 'query',
    context,
    cause,
  })
}

/** ¿Es una dirección de las que este módulo puede pedir? */
export function isAniListUrl(raw: string): boolean {
  try {
    return ANILIST_HOSTS.includes(new URL(raw).hostname.toLowerCase())
  } catch {
    return false
  }
}

/** La espera de verdad, que se corta si quien pidió se va. */
function realSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolver, rechazar) => {
    if (signal?.aborted === true) {
      rechazar(signal.reason instanceof Error ? signal.reason : new Error('abortado'))
      return
    }

    const temporizador = setTimeout(() => {
      signal?.removeEventListener('abort', alAbortar)
      resolver()
    }, ms)

    function alAbortar(): void {
      clearTimeout(temporizador)
      rechazar(signal?.reason instanceof Error ? signal.reason : new Error('abortado'))
    }

    signal?.addEventListener('abort', alAbortar, { once: true })
  })
}

/**
 * Un `fetch` que **además** comprueba el host en cada salto.
 *
 * Igual que el de GitHub y por el mismo motivo: la lista blanca no puede vivir
 * sólo en la primera URL, porque una redirección es la forma más fácil de
 * saltársela.
 */
function guardedFetch(inner: FetchLike): FetchLike {
  return async (input, init) => {
    if (!isAniListUrl(input)) {
      throw failure(`destino que no es de AniList: ${input}`, { url: input })
    }

    return inner(input, init)
  }
}

/** Los segundos que pide esperar un 429, con tope. */
export function retryAfterMs(header: string | null): number | undefined {
  if (header === null) return undefined

  const segundos = Number.parseInt(header, 10)
  if (!Number.isFinite(segundos) || segundos <= 0) return undefined

  return Math.min(segundos * 1000, MAX_RETRY_AFTER_MS)
}

export function createAniListClient(options: AniListClientOptions = {}): AniListClient {
  const fetchImpl =
    options.fetchImpl ??
    createPinnedFetch({
      ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
    })
  const ahora = options.now ?? Date.now
  const dormir = options.sleep ?? realSleep
  const intervalo = options.minIntervalMs ?? ANILIST_MIN_INTERVAL_MS
  const plazo = options.timeoutMs ?? ANILIST_TIMEOUT_MS
  // Una ráfaga de una petición es el turno de siempre y nunca se apaga del todo:
  // con cero créditos, la primera consulta esperaría un intervalo que no toca.
  const capacidad = Math.max(1, Math.floor(options.burst ?? ANILIST_BURST))

  let salidas = 0
  // El cupo de la ráfaga: se empieza con todos los créditos y cada petición gasta
  // uno; el tiempo repone uno cada intervalo. Con capacidad 3, tres consultas
  // simultáneas salen a la vez y la cuarta espera dos segundos como mucho.
  let creditos = capacidad
  let ultimaRecarga = ahora()

  // Las reservas van en fila: cada una decide su espera con la anterior ya
  // contada. Lo que **no** va aquí dentro es la petición HTTP, y eso es lo que
  // deja volar la ráfaga sin que dos consultas se pisen el turno.
  let cola: Promise<unknown> = Promise.resolve()

  const enTurno = <T>(tarea: () => Promise<T>): Promise<T> => {
    const resultado = cola.then(tarea, tarea)
    // La cola no se rompe porque una consulta falle: la siguiente espera a que
    // ésta termine, no a que salga bien.
    cola = resultado.then(
      () => undefined,
      () => undefined,
    )

    return resultado
  }

  /**
   * La espera hasta que toque salir, con el crédito ya descontado.
   *
   * Es la única parte serial: sin crédito se espera lo que falta para el
   * siguiente —con el mismo reloj que el presupuesto— y el cupo queda a cero. Al
   * despertar, el turno sigue siendo suyo porque nadie más ha podido reservar.
   */
  const reservar = async (signal: AbortSignal): Promise<void> => {
    const momento = ahora()
    const transcurrido = momento - ultimaRecarga
    if (transcurrido > 0) {
      creditos = Math.min(capacidad, creditos + transcurrido / intervalo)
      ultimaRecarga = momento
    }

    if (creditos < 1) {
      await dormir((1 - creditos) * intervalo, signal)
      creditos = 0
      ultimaRecarga = ahora()
    } else {
      creditos -= 1
    }

    salidas += 1
  }

  /** Una petición HTTP, con su 429 y su validación. */
  async function enviar<T>(
    request: AniListQuery<T>,
    retryAfter: number | undefined,
  ): Promise<AniListOutcome<T>> {
    const control = new AbortController()
    const signal =
      request.signal === undefined
        ? control.signal
        : AbortSignal.any([request.signal, control.signal])
    const plazoId = setTimeout(() => control.abort(new Error('plazo agotado')), plazo)

    try {
      // El turno sólo cubre la espera; el HTTP va fuera para que la ráfaga vuele
      // a la vez.
      await enTurno(() => reservar(signal))

      const response = await fetchAllowed({
        url: ANILIST_ENDPOINT,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({ query: request.query, variables: request.variables }),
        signal,
        fetchImpl: guardedFetch(fetchImpl),
        ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
      })

      if (response.status === 429) {
        const espera = retryAfterMs(response.headers.get('retry-after'))
        if (retryAfter === undefined && espera !== undefined) {
          // Un reintento, y con lo que dijo el servidor. Insistir no es esperar.
          await dormir(espera, request.signal)
          return enviar(request, espera)
        }

        return {
          ok: false,
          error: failure('AniList pidió esperar y sigue limitando', {
            key: request.key,
            status: response.status,
            ...(espera === undefined ? {} : { retryAfterMs: espera }),
          }),
        }
      }

      const texto = await response.text()
      if (texto.length > MAX_ANILIST_BYTES) {
        return {
          ok: false,
          error: failure('la respuesta de AniList pasa del tope', {
            key: request.key,
            bytes: texto.length,
          }),
        }
      }

      if (!response.ok) {
        return {
          ok: false,
          error: failure('AniList contestó con un error', {
            key: request.key,
            status: response.status,
          }),
        }
      }

      let crudo: unknown
      try {
        crudo = JSON.parse(texto)
      } catch (cause) {
        return {
          ok: false,
          error: failure('la respuesta de AniList no es JSON', { key: request.key }, cause),
        }
      }

      const sobre = envelopeSchema.safeParse(crudo)
      if (!sobre.success) {
        return {
          ok: false,
          error: failure('la respuesta de AniList no tiene la forma esperada', {
            key: request.key,
          }),
        }
      }

      if (sobre.data.errors !== undefined && sobre.data.errors.length > 0) {
        return {
          ok: false,
          error: failure(`AniList devolvió un error: ${sobre.data.errors[0]?.message ?? ''}`, {
            key: request.key,
            errores: sobre.data.errors.length,
          }),
        }
      }

      const datos = request.schema.safeParse(sobre.data.data)
      if (!datos.success) {
        return {
          ok: false,
          error: failure('los datos de AniList no tienen la forma esperada', {
            key: request.key,
          }),
        }
      }

      return { ok: true, value: datos.data }
    } catch (cause) {
      // Un fallo que ya viene con nombre —el del guardián de destinos, sin ir más
      // lejos— se cuenta tal cual: envolverlo en «no se pudo hablar» esconde
      // justo el motivo que hace falta para arreglarlo.
      if (cause instanceof AppError) return { ok: false, error: cause }

      return {
        ok: false,
        error: failure('no se pudo hablar con AniList', { key: request.key }, cause),
      }
    } finally {
      clearTimeout(plazoId)
    }
  }

  return {
    query<T>(request: AniListQuery<T>): Promise<AniListOutcome<T>> {
      if (options.offline === true) {
        return Promise.resolve({
          ok: false,
          error: failure('AniList está apagado en este arranque', { key: request.key }),
        })
      }

      // El turno lo toma `enviar` al reservar: envolverlo aquí otra vez sería
      // esperarse a sí mismo.
      return enviar(request, undefined)
    },

    calls(): number {
      return salidas
    },
  }
}
