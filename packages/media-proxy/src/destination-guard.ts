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
 * Queda un riesgo residual que conviene decir en voz alta: entre la comprobación
 * y la conexión, un DNS hostil puede cambiar la respuesta (rebinding). Cerrarlo
 * del todo exige conectar a la IP ya validada, y eso rompe SNI y la validación
 * del certificado. Está anotado en el informe de v1 como riesgo aceptado.
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

/** Clasificación de una IPv6. */
function ipv6Rule(direccion: string): DestinationRule | undefined {
  const limpia = direccion.toLowerCase().split('%')[0] ?? ''

  // Una dirección IPv4 escrita dentro de una IPv6 se comprueba como IPv4: si no,
  // `::ffff:127.0.0.1` sería loopback para el sistema y transparente para aquí.
  const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(limpia)
  if (mapeada !== null) {
    const partes = (mapeada[1] ?? '').split('.').map(Number)

    return ipv4Rule(partes)
  }

  if (limpia === '::1' || limpia === '::') return 'loopback'
  if (
    limpia.startsWith('fe8') ||
    limpia.startsWith('fe9') ||
    limpia.startsWith('fea') ||
    limpia.startsWith('feb')
  ) {
    return 'link-local'
  }
  if (limpia.startsWith('fc') || limpia.startsWith('fd')) return 'private'

  return undefined
}

/** La regla que prohíbe una dirección, si la hay. */
export function addressRule(address: string): DestinationRule | undefined {
  return address.includes(':') ? ipv6Rule(address) : ipv4Rule(address.split('.').map(Number))
}

/** Comprueba la URL sin salir a la red: esquema y dirección literal. */
export function checkDestination(rawUrl: string): DestinationOutcome {
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
    if (rule !== undefined) return { ok: false, rule }
  }

  if (host === 'localhost' || host.endsWith('.localhost')) return { ok: false, rule: 'loopback' }

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
): Promise<DestinationOutcome> {
  const literal = checkDestination(rawUrl)
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
    if (rule !== undefined) return { ok: false, rule }
  }

  return literal
}

/** Saltos de redirección permitidos. */
export const MAX_REDIRECTS = 5

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
    const destino = await checkResolvedDestination(actual, options.resolver)
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
