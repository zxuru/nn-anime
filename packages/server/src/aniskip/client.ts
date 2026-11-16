/**
 * El cliente de la API pública de AniSkip v2.
 *
 * Es **otra** salida a la red, y repite las cautelas que el proyecto ya tiene
 * escritas para AniList y GitHub:
 *
 * 1. **Lista blanca de hosts.** Sólo `api.aniskip.com`, y va **dentro** del
 *    `fetch` que `fetchAllowed` usa en cada salto: la comprobación de destinos de
 *    siempre deja pasar cualquier host público, y el host de aquí lo elige este
 *    archivo, no el usuario. Una redirección no esquiva la lista.
 * 2. **Plazo corto.** Tres segundos. Esto no pinta la ficha: rellena unos botones
 *    de la barra de reproducción, y esperar a un tercero lento no puede retrasar
 *    un episodio. Pasado el plazo, quien llama recibe un fallo y sirve una lista
 *    vacía, que es lo mismo que no tener datos.
 * 3. **El estado no basta para decidir.** AniSkip contesta `found:false` —«no hay
 *    saltos»— con HTTP **404** y un cuerpo JSON válido; tratarlo como un fallo de
 *    red cachearía la ausencia de datos con el TTL de error y multiplicaría las
 *    consultas al tercero. Aquí se lee el cuerpo y se reconoce una respuesta de
 *    AniSkip por su forma (`found` booleano); sólo un cuerpo que no sea de
 *    AniSkip —un `400` de validación, el HTML de Cloudflare— es un fallo. La
 *    forma de los intervalos la decide `normalize.ts`, que conoce su vocabulario.
 *
 * El cliente del navegador **no** llama a AniSkip: la lista blanca vive aquí, y
 * una clave por la que el navegador pudiera componer la URL sería justo la
 * superficie que este archivo existe para cerrar.
 */

import { AppError } from '@rona/core'
import { type FetchLike, fetchAllowed, type Resolver } from '@rona/media-proxy'
import { aniskipResponseSchema } from './normalize'

/** El único host de AniSkip. */
export const ANISKIP_HOST = 'api.aniskip.com'
/** Los hosts a los que este módulo puede salir, para la comprobación en cada salto. */
export const ANISKIP_HOSTS: readonly string[] = [ANISKIP_HOST]

export const ANISKIP_ENDPOINT = `https://${ANISKIP_HOST}`

/** Lo que se espera a AniSkip antes de dar la consulta por perdida. */
export const ANISKIP_TIMEOUT_MS = 3000
/** Tope del cuerpo de una respuesta. La lista más grande ronda unos pocos KiB. */
export const MAX_ANISKIP_BYTES = 512 * 1024

/**
 * Los tipos que se piden. Se piden **todos** y se normalizan después: si se
 * pidieran sólo `op` y `ed`, la mitad de los episodios que AniSkip etiqueta con
 * los alias `mixed-*` se quedarían sin botón.
 */
export const ANISKIP_SKIP_TYPES: readonly string[] = ['op', 'ed', 'recap', 'mixed-op', 'mixed-ed']

/**
 * El interruptor del arnés: sin salida a AniSkip.
 *
 * El e2e no puede depender de que un tercero conteste —una prueba que sale a
 * internet es una prueba rota— y el reproductor pide skip-times en cuanto conoce
 * la duración. Con esto puesto, el cliente devuelve el mismo fallo que devolvería
 * un AniSkip caído: la lista sale vacía y la reproducción no cambia de forma.
 *
 * No es una excepción de seguridad —no abre ningún destino, cierra uno— y en un
 * arranque normal no se pone.
 */
export const ANISKIP_OFFLINE_ENV = 'RONA_ANISKIP_OFFLINE'

export function aniskipOfflineFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const valor = env[ANISKIP_OFFLINE_ENV]

  return valor === '1' || valor === 'true'
}

/** Cómo se identifica esta aplicación, como pide la cortesía de la API. */
const USER_AGENT = 'RoNa/0.1 (AniSkip API; UNOFFICIAL)'

/** Lo que hay que pedirle a AniSkip para un episodio. */
export interface AniSkipQuery {
  readonly malId: number
  readonly episode: number
  /**
   * La duración del episodio. **Obligatoria**: AniSkip contesta `400` sin ella.
   *
   * Y no es un filtro de adorno: el endpoint **elige la entrada** cuyo
   * `episodeLength` se parece al pedido, así que dos duraciones del mismo
   * episodio pueden devolver saltos en segundos distintos. Por eso el servicio no
   * consulta sin duración y por eso la duración va en la clave de caché.
   */
  readonly length: number
  readonly signal?: AbortSignal | undefined
}

/** Lo de AniSkip: el JSON ya parseado, o un fallo con su contexto. */
export type AniSkipOutcome =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly error: AppError }

/** Un fallo de este módulo, con su contexto. */
function failure(
  message: string,
  context: Readonly<Record<string, string | number | boolean>>,
  cause?: unknown,
): AppError {
  return new AppError({
    code: 'upstream',
    message,
    scope: 'aniskip',
    op: 'skipTimes',
    context,
    cause,
  })
}

/** ¿Es una dirección de las que este módulo puede pedir? */
export function isAniSkipUrl(raw: string): boolean {
  try {
    return ANISKIP_HOSTS.includes(new URL(raw).hostname.toLowerCase())
  } catch {
    return false
  }
}

/**
 * La URL de un episodio, con sus tipos y su duración.
 *
 * Se compone con `URL` y no a mano para que la codificación de `types[]` sea la
 * del estándar: el `[]` viaja como `%5B%5D`, que es lo mismo para el servidor y
 * no depende de que el tercero acepte corchetes crudos.
 */
export function aniskipUrl(query: Pick<AniSkipQuery, 'malId' | 'episode' | 'length'>): string {
  const url = new URL(
    `/v2/skip-times/${Math.trunc(query.malId)}/${Math.trunc(query.episode)}`,
    ANISKIP_ENDPOINT,
  )

  for (const tipo of ANISKIP_SKIP_TYPES) url.searchParams.append('types[]', tipo)
  // `episodeLength` va siempre: sin él AniSkip contesta 400, y `0` no vale como
  // «no sé la duración» —devuelve una entrada de cada tipo, de cualquier
  // duración—, así que quien no la conozca no debe llegar hasta aquí.
  url.searchParams.set('episodeLength', String(Math.round(query.length)))

  return url.href
}

/**
 * Un `fetch` que **además** comprueba el host en cada salto.
 *
 * Igual que el de AniList y por el mismo motivo: la lista blanca no puede vivir
 * sólo en la primera URL, porque una redirección es la forma más fácil de
 * saltársela.
 */
function guardedFetch(inner: FetchLike): FetchLike {
  return async (input, init) => {
    if (!isAniSkipUrl(input)) {
      throw failure(`destino que no es de AniSkip: ${input}`, { url: input })
    }

    return inner(input, init)
  }
}

export interface AniSkipClientOptions {
  /** Sin salida a la red: el interruptor del arnés. Ver `ANISKIP_OFFLINE_ENV`. */
  readonly offline?: boolean | undefined
  /** `fetch` inyectable: las pruebas no salen a la red. */
  readonly fetchImpl?: FetchLike | undefined
  /** Resolutor inyectable: las pruebas no resuelven nombres de verdad. */
  readonly resolver?: Resolver | undefined
  readonly timeoutMs?: number | undefined
}

export interface AniSkipClient {
  fetch(query: AniSkipQuery): Promise<AniSkipOutcome>
  /** Cuántas peticiones salieron de verdad. */
  calls(): number
}

export function createAniSkipClient(options: AniSkipClientOptions = {}): AniSkipClient {
  const fetchImpl = options.fetchImpl ?? fetch
  const plazo = options.timeoutMs ?? ANISKIP_TIMEOUT_MS

  let salidas = 0

  return {
    async fetch(query: AniSkipQuery): Promise<AniSkipOutcome> {
      if (options.offline === true) {
        return {
          ok: false,
          error: failure('AniSkip está apagado en este arranque', {
            malId: query.malId,
            episode: query.episode,
          }),
        }
      }

      const control = new AbortController()
      const signal =
        query.signal === undefined
          ? control.signal
          : AbortSignal.any([query.signal, control.signal])
      const plazoId = setTimeout(() => control.abort(new Error('plazo agotado')), plazo)

      try {
        salidas += 1

        const response = await fetchAllowed({
          url: aniskipUrl(query),
          headers: {
            accept: 'application/json',
            'user-agent': USER_AGENT,
          },
          signal,
          fetchImpl: guardedFetch(fetchImpl),
          ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
        })

        const texto = await response.text()
        if (texto.length > MAX_ANISKIP_BYTES) {
          return {
            ok: false,
            error: failure('la respuesta de AniSkip pasa del tope', {
              malId: query.malId,
              episode: query.episode,
              bytes: texto.length,
            }),
          }
        }

        let payload: unknown
        let errorJson: unknown
        let esJson = true
        try {
          payload = JSON.parse(texto)
        } catch (cause) {
          esJson = false
          errorJson = cause
        }

        if (!response.ok) {
          // El 404 de AniSkip es el caso mayoritario y significa «no hay datos»:
          // se reconoce por la forma del cuerpo, no por el estado. Un `400` de
          // validación o un HTML del borde de Cloudflare no tienen esta forma y
          // sí son un fallo, que es lo que el TTL de error debe cachear.
          if (esJson && aniskipResponseSchema.safeParse(payload).success) {
            return { ok: true, payload }
          }

          return {
            ok: false,
            error: failure('AniSkip contestó con un error', {
              malId: query.malId,
              episode: query.episode,
              status: response.status,
            }),
          }
        }

        if (!esJson) {
          return {
            ok: false,
            error: failure(
              'la respuesta de AniSkip no es JSON',
              { malId: query.malId, episode: query.episode },
              errorJson,
            ),
          }
        }

        return { ok: true, payload }
      } catch (cause) {
        // Un fallo que ya viene con nombre —el del guardián de destinos, sin ir
        // más lejos— se cuenta tal cual: envolverlo en «no se pudo hablar»
        // esconde justo el motivo que hace falta para arreglarlo.
        if (cause instanceof AppError) return { ok: false, error: cause }

        return {
          ok: false,
          error: failure(
            control.signal.aborted
              ? 'AniSkip no contestó a tiempo'
              : 'no se pudo hablar con AniSkip',
            { malId: query.malId, episode: query.episode },
            cause,
          ),
        }
      } finally {
        clearTimeout(plazoId)
      }
    },

    calls(): number {
      return salidas
    },
  }
}
