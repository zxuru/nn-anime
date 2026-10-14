/**
 * La capacidad de red que se le da a un plugin.
 *
 * Un plugin sale a la red por aquí, y no por el `fetch` global. Eso compra tres
 * cosas que un `fetch` no puede dar:
 *
 * 1. **Se conecta a la dirección que validó.** `checkResolvedDestination()` mira
 *    las direcciones resueltas, pero el `fetch` que viene detrás **vuelve a
 *    resolver**: entre la comprobación y la conexión cabe un DNS que cambie de
 *    respuesta (rebinding). Aquí el nombre se resuelve **una vez**, se juzgan
 *    todas sus direcciones y la conexión va a una de ellas, con el nombre en el
 *    SNI, así que el certificado se sigue validando contra el nombre. Es el
 *    riesgo residual 2 de `SECURITY.md`, cerrado en esta ruta.
 * 2. **El cuerpo tiene tope por bytes descomprimidos.** Un `content-length` de
 *    cien bytes puede descomprimir a gigabytes; `maxOutputLength` corta la
 *    descompresión sin llegar a asignar la memoria.
 * 3. **Las redirecciones se siguen a mano**, revalidando cada salto, y una
 *    credencial del plugin no cruza a otro origen.
 *
 * Lo que **no** hace: aislar al plugin. Sigue corriendo en este proceso y con
 * estos permisos; esto acota a dónde sale, no lo que puede hacer dentro. Ese es
 * el riesgo residual 1, que no se cierra con código de red.
 *
 * El cliente se escribe a mano sobre `node:net`/`node:tls` porque conectar a una
 * dirección concreta es justo lo que un `fetch` no deja hacer: `undici` no está
 * en el árbol, y meterlo sería una dependencia nueva para lo que aquí son unas
 * ciento cincuenta líneas de HTTP/1.1. `Connection: close`, sin `keep-alive`:
 * una petición por conexión, menos estado y menos sorpresas.
 */

import { connect as connectTcp, type Socket } from 'node:net'
import { connect as connectTls, type TLSSocket } from 'node:tls'
import {
  brotliDecompressSync,
  gunzipSync,
  inflateRawSync,
  inflateSync,
  constants as zlibConstants,
} from 'node:zlib'
import {
  AppError,
  type PluginFetch,
  type PluginFetchCall,
  type PluginFetchFactory,
  type PluginRequest,
  type PluginResponse,
} from '@nn-anime/core'
import {
  addressRule,
  allowLoopbackFromEnv,
  checkDestination,
  type DestinationRule,
  destinationError,
  MAX_REDIRECTS,
  type Resolver,
  systemResolver,
} from './destination-guard'

/*
 * `PluginRequest`, `PluginResponse` y `PluginFetch` no se declaran aquí: viven en
 * `core`, que es lo que comparten este paquete y el SDK. Una segunda declaración
 * sería una segunda forma del mismo contrato, y dos formas divergen.
 */

/** Tope por defecto del cuerpo, contado ya descomprimido. */
export const MAX_BODY_BYTES = 8 * 1024 * 1024

/** Plazo por defecto de una llamada, saltos incluidos. */
export const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Cabeceras que un plugin puede poner.
 *
 * `host`, `connection`, `content-length` y `transfer-encoding` no están: los pone
 * este módulo, y dejar que un plugin los elija es dejarle elegir a qué máquina se
 * conecta o cuánto dice medir su cuerpo.
 */
const ALLOWED_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  'accept',
  'accept-language',
  'content-type',
  'cookie',
  'origin',
  'range',
  'referer',
  'user-agent',
])

/** Cabeceras de la respuesta que llegan al plugin. `set-cookie` va aparte. */
const ALLOWED_RESPONSE_HEADERS: readonly string[] = [
  'cache-control',
  'content-type',
  'etag',
  'last-modified',
  'retry-after',
]

/** Credenciales que no cruzan a otro origen. */
const CREDENTIAL_HEADERS: readonly string[] = ['cookie', 'authorization', 'proxy-authorization']

const HEADER_NAME_RE = /^[A-Za-z0-9-]+$/

/**
 * ¿Hay algún carácter de control, incluidos `\r` y `\n`?
 *
 * Se comparan puntos de código y no una expresión regular: una clase con
 * `\u0000-\u001f` dentro es exactamente esto, pero escrita de forma que el
 * analizador la lee como caracteres de control sueltos en el código fuente y la
 * marca. Aquí el rango se ve en los números, que es donde se puede revisar.
 */
function hasControlChars(value: string): boolean {
  for (const caracter of value) {
    const punto = caracter.codePointAt(0) ?? 0
    if (punto <= 0x1f || punto === 0x7f) return true
  }

  return false
}

/** Cómo se llega a un destino ya validado. */
export interface ConnectTarget {
  readonly address: string
  readonly port: number
  /** El nombre, para el SNI y para validar el certificado. */
  readonly servername: string
  readonly tls: boolean
  readonly signal: AbortSignal
}

/** Una conexión abierta, vista como lo que este módulo necesita de ella. */
export interface PluginTransport {
  write(data: string): void
  end(): void
  destroy(): void
  onData(cb: (chunk: Buffer) => void): void
  onEnd(cb: () => void): void
  onError(cb: (cause: Error) => void): void
}

export type Connector = (target: ConnectTarget) => Promise<PluginTransport>

export interface PluginFetchOptions {
  /**
   * Excepción de red interna. Sale de `ALLOW_LOOPBACK_ENV` y nunca está puesta
   * por defecto; el arranque la anuncia en el registro. Ver `SECURITY.md`,
   * riesgo residual 5.
   */
  readonly allowLoopback?: boolean | undefined
  /** Resolutor, inyectable para las pruebas. */
  readonly resolver?: Resolver | undefined
  /** Cómo se conecta, inyectable para las pruebas. */
  readonly connector?: Connector | undefined
  readonly maxRedirects?: number | undefined
  readonly maxBytes?: number | undefined
  readonly timeoutMs?: number | undefined
  readonly signal?: AbortSignal | undefined
}

/** Una respuesta cruda, ya leída y sin descomprimir. */
interface RawResponse {
  readonly status: number
  readonly headers: readonly (readonly [string, string])[]
  readonly body: Buffer
}

function networkError(host: string, reason: string): AppError {
  return new AppError({
    code: 'upstream',
    message: `la petición del plugin no llegó: ${reason}`,
    // El host sí, la dirección completa no: una URL de un proveedor puede llevar
    // tokens dentro y esto acaba en un registro.
    context: { host },
    scope: 'media-proxy',
    op: 'pluginFetch',
  })
}

function timeoutError(host: string, ms: number): AppError {
  return new AppError({
    code: 'upstream',
    message: `la petición del plugin no terminó en ${ms} ms`,
    context: { host },
    scope: 'media-proxy',
    op: 'pluginFetch',
  })
}

/**
 * ¿La excepción cubre esta regla?
 *
 * **Sólo `loopback`**, al revés que la del proxy, que también abre redes privadas
 * porque el arnés de pruebas lo necesita. Un sitio de prueba en la propia máquina
 * vive en `127.0.0.1`, en `[::1]` o en un nombre que resuelve ahí; una red
 * privada no es un caso de prueba de nadie, y link-local o la metadata de nube no
 * se eximen ni con la variable puesta.
 */
function exentoDeLoopback(rule: DestinationRule, exento: boolean): boolean {
  return exento && rule === 'loopback'
}

/**
 * Lo que este módulo necesita de un socket.
 *
 * Se declara por lo que hace falta —conectar, fallar, recibir, cerrarse— y no
 * copiando la API del socket: los eventos de `node:net` y `node:tls` están
 * sobrecargados por nombre de evento, y una costura que los imite obliga a
 * conversiones de tipo en cada llamada. Así, además, una prueba puede decir qué
 * le pasa al conector sin saber qué es `secureConnect`.
 */
export interface SocketLike {
  setNoDelay(activado: boolean): unknown
  /** La conexión está lista: `secureConnect` en TLS, `connect` en TCP. */
  alConectar(escucha: () => void): unknown
  alFallar(escucha: (causa: Error) => void): unknown
  alRecibirDatos(escucha: (dato: Buffer) => void): unknown
  /** Cierre ordenado, o corte del otro lado. */
  alCerrar(escucha: () => void): unknown
  write(datos: string): unknown
  end(): unknown
  destroy(): unknown
}

/** Lo que este módulo necesita de `tls.connect` y de `net.connect`. */
export type ConnectLike = (options: {
  readonly host: string
  readonly port: number
  readonly servername?: string
  readonly rejectUnauthorized?: boolean
}) => SocketLike

/** Un socket de Node, visto como lo que este módulo necesita de él. */
function socketDe(
  socket: TLSSocket | Socket,
  eventoDeConexion: 'secureConnect' | 'connect',
): SocketLike {
  return {
    setNoDelay: (activado) => void socket.setNoDelay(activado),
    alConectar: (escucha) => void socket.once(eventoDeConexion, escucha),
    alFallar: (escucha) => void socket.once('error', escucha),
    alRecibirDatos: (escucha) => void socket.on('data', escucha),
    alCerrar: (escucha) => {
      socket.once('end', escucha)
      socket.once('close', escucha)
    },
    write: (datos) => void socket.write(datos),
    end: () => void socket.end(),
    destroy: () => void socket.destroy(),
  }
}

/**
 * El conector: `node:tls` para https, `node:net` para http.
 *
 * Las dos funciones de conexión se inyectan para poder comprobar —sin abrir un
 * socket— que a TLS se le pasa el nombre en `servername` y la verificación del
 * certificado encendida. Es la otra mitad del cierre del riesgo residual 2: la
 * conexión va a la **dirección validada**, y el certificado se sigue validando
 * contra el **nombre**.
 */
export function connectorCon(conectarTls: ConnectLike, conectarTcp: ConnectLike): Connector {
  return async (target) => {
    const socket = target.tls
      ? conectarTls({
          host: target.address,
          port: target.port,
          servername: target.servername,
          rejectUnauthorized: true,
        })
      : conectarTcp({ host: target.address, port: target.port })

    // Una petición pequeña no debe esperar a que se junte otra: sin esto, Nagle
    // añade decenas de milisegundos por salto.
    socket.setNoDelay(true)

    await new Promise<void>((resolve, reject) => {
      socket.alConectar(() => resolve())
      socket.alFallar((causa) => reject(causa))

      const alAbortar = (): void => {
        socket.destroy()
        reject(new Error('abortado'))
      }

      if (target.signal.aborted) {
        alAbortar()
        return
      }

      target.signal.addEventListener('abort', alAbortar, { once: true })
    })

    return {
      write: (data) => void socket.write(data),
      end: () => void socket.end(),
      destroy: () => socket.destroy(),
      onData: (cb) => void socket.alRecibirDatos(cb),
      onEnd: (cb) => void socket.alCerrar(cb),
      onError: (cb) => void socket.alFallar(cb),
    }
  }
}

/**
 * El conector del motor, con las funciones de verdad.
 *
 * Van envueltas porque `tls.connect` y `net.connect` están sobrecargadas
 * —admiten `(puerto, host, opciones…)`— y su conjunto de firmas no encaja en el
 * tipo estrecho que este módulo pide.
 */
export const systemConnector: Connector = connectorCon(
  (options) => socketDe(connectTls(options), 'secureConnect'),
  (options) => socketDe(connectTcp(options), 'connect'),
)

/**
 * Resuelve el nombre **una vez** y devuelve la dirección a la que hay que
 * conectarse, ya validada.
 *
 * Todas las respuestas del DNS se juzgan: un nombre que devuelve una dirección
 * pública y otra interna a la vez no es un destino permitido, es un intento de
 * colarse. La dirección que sale de aquí es la que se usa para conectar, así que
 * no hay una segunda resolución que un DNS hostil pueda cambiar.
 */
async function resolvePinned(
  url: URL,
  options: { resolver: Resolver; exento: boolean },
): Promise<string> {
  const host = url.hostname.replace(/^\[|\]$/g, '')

  // Una dirección literal no se resuelve: se juzga tal cual, y de eso ya se
  // encargó `checkDestination`.
  if (/^[\d.]+$/.test(host) || host.includes(':')) return host

  let direcciones: readonly string[]
  try {
    direcciones = await options.resolver(host)
  } catch {
    throw destinationError('dns', url.href)
  }

  if (direcciones.length === 0) throw destinationError('dns', url.href)

  for (const direccion of direcciones) {
    const rule = addressRule(direccion)
    if (rule !== undefined && !exentoDeLoopback(rule, options.exento)) {
      throw destinationError(rule, url.href)
    }
  }

  // IPv4 primero: hay sitios cuyo IPv6 está peor servido, y quedarse con el
  // primero que devuelva el DNS deja el resultado en manos del orden de una
  // respuesta que no controlamos.
  const elegida = direcciones.find((direccion) => !direccion.includes(':')) ?? direcciones[0]

  if (elegida === undefined) throw destinationError('dns', url.href)

  return elegida
}

/** El bloque de cabeceras, si ya llegó entero. */
function parseHeaders(
  raw: Buffer,
): { status: number; headers: [string, string][]; rest: Buffer } | undefined {
  const fin = raw.indexOf('\r\n\r\n')
  if (fin < 0) return undefined

  const lineas = raw.subarray(0, fin).toString('latin1').split('\r\n')
  const estado = /^HTTP\/1\.[01] (\d{3})/.exec(lineas[0] ?? '')
  if (estado === null) throw new Error('la respuesta no empieza por una línea de estado')

  const headers: [string, string][] = []
  for (const linea of lineas.slice(1)) {
    const corte = linea.indexOf(':')
    if (corte <= 0) continue

    headers.push([linea.slice(0, corte).trim().toLowerCase(), linea.slice(corte + 1).trim()])
  }

  return { status: Number(estado[1]), headers, rest: raw.subarray(fin + 4) }
}

function headerValue(
  headers: readonly (readonly [string, string])[],
  name: string,
): string | undefined {
  return headers.find(([clave]) => clave === name)?.[1]
}

/**
 * Escribe la petición y lee la respuesta entera.
 *
 * Se lee por trozos porque un cuerpo no llega de una vez, y el tope se aplica
 * sobre lo que llega de verdad, no sobre lo que el servidor dice que va a mandar.
 */
async function readResponse(
  transporte: PluginTransport,
  options: { request: string; maxBytes: number; method: string; host: string },
): Promise<RawResponse> {
  return await new Promise<RawResponse>((resolve, reject) => {
    let buffer: Buffer = Buffer.alloc(0)
    let cabeceras: { status: number; headers: [string, string][] } | undefined
    const cuerpo: Buffer[] = []
    let tamanoCuerpo = 0
    let restante: number | undefined
    let troceado = false
    let terminado = false

    const fallar = (cause: Error): void => {
      if (terminado) return
      terminado = true
      reject(cause)
    }

    const acabar = (): void => {
      if (terminado) return

      // La conexión se cerró sin una respuesta completa —un servidor que corta
      // antes de contestar, o que sólo manda un `1xx`—: sin esto la promesa no se
      // resuelve ni se rechaza, así que la petición del plugin se queda colgada
      // para siempre. El plazo tampoco la salva: destruir un socket que ya se cerró
      // no emite nada, y el vigilante se queda esperando lo que no va a llegar.
      if (cabeceras === undefined) {
        fallar(new Error('el servidor cerró la conexión sin contestar'))
        return
      }

      terminado = true
      resolve({ status: cabeceras.status, headers: cabeceras.headers, body: Buffer.concat(cuerpo) })
    }

    const guardar = (trozo: Buffer): void => {
      tamanoCuerpo += trozo.byteLength
      if (tamanoCuerpo > options.maxBytes) {
        throw new Error(`la respuesta pasa de ${options.maxBytes} bytes y se corta`)
      }

      cuerpo.push(trozo)
    }

    const consumirCuerpo = (): void => {
      if (terminado) return

      // Sin cuerpo por definición: una respuesta a HEAD, o un 204/304.
      if (options.method === 'HEAD' || cabeceras?.status === 204 || cabeceras?.status === 304) {
        acabar()
        return
      }

      if (troceado) {
        for (;;) {
          const finLinea = buffer.indexOf('\r\n')
          if (finLinea < 0) return

          const declarado = buffer.subarray(0, finLinea).toString('latin1').split(';')[0] ?? ''
          const tamano = Number.parseInt(declarado, 16)
          if (!Number.isInteger(tamano) || tamano < 0) {
            fallar(new Error('un trozo de la respuesta no dice cuánto mide'))
            return
          }

          if (tamano === 0) {
            acabar()
            return
          }

          const inicio = finLinea + 2
          const finDatos = inicio + tamano
          if (buffer.length < finDatos + 2) return

          guardar(buffer.subarray(inicio, finDatos))
          buffer = buffer.subarray(finDatos + 2)
        }
      }

      if (restante !== undefined) {
        const trozo = buffer.subarray(0, Math.min(restante, buffer.length))
        if (trozo.byteLength > 0) {
          guardar(Buffer.from(trozo))
          restante -= trozo.byteLength
          buffer = buffer.subarray(trozo.byteLength)
        }

        if (restante === 0) acabar()
        return
      }

      // Sin `content-length` ni troceado, el cuerpo termina cuando el servidor
      // cierra; de eso avisa `onEnd`.
      if (buffer.byteLength > 0) {
        guardar(buffer)
        buffer = Buffer.alloc(0)
      }
    }

    const intentar = (): void => {
      if (terminado) return

      try {
        while (cabeceras === undefined) {
          const parseadas = parseHeaders(buffer)
          if (parseadas === undefined) return

          // Un 1xx es un aviso, no la respuesta: se descarta y se sigue.
          if (parseadas.status >= 100 && parseadas.status < 200) {
            buffer = parseadas.rest
            continue
          }

          cabeceras = { status: parseadas.status, headers: parseadas.headers }
          buffer = parseadas.rest
        }

        if (restante === undefined && !troceado) {
          const transfer = headerValue(cabeceras.headers, 'transfer-encoding')?.toLowerCase() ?? ''
          const largo = headerValue(cabeceras.headers, 'content-length')

          if (transfer.includes('chunked')) troceado = true
          else if (largo !== undefined) {
            const numero = Number(largo)
            if (!Number.isInteger(numero) || numero < 0) {
              fallar(new Error('la respuesta declara un cuerpo que no es un número'))
              return
            }

            restante = numero
          }
        }

        consumirCuerpo()
      } catch (cause) {
        fallar(cause instanceof Error ? cause : new Error(String(cause)))
      }
    }

    transporte.onData((trozo) => {
      buffer = Buffer.concat([buffer, trozo])
      intentar()
    })

    transporte.onEnd(() => {
      if (terminado) return

      // Con `content-length` a medias, la respuesta llegó cortada: eso es un
      // fallo, no un cuerpo más corto.
      if (restante !== undefined && restante > 0) fallar(new Error('la respuesta llegó cortada'))
      else acabar()
    })

    transporte.onError((cause) => fallar(cause))

    // La petición se escribe al final de montar la lectura: si el servidor
    // contestara antes de que haya quien escuche, el trozo se perdería. Y se
    // escribe **sin medio cierre**: `end()` manda un FIN justo detrás de la
    // petición y hay servidores que lo leen como un corte y cierran sin contestar
    // nada —medido contra Cloudflare: con `end()`, cero bytes; sin él, la respuesta
    // entera—. `Connection: close` ya pide al servidor que cierre cuando termine, y
    // el socket se destruye en cuanto la respuesta está leída.
    transporte.write(options.request)
  })
}

/** Descomprime el cuerpo, cortando si el resultado pasa del tope. */
function decompress(raw: Buffer, encoding: string, maxBytes: number, host: string): Buffer {
  const tipo = encoding.split(',').at(-1)?.trim().toLowerCase() ?? ''
  if (tipo === '' || tipo === 'identity') return raw

  const corta = (cause: unknown): never => {
    const codigo = (cause as { code?: string }).code
    if (codigo === 'ERR_BUFFER_TOO_LARGE') {
      throw networkError(host, `el cuerpo descomprimido pasa de ${maxBytes} bytes`)
    }

    throw networkError(host, 'el cuerpo venía comprimido y no se pudo descomprimir')
  }

  try {
    if (tipo === 'gzip' || tipo === 'x-gzip') return gunzipSync(raw, { maxOutputLength: maxBytes })
    if (tipo === 'br') return brotliDecompressSync(raw, { maxOutputLength: maxBytes })
    if (tipo === 'deflate') {
      try {
        return inflateSync(raw, { maxOutputLength: maxBytes })
      } catch {
        // Hay servidores que mandan `deflate` en crudo, sin cabecera zlib.
        return inflateRawSync(raw, {
          maxOutputLength: maxBytes,
          finishFlush: zlibConstants.Z_SYNC_FLUSH,
        })
      }
    }
  } catch (cause) {
    return corta(cause)
  }

  throw networkError(
    host,
    `la respuesta dice venir comprimida con algo que no se entiende: ${tipo}`,
  )
}

/** Las cabeceras del plugin, ya validadas y sin las que elige este módulo. */
function sanitizeRequestHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): [string, string][] {
  const salida: [string, string][] = []

  for (const [nombre, valor] of Object.entries(headers ?? {})) {
    if (!ALLOWED_REQUEST_HEADERS.has(nombre.toLowerCase())) continue

    // Un salto de línea en un valor es una cabecera nueva, y aquí no hay nadie
    // más que lo compruebe: el esquema del motor valida las cabeceras que un
    // plugin *devuelve*, no las que pide.
    if (!HEADER_NAME_RE.test(nombre) || hasControlChars(valor)) {
      throw new AppError({
        code: 'provider',
        message: `el plugin pidió una cabecera que no se puede usar: ${nombre}`,
        context: { header: nombre },
        scope: 'media-proxy',
        op: 'pluginFetch',
      })
    }

    salida.push([nombre, valor])
  }

  return salida
}

function buildRequest(
  url: URL,
  method: string,
  headers: readonly (readonly [string, string])[],
  body: string | undefined,
): string {
  const lineas = [
    `${method} ${url.pathname}${url.search} HTTP/1.1`,
    `Host: ${url.host}`,
    'Connection: close',
    'Accept-Encoding: gzip, deflate, br',
  ]

  for (const [nombre, valor] of headers) lineas.push(`${nombre}: ${valor}`)
  if (body !== undefined) lineas.push(`Content-Length: ${Buffer.byteLength(body)}`)

  return `${lineas.join('\r\n')}\r\n\r\n${body ?? ''}`
}

/**
 * La capacidad, lista para dársela a un plugin.
 *
 * Se construye por llamada porque el plazo y la cancelación son de la llamada —el
 * `signal` del usuario y su `timeoutMs`—, no del proceso. El plazo es **total**,
 * saltos incluidos: aquí lo que se pide son páginas, bundles y manifiestos de
 * unos pocos megas, no una película de dos horas, así que el plazo total no mata
 * nada legítimo (al revés que en `byte-proxy`, donde el vigilante es de
 * inactividad por ese motivo).
 */
export function createPluginFetch(options: PluginFetchOptions = {}): PluginFetch {
  const resolver = options.resolver ?? systemResolver
  const connector = options.connector ?? systemConnector
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS
  const maxBytes = options.maxBytes ?? MAX_BODY_BYTES
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const exento = options.allowLoopback ?? allowLoopbackFromEnv()

  return async (rawUrl, request = {}) => {
    const host = ((): string => {
      try {
        return new URL(rawUrl).host
      } catch {
        return 'desconocido'
      }
    })()

    const plazo = AbortSignal.timeout(timeoutMs)
    const signal = options.signal === undefined ? plazo : AbortSignal.any([options.signal, plazo])
    const metodo = request.method ?? 'GET'
    const cuerpo = request.body
    const tope = Math.min(request.maxBytes ?? maxBytes, maxBytes)
    let cabeceras: readonly (readonly [string, string])[] = sanitizeRequestHeaders(request.headers)
    let actual = rawUrl
    let transporte: PluginTransport | undefined

    signal.addEventListener('abort', () => transporte?.destroy(), { once: true })

    for (let salto = 0; salto <= maxRedirects; salto++) {
      if (signal.aborted) throw timeoutError(host, timeoutMs)

      // Se comprueba **sin excepción** y la excepción se aplica aquí, más estrecha
      // que la del proxy: sólo `loopback`. Un sitio de prueba en la propia máquina
      // vive en `127.0.0.1` o en un nombre que resuelve ahí; una red privada no es
      // un caso de prueba de nadie.
      const destino = checkDestination(actual)
      if (!destino.ok && !exentoDeLoopback(destino.rule, exento)) {
        throw destinationError(destino.rule, actual)
      }

      const url = destino.ok ? destino.url : new URL(actual)
      const direccion = await resolvePinned(url, { resolver, exento })
      const puerto = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port)

      if (!Number.isInteger(puerto) || puerto <= 0 || puerto > 65_535) {
        throw destinationError('malformed', actual)
      }

      try {
        transporte = await connector({
          address: direccion,
          port: puerto,
          servername: url.hostname.replace(/^\[|\]$/g, ''),
          tls: url.protocol === 'https:',
          signal,
        })
      } catch (cause) {
        if (signal.aborted) throw timeoutError(host, timeoutMs)

        throw networkError(host, cause instanceof Error ? cause.message : String(cause))
      }

      const respuesta = await readResponse(transporte, {
        request: buildRequest(url, metodo, cabeceras, cuerpo),
        maxBytes: tope,
        method: metodo,
        host,
      }).catch((cause: unknown) => {
        if (signal.aborted) throw timeoutError(host, timeoutMs)

        throw networkError(host, cause instanceof Error ? cause.message : String(cause))
      })

      // La conexión ya dio lo que tenía: se suelta antes de decidir si hay otro
      // salto, para no acumular sockets abiertos.
      transporte.destroy()

      // El plazo puede haber saltado mientras se leía: `destroy()` cierra el
      // socket y sin esta comprobación la respuesta saldría vacía en vez de
      // fallar.
      if (signal.aborted) throw timeoutError(host, timeoutMs)

      const location = headerValue(respuesta.headers, 'location')
      if (respuesta.status >= 300 && respuesta.status < 400 && location !== undefined) {
        const siguiente = new URL(location, url)

        // Una redirección a otro origen no se lleva la credencial del plugin: la
        // cookie es de este sitio, no del que el sitio decida después.
        if (siguiente.origin !== url.origin) {
          cabeceras = cabeceras.filter(
            ([nombre]) => !CREDENTIAL_HEADERS.includes(nombre.toLowerCase()),
          )
        }

        actual = siguiente.href
        continue
      }

      const encoding = headerValue(respuesta.headers, 'content-encoding') ?? ''
      const claro = decompress(respuesta.body, encoding, tope, host)
      const visibles: Record<string, string> = {}

      for (const [nombre, valor] of respuesta.headers) {
        if (!ALLOWED_RESPONSE_HEADERS.includes(nombre)) continue
        if (visibles[nombre] === undefined) visibles[nombre] = valor
      }

      return {
        status: respuesta.status,
        url: url.href,
        headers: visibles,
        setCookie: respuesta.headers
          .filter(([nombre]) => nombre === 'set-cookie')
          .map(([, valor]) => valor),
        body: claro.toString('utf8'),
      }
    }

    throw destinationError('redirect-limit', actual)
  }
}

/**
 * La capacidad, con la forma que el motor espera: una fábrica por llamada.
 *
 * Es lo que se registra al arrancar. Sin registrar nada, `CallOptions.fetch` se
 * queda sin poner y el plugin que la necesite falla cerrado —con un mensaje que
 * lo dice— en vez de salir por el `fetch` global sin que nadie lo note.
 */
export const pluginFetchFactory: PluginFetchFactory = (call: PluginFetchCall) =>
  createPluginFetch({ signal: call.signal, timeoutMs: call.timeoutMs })
