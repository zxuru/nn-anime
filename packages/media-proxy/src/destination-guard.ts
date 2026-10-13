/**
 * Lista blanca de destinos.
 *
 * El proxy sale a donde le diga una URL que viene, en última instancia, de un
 * plugin. Sin esta puerta, un plugin —o una URL manipulada— puede pedirle al
 * servidor que abra `http://127.0.0.1:22` o que lea la metadata de la nube del
 * usuario, y el servidor lo haría con sus permisos. Es la mitigación de SSRF del
 * proyecto, y por eso se comprueba **cada salto**, no sólo el primero.
 *
 * Tres reglas que se aplican en este orden:
 *
 * 1. **Esquema.** Sólo `http` y `https`. `file:`, `data:` y `ftp:` se rechazan
 *    antes de abrir nada: no son «destinos sospechosos», son cosas que este
 *    proxy no hace.
 * 2. **Dirección literal.** Loopback, redes privadas, link-local y las
 *    direcciones de metadata de nube conocidas.
 * 3. **Dirección resuelta.** La comprobación se repite **después de resolver el
 *    nombre**, porque `localhost` o un dominio propio pueden apuntar a
 *    `127.0.0.1`. Se revisan todas las respuestas del DNS: basta con que una sea
 *    prohibida para rechazar el destino.
 *
 * El riesgo residual que esta lista **no** cerraba: entre la comprobación y la
 * conexión, un DNS hostil podía cambiar la respuesta (rebinding). Estuvo anotado
 * como aceptado con el argumento de que conectar a la IP ya validada rompía SNI y
 * la validación del certificado; **medido, no era cierto** —el nombre viaja en el
 * SNI y el certificado se valida contra él—. Desde T110 quien conecta es
 * `pinned-fetch.ts`, que resuelve una vez, juzga todas las direcciones aquí y
 * conecta a la que validó. Esta lista sigue siendo la puerta; la conexión ya no
 * vuelve a preguntarle al DNS.
 */

import { lookup } from 'node:dns/promises'
import { AppError } from '@nn-anime/core'

export type DestinationRule =
  | 'scheme'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'metadata'
  | 'malformed'
  | 'redirect-limit'
  | 'dns'

export type DestinationOutcome =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly rule: DestinationRule }

/**
 * La variable que abre el loopback, y **sólo** el loopback.
 *
 * El e2e necesita servir un archivo local para probar el reproductor, y el proxy
 * lo rechaza por diseño. La alternativa —abrir la lista blanca de verdad— dejaría
 * la aplicación sin la mitigación de SSRF en producción, así que la excepción es
 * una variable de entorno que nadie pone sin querer y que se anuncia en el
 * registro al arrancar.
 *
 * Sólo afecta a loopback y a redes privadas: la metadata de nube se sigue
 * rechazando aunque esté puesta.
 */
export const ALLOW_LOOPBACK_ENV = 'NN_ANIME_ALLOW_LOOPBACK'

export interface GuardOptions {
  /**
   * Acepta loopback y redes privadas. Es para el e2e y para desarrollo; en
   * producción no se pone.
   */
  readonly allowLoopback?: boolean | undefined
}

/** ¿Está pedida la excepción por entorno? */
export function allowLoopbackFromEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const valor = env[ALLOW_LOOPBACK_ENV]

  return valor === '1' || valor === 'true'
}

const ALLOWED_SCHEMES: readonly string[] = ['http:', 'https:']

/** Direcciones de metadata de nube que se conocen por su nombre. */
const METADATA_ADDRESSES: readonly string[] = [
  '169.254.169.254', // AWS, GCP, Azure
  '100.100.100.200', // Alibaba
  '192.0.0.192', // Oracle
]

/** Clasificación de una IPv4, por sus primeros octetos. */
function ipv4Rule(parts: readonly number[]): DestinationRule | undefined {
  const [a = -1, b = -1] = parts

  if (parts.length !== 4 || parts.some((part) => part < 0 || part > 255)) return 'malformed'
  if (METADATA_ADDRESSES.includes(parts.join('.'))) return 'metadata'
  if (a === 127 || a === 0) return 'loopback'
  if (a === 10) return 'private'
  if (a === 172 && b >= 16 && b <= 31) return 'private'
  if (a === 192 && b === 168) return 'private'
  if (a === 169 && b === 254) return 'link-local'
  // Multicast y broadcast no son destinos: nadie sirve video desde ahí.
  if (a >= 224) return 'malformed'

  return undefined
}

/**
 * Los 16 bytes de una IPv6, o `undefined` si el texto no es una dirección.
 *
 * Se lee por bytes y no por forma del texto porque el texto engaña:
 * `new URL('http://[::ffff:127.0.0.1]/').hostname` devuelve `[::ffff:7f00:1]`,
 * ya en hexadecimal. Una lista negra de formas escritas se queda corta en cuanto
 * el navegador, o el DNS, elige otra.
 */
function ipv6Bytes(direccion: string): Uint8Array | undefined {
  const limpia = direccion.toLowerCase().split('%')[0] ?? ''
  if (limpia === '') return undefined

  const abierto = limpia.includes('::')
  const [cabeza = '', cola] = limpia.split('::')
  const grupo = /^[0-9a-f]{1,4}$/
  const izquierda = cabeza === '' ? [] : cabeza.split(':')
  const derecha = cola === undefined || cola === '' ? [] : cola.split(':')

  if (izquierda.some((parte) => !grupo.test(parte))) return undefined
  if (derecha.some((parte) => !grupo.test(parte))) return undefined

  const faltan = 8 - izquierda.length - derecha.length
  if (abierto ? faltan < 1 : faltan !== 0) return undefined

  const grupos = [...izquierda, ...new Array<string>(faltan).fill('0'), ...derecha]
  const bytes = new Uint8Array(16)

  for (let i = 0; i < 8; i++) {
    const valor = Number.parseInt(grupos[i] ?? '0', 16)
    bytes[i * 2] = valor >> 8
    bytes[i * 2 + 1] = valor & 0xff
  }

  return bytes
}

/**
 * Clasificación de una IPv6, por sus bytes.
 *
 * La regla final es una **lista blanca**: sólo unicast global (`2000::/3`). Todo
 * lo demás —loopback, link-local, única local, multicast, NAT64, 6to4, Teredo y
 * lo reservado— se rechaza, y una IPv4 escrita dentro de una IPv6 se juzga como
 * la IPv4 que es. Con una lista negra de formas, `::ffff:7f00:1` entraba: es la
 * misma dirección que `127.0.0.1` y ninguna de las formas escritas la delataba.
 */
function ipv6Rule(direccion: string): DestinationRule | undefined {
  const limpia = direccion.toLowerCase().split('%')[0] ?? ''

  // La forma con puntos sigue siendo válida aunque `URL` la normalice a
  // hexadecimal: `addressRule` también se llama con lo que devuelve el DNS.
  const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(limpia)
  if (mapeada !== null) return ipv4Rule((mapeada[1] ?? '').split('.').map(Number))

  const bytes = ipv6Bytes(limpia)
  if (bytes === undefined) return 'malformed'

  const b = (i: number): number => bytes[i] ?? 0
  const ceros = (desde: number, hasta: number): boolean =>
    bytes.slice(desde, hasta).every((x) => x === 0)
  const embebida = (): DestinationRule | undefined => ipv4Rule([b(12), b(13), b(14), b(15)])

  // Una IPv4 dentro de una IPv6, mapeada (`::ffff:a.b.c.d`) o compatible
  // (`::a.b.c.d`). Las dos formas se conectan como la IPv4 que llevan dentro.
  if (ceros(0, 10) && b(10) === 0xff && b(11) === 0xff) return embebida()
  if (ceros(0, 12)) return embebida()

  if (b(0) === 0xfe && b(1) >= 0x80 && b(1) <= 0xbf) return 'link-local'
  if (b(0) === 0xfc || b(0) === 0xfd) return 'private'
  if (b(0) === 0xff) return 'malformed'

  // Sólo unicast global (`2000::/3`). Admitir el resto es superficie gratis: no
  // hay ningún caso de uso de este proxy detrás de esas direcciones.
  if (b(0) < 0x20 || b(0) > 0x3f) return 'malformed'

  return undefined
}

/** La regla que prohíbe una dirección, si la hay. */
export function addressRule(address: string): DestinationRule | undefined {
  return address.includes(':') ? ipv6Rule(address) : ipv4Rule(address.split('.').map(Number))
}

/** Comprueba la URL sin salir a la red: esquema y dirección literal. */
export function checkDestination(rawUrl: string, options: GuardOptions = {}): DestinationOutcome {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, rule: 'malformed' }
  }

  if (!ALLOWED_SCHEMES.includes(url.protocol)) return { ok: false, rule: 'scheme' }

  const host = url.hostname.replace(/^\[|\]$/g, '')
  // Un nombre no se puede juzgar sin resolverlo; una dirección literal, sí.
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    const rule = addressRule(host)
    if (rule !== undefined && !eximido(rule, options)) return { ok: false, rule }
  }

  if (host === 'localhost' || host.endsWith('.localhost')) {
    if (!options.allowLoopback) return { ok: false, rule: 'loopback' }
  }

  return { ok: true, url }
}

export type Resolver = (host: string) => Promise<readonly string[]>

/** El resolutor de verdad: todas las respuestas del DNS, no la primera. */
export const systemResolver: Resolver = async (host) => {
  const respuestas = await lookup(host, { all: true })

  return respuestas.map((respuesta) => respuesta.address)
}

/**
 * Comprueba la URL **después de resolver el nombre**.
 *
 * Todas las respuestas se revisan: un DNS que devuelve `127.0.0.1` y una
 * dirección pública a la vez no es un destino permitido, es un intento de
 * colarse.
 */
export async function checkResolvedDestination(
  rawUrl: string,
  resolver: Resolver = systemResolver,
  options: GuardOptions = {},
): Promise<DestinationOutcome> {
  const literal = checkDestination(rawUrl, options)
  if (!literal.ok) return literal

  const host = literal.url.hostname.replace(/^\[|\]$/g, '')
  if (/^[\d.]+$/.test(host) || host.includes(':')) return literal

  let direcciones: readonly string[]
  try {
    direcciones = await resolver(host)
  } catch {
    return { ok: false, rule: 'dns' }
  }

  if (direcciones.length === 0) return { ok: false, rule: 'dns' }

  for (const direccion of direcciones) {
    const rule = addressRule(direccion)
    if (rule !== undefined && !eximido(rule, options)) return { ok: false, rule }
  }

  return literal
}

/** Saltos de redirección permitidos. */
export const MAX_REDIRECTS = 5

/**
 * ¿La excepción cubre esta regla?
 *
 * Sólo loopback y redes privadas. La metadata de nube es un destino que no tiene
 * ningún caso de uso legítimo, ni siquiera en pruebas.
 *
 * Está exportada porque `pinned-fetch.ts` aplica la excepción **dirección a
 * dirección**, sobre las que va a conectar de verdad, y una segunda lista de
 * reglas eximidas divergiría de ésta sin que nadie lo notara.
 */
export function eximido(rule: DestinationRule, options: GuardOptions): boolean {
  if (options.allowLoopback !== true) return false

  return rule === 'loopback' || rule === 'private'
}

/**
 * El error de un destino rechazado.
 *
 * Nombra la regla y el host, y **no** la URL completa: un error se registra, y
 * una URL de un proveedor puede llevar tokens de referencia dentro.
 */
export function destinationError(rule: DestinationRule, rawUrl: string): AppError {
  const host = ((): string => {
    try {
      return new URL(rawUrl).host
    } catch {
      return 'desconocido'
    }
  })()

  const texto: Record<DestinationRule, string> = {
    scheme: 'sólo se admiten direcciones http y https',
    loopback: 'el destino es la propia máquina',
    private: 'el destino es una red privada',
    'link-local': 'el destino es una dirección link-local',
    metadata: 'el destino es la metadata de la nube',
    malformed: 'la dirección no es válida',
    'redirect-limit': `se superaron los ${MAX_REDIRECTS} saltos de redirección`,
    dns: 'el nombre no se pudo resolver',
  }

  return new AppError({
    code: 'upstream',
    message: `destino rechazado (${rule}): ${texto[rule]}`,
    context: { rule, host },
    scope: 'media-proxy',
    op: 'checkDestination',
  })
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface AllowedFetchOptions {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly signal?: AbortSignal | undefined
  readonly fetchImpl: FetchLike
  readonly resolver?: Resolver
  readonly maxRedirects?: number
  /** Excepción de loopback, para el e2e. Ver `ALLOW_LOOPBACK_ENV`. */
  readonly allowLoopback?: boolean | undefined
}

/**
 * Pide una URL permitida siguiendo redirecciones **una a una**.
 *
 * Con `redirect: 'manual'`, cada salto se resuelve y se vuelve a validar: una
 * redirección es la forma más fácil de saltarse una lista blanca que sólo mira
 * la primera URL. El tope de saltos evita el bucle infinito.
 */
export async function fetchAllowed(options: AllowedFetchOptions): Promise<Response> {
  const maximo = options.maxRedirects ?? MAX_REDIRECTS
  let actual = options.url

  for (let salto = 0; salto <= maximo; salto++) {
    const destino = await checkResolvedDestination(actual, options.resolver, {
      ...(options.allowLoopback === undefined ? {} : { allowLoopback: options.allowLoopback }),
    })
    if (!destino.ok) throw destinationError(destino.rule, actual)

    const respuesta = await options.fetchImpl(actual, {
      headers: options.headers,
      redirect: 'manual',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })

    if (respuesta.status < 300 || respuesta.status >= 400) return respuesta

    const location = respuesta.headers.get('location')
    if (location === null) return respuesta

    // El cuerpo de una redirección no se usa: se descarta para no dejar la
    // conexión abierta mientras se pide el siguiente salto.
    await respuesta.body?.cancel().catch(() => {})

    actual = new URL(location, actual).href
  }

  throw destinationError('redirect-limit', actual)
}
