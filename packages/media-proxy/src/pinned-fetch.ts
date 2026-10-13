/**
 * El `fetch` del proxy de bytes: conecta a la dirección que se validó.
 *
 * `destination-guard` resuelve el nombre y juzga todas sus respuestas, pero el
 * `fetch` que venía detrás **volvía a resolver**: entre la comprobación y la
 * conexión cabe un DNS que cambie de respuesta, que es el rebinding del riesgo
 * residual 2 de `SECURITY.md`. Aquí el nombre se resuelve **una sola vez**, se
 * juzgan todas sus direcciones y la conexión va a una de ellas, con el nombre en
 * el `Host` y en el SNI, así que el certificado se sigue validando contra el
 * nombre. Es el mismo cierre que la capacidad de red de los plugins
 * (`plugin-fetch.ts`), aplicado a esta ruta.
 *
 * Se apoya en `node:http`/`node:https` con un `lookup` propio en vez de escribir
 * otro cliente HTTP a mano: el `lookup` es justo la costura que la librería
 * estándar ofrece para decidir a qué dirección se conecta un nombre, y el resto
 * —troceado, `content-length`, TLS, cierre— es el de siempre. Medido en Bun
 * 1.4.3 y en Node 26.11.1: el `lookup` se llama **una vez por conexión**, el
 * cuerpo llega por trozos —no se acumula— y `agent: false` impide que una
 * conexión reutilizada de una petición anterior se salte este camino.
 *
 * Lo que **no** hace, y por eso no es un `fetch` cualquiera:
 *
 * - **No sigue redirecciones.** Devuelve el 3xx tal cual, como un `fetch` con
 *   `redirect: 'manual'`. El bucle de saltos, con su revalidación en cada uno,
 *   es el de `fetchAllowed`, que es quien llama a esto.
 * - **No acepta cuerpo de petición.** El proxy pide bytes con `GET`; un cuerpo
 *   que no se sabe enviar se rechaza en vez de perderse en silencio.
 */

import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { LookupFunction } from 'node:net'
import { AppError } from '@nn-anime/core'
import {
  addressRule,
  checkDestination,
  destinationError,
  eximido,
  type Resolver,
  systemResolver,
} from './destination-guard'

/**
 * Lo que este módulo necesita de la respuesta del upstream.
 *
 * Se declara por lo que hace falta —estado, cabeceras, trozos, final— y no
 * copiando `IncomingMessage`: así una prueba puede contestar sin abrir un socket
 * y sin fingir un flujo de Node entero.
 */
export interface UpstreamResponse {
  readonly statusCode: number | undefined
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>
  onData(escucha: (trozo: Uint8Array) => void): void
  onEnd(escucha: () => void): void
  onError(escucha: (causa: Error) => void): void
  destroy(): void
}

/** Lo que este módulo necesita de la petición: fallar, enviarse y cortarse. */
export interface UpstreamRequest {
  onError(escucha: (causa: Error) => void): void
  end(): void
  destroy(): void
}

/** Las opciones con las que se abre la conexión, ya con el `lookup` fijado. */
export interface PinnedRequestOptions {
  readonly protocol: 'http:' | 'https:'
  readonly host: string
  readonly port: number
  readonly path: string
  readonly method: string
  readonly headers: Readonly<Record<string, string>>
  /** El nombre, para el SNI. Sólo viaja en `https`. */
  readonly servername?: string | undefined
  readonly lookup: LookupFunction
}

/** Abre una petición. Se inyecta para poder probar sin abrir un socket. */
export type RequestLike = (
  options: PinnedRequestOptions,
  onResponse: (respuesta: UpstreamResponse) => void,
) => UpstreamRequest

export interface PinnedFetchOptions {
  readonly resolver?: Resolver | undefined
  /** Excepción de loopback del proxy: abre loopback **y** redes privadas. */
  readonly allowLoopback?: boolean | undefined
  readonly requestImpl?: RequestLike | undefined
}

/**
 * La firma que devuelve `createPinnedFetch`.
 *
 * Igual que la de `fetch` pero con el `init` **opcional**: quien la use desde
 * dentro de la aplicación pasa un `init` siempre, y una prueba que sólo quiere
 * pedir una URL no tiene por qué escribir un objeto vacío.
 */
export type PinnedFetch = (input: string, init?: RequestInit) => Promise<Response>

/** El adaptador de un `IncomingMessage` de Node a lo que este módulo pide. */
function adaptarRespuesta(res: IncomingMessage): UpstreamResponse {
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    onData: (escucha) => {
      res.on('data', (trozo: Buffer) => escucha(trozo))
    },
    onEnd: (escucha) => {
      res.once('end', escucha)
    },
    onError: (escucha) => {
      res.once('error', escucha)
      // Un corte a mitad de cuerpo **no** es un final limpio: el cliente pediría
      // los bytes que faltan creyendo que ya está todo. En Node esto llega como
      // `aborted` y no como `error`.
      res.once('aborted', () => {
        escucha(new Error('el upstream cortó la respuesta antes de terminarla'))
      })
    },
    destroy: () => {
      res.destroy()
    },
  }
}

/** El `http.request`/`https.request` de verdad, con la forma estrecha de arriba. */
const requestReal: RequestLike = (options, onResponse) => {
  const comoNodo: RequestOptions = {
    protocol: options.protocol,
    host: options.host,
    port: options.port,
    path: options.path,
    method: options.method,
    headers: { ...options.headers },
    // Sin `keep-alive`: una conexión por petición. Una conexión reutilizada se
    // creó con el `lookup` de otra petición, y este módulo existe para que la
    // conexión sea la que se validó en **esta**.
    agent: false,
    lookup: options.lookup,
    ...(options.servername === undefined ? {} : { servername: options.servername }),
  }

  const peticion =
    options.protocol === 'https:'
      ? httpsRequest(comoNodo, (res) => onResponse(adaptarRespuesta(res)))
      : httpRequest(comoNodo, (res) => onResponse(adaptarRespuesta(res)))

  return {
    onError: (escucha) => {
      peticion.once('error', escucha)
    },
    end: () => {
      peticion.end()
    },
    destroy: () => {
      peticion.destroy()
    },
  }
}

/**
 * El `lookup` que fija la dirección.
 *
 * Node llama a esto **una vez por conexión**, antes de conectar, y lo que
 * devuelva es a donde se conecta. Aquí es donde el nombre se resuelve una sola
 * vez y se juzgan **todas** las respuestas del DNS: un nombre que devuelve una
 * dirección pública y otra interna a la vez no es un destino permitido, es un
 * intento de colarse. Lo que sale de aquí ya está validado, así que no queda una
 * segunda resolución que un DNS hostil pueda cambiar.
 */
function lookupFijado(options: {
  resolver: Resolver
  allowLoopback: boolean | undefined
  url: string
}): LookupFunction {
  return (hostname, _opciones, cb) => {
    void (async () => {
      let direcciones: readonly string[]
      try {
        direcciones = await options.resolver(hostname)
      } catch {
        // Un resolutor que falla es un destino que no se pudo resolver: un error
        // de DNS con su nombre, no la excepción cruda del resolutor ni —peor—
        // una conexión a ciegas.
        cb(destinationError('dns', options.url), [])

        return
      }

      try {
        if (direcciones.length === 0) throw destinationError('dns', options.url)

        for (const direccion of direcciones) {
          const rule = addressRule(direccion)
          if (rule !== undefined && !eximido(rule, { allowLoopback: options.allowLoopback })) {
            throw destinationError(rule, options.url)
          }
        }

        // IPv4 primero, como en la capacidad de los plugins: quedarse con la
        // primera respuesta deja el resultado en manos del orden de un DNS que
        // no controlamos.
        const elegida = direcciones.find((direccion) => !direccion.includes(':')) ?? direcciones[0]
        if (elegida === undefined) throw destinationError('dns', options.url)

        cb(null, [{ address: elegida, family: elegida.includes(':') ? 6 : 4 }])
      } catch (cause) {
        cb(cause instanceof Error ? cause : new Error(String(cause)), [])
      }
    })()
  }
}

/** Las cabeceras que se le pasan a Node, sin importar con qué forma llegaron. */
function normalizarCabeceras(headers: HeadersInit | undefined): Record<string, string> {
  const salida: Record<string, string> = {}
  if (headers === undefined) return salida

  if (headers instanceof Headers) {
    headers.forEach((valor, nombre) => {
      salida[nombre] = valor
    })

    return salida
  }

  if (Array.isArray(headers)) {
    for (const [nombre, valor] of headers) salida[nombre] = valor

    return salida
  }

  for (const [nombre, valor] of Object.entries(headers)) salida[nombre] = valor

  return salida
}

/**
 * Las cabeceras de la respuesta, como `Headers`.
 *
 * `set-cookie` es la única que puede venir repetida, y por eso se añade una a
 * una: un `Headers` construido con un objeto se quedaría con la última. El
 * proxy las descarta después en su lista blanca, pero perder una antes de
 * decidirlo sería perder la información que decide.
 */
function cabecerasDe(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): Headers {
  const salida = new Headers()

  for (const [nombre, valor] of Object.entries(headers)) {
    if (valor === undefined) continue

    if (typeof valor === 'string') {
      salida.append(nombre, valor)
      continue
    }

    for (const uno of valor) salida.append(nombre, uno)
  }

  return salida
}

/** El cuerpo, como flujo: cada trozo se entrega en cuanto llega. */
function cuerpoDe(
  respuesta: UpstreamResponse,
  peticion: UpstreamRequest,
): ReadableStream<Uint8Array> {
  let terminado = false

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const acabar = (): void => {
        if (terminado) return
        terminado = true
        try {
          controller.close()
        } catch {
          // El flujo ya estaba cerrado o cancelado: no hay nada que hacer.
        }
      }

      const fallar = (causa: Error): void => {
        if (terminado) return
        terminado = true
        try {
          controller.error(causa)
        } catch {
          // Ídem: un flujo cancelado no admite más señales.
        }
      }

      respuesta.onData((trozo) => {
        if (terminado) return

        try {
          controller.enqueue(trozo)
        } catch {
          // El lector se fue entre el trozo y esta llamada.
          terminado = true
        }
      })
      respuesta.onEnd(acabar)
      respuesta.onError(fallar)
    },

    // El cliente cortó —cambia de calidad, salta de posición—: se cierra la
    // conexión con el sitio de terceros en vez de dejarla abierta leyendo para
    // nadie.
    cancel() {
      terminado = true
      respuesta.destroy()
      peticion.destroy()
    },
  })
}

/**
 * Un `fetch` que conecta a la dirección validada.
 *
 * Misma forma que el global —ruta y `init`— porque quien lo usa es el bucle de
 * saltos de `fetchAllowed`, que no tiene por qué saber que por debajo hay un
 * `lookup` fijado.
 */
export function createPinnedFetch(options: PinnedFetchOptions = {}): PinnedFetch {
  const requestImpl = options.requestImpl ?? requestReal
  const resolver = options.resolver ?? systemResolver

  return async (input, init = {}) => {
    // La comprobación sin red: esquema y dirección literal. `fetchAllowed` ya
    // pasó por ella, y se repite aquí para que este módulo no dependa de que
    // quien llame se acuerde: falla cerrado.
    const destino = checkDestination(input, { allowLoopback: options.allowLoopback })
    if (!destino.ok) throw destinationError(destino.rule, input)

    if (init.body !== undefined && init.body !== null) {
      throw new AppError({
        code: 'upstream',
        message: 'el proxy no sabe enviar un cuerpo de petición',
        scope: 'media-proxy',
        op: 'proxyBytes',
      })
    }

    const url = destino.url
    const puerto = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port)
    const senal = init.signal ?? undefined

    return await new Promise<Response>((resolve, reject) => {
      let resuelto = false
      const alAbortar = (): void => {
        peticion.destroy()
        if (resuelto) return
        resuelto = true
        reject(new Error('abortado'))
      }

      // El nombre sin corchetes: `[::1]` no es lo que espera `Host` ni el SNI.
      const nombre = url.hostname.replace(/^\[|\]$/g, '')

      const peticion = requestImpl(
        {
          protocol: url.protocol === 'https:' ? 'https:' : 'http:',
          host: nombre,
          port: puerto,
          path: `${url.pathname}${url.search}`,
          method: init.method ?? 'GET',
          headers: normalizarCabeceras(init.headers),
          ...(url.protocol === 'https:' ? { servername: nombre } : {}),
          lookup: lookupFijado({
            resolver,
            allowLoopback: options.allowLoopback,
            url: url.href,
          }),
        },
        (respuesta) => {
          const metodo = init.method ?? 'GET'
          const sinCuerpo =
            metodo === 'HEAD' || respuesta.statusCode === 204 || respuesta.statusCode === 304

          resuelto = true
          resolve(
            new Response(sinCuerpo ? null : cuerpoDe(respuesta, peticion), {
              status: respuesta.statusCode ?? 502,
              headers: cabecerasDe(respuesta.headers),
            }),
          )
        },
      )

      // Un `error` sin escucha en un `ClientRequest` de Node tumba el proceso:
      // se engancha antes de que la petición salga.
      peticion.onError((causa) => {
        if (resuelto) return
        resuelto = true
        reject(causa)
      })

      if (senal?.aborted === true) {
        alAbortar()

        return
      }

      senal?.addEventListener('abort', alAbortar, { once: true })
      peticion.end()
    })
  }
}
