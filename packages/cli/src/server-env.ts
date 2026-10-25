/**
 * El entorno del modo servidor: host, puerto, token y modo restringido.
 *
 * Vive aparte de `env.ts` por el mismo motivo que aquél: `env.ts` describe lo
 * que necesita `loadConfig` para calcular rutas, y esto describe lo que
 * necesita el arranque para decidir dónde escucha y cómo autentica. Mezclarlos
 * obligaría a que la migración de la base conociera un token.
 *
 * Todo se resuelve **antes** de tocar disco o abrir un socket. Un puerto que no
 * es un puerto, un origen que no es un origen o un servidor sin token son
 * errores de configuración, y un error de configuración se dice al arrancar; no
 * se convierte en un valor por defecto silencioso que luego nadie sabe de dónde
 * salió.
 */

import { err, type MessageParams, ok, type Result } from '@nn-anime/core'

/** Interfaz por defecto. La misma de siempre: el modo local no cambia. */
export const DEFAULT_HOST = '127.0.0.1'

/** Longitud mínima del token cuando la aplicación sale de loopback. */
export const MIN_TOKEN_LENGTH = 16

export const MIN_PORT = 1
export const MAX_PORT = 65535

export interface ServerEnvironment {
  readonly host: string
  readonly port: number | undefined
  readonly noOpen: boolean
  readonly token: string | undefined
  /** Origen canónico, sin barra final. Gobierna cookie `Secure`, Host y Origin. */
  readonly publicOrigin: string | undefined
  readonly secureCookie: boolean
  readonly locked: boolean
}

/**
 * La política de red que recibe el servidor.
 *
 * Es estructural y no importa el tipo de `@nn-anime/server`: este módulo es
 * puro y sus pruebas no tienen por qué cargar Hono. El servidor acepta la misma
 * forma, y TypeScript la comprueba al pasarla.
 */
export interface ServerNetwork {
  readonly extraHosts: readonly string[]
  readonly allowAnyHost: boolean
  readonly extraOrigins: readonly string[]
  readonly sameOrigin: boolean
}

export type ServerEnvErrorKey =
  | 'cli.env.invalidHost'
  | 'cli.env.invalidPort'
  | 'cli.env.invalidOrigin'
  | 'cli.env.noTokenOnServer'
  | 'cli.env.weakToken'
  | 'cli.env.loopbackOnServer'

export interface ServerEnvError {
  readonly key: ServerEnvErrorKey
  readonly params: MessageParams
}

export type ServerEnvResult = Result<ServerEnvironment, ServerEnvError>

/** El entorno de un arranque local, sin variables. */
export const DEFAULT_SERVER_ENV: ServerEnvironment = {
  host: DEFAULT_HOST,
  port: undefined,
  noOpen: false,
  token: undefined,
  publicOrigin: undefined,
  secureCookie: false,
  locked: false,
}

function usable(value: string | undefined): string | undefined {
  if (value === undefined) return undefined

  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Mismo criterio que `NN_ANIME_ALLOW_LOOPBACK` y `NN_ANIME_ANILIST_OFFLINE`. */
function flag(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

/** Sin esquema, sin barras y sin espacios: un nombre de host, no una URL. */
function normalizeHost(raw: string): string | undefined {
  const value = raw.trim()
  if (value === '') return undefined
  if (/[\s/\\]/.test(value) || value.includes('://')) return undefined

  const withoutBrackets = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
  const lower = withoutBrackets.toLowerCase()

  // `localhost` no es lo mismo que `127.0.0.1` para las cookies, y el guard de
  // Host del modo local rechaza el nombre. Se normaliza aquí para que escribir
  // `NN_ANIME_HOST=localhost` no deje un servidor que no se puede abrir.
  return lower === 'localhost' ? DEFAULT_HOST : lower
}

export function isLoopbackHost(host: string): boolean {
  const value = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host

  return value === 'localhost' || value === '::1' || value === '127.0.0.1' || /^127\./.test(value)
}

function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '[::]'
}

/** El host que se puede escribir en una URL: IPv6 entre corchetes, wildcard no. */
export function hostForUrl(host: string): string {
  if (isWildcardHost(host)) return DEFAULT_HOST

  const value = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host

  return value.includes(':') ? `[${value}]` : value
}

function parsePort(
  raw: string | undefined,
):
  | { readonly ok: true; readonly value: number | undefined }
  | { readonly ok: false; readonly value: string } {
  const value = usable(raw)
  if (value === undefined) return { ok: true, value: undefined }
  if (!/^\d+$/.test(value)) return { ok: false, value }

  const port = Number(value)
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    return { ok: false, value }
  }

  return { ok: true, value: port }
}

function parseOrigin(raw: string | undefined): string | undefined {
  const value = usable(raw)
  if (value === undefined) return undefined

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (url.username !== '' || url.password !== '') return undefined

  return url.origin
}

/**
 * Los hosts y orígenes que hay que admitir además del loopback.
 *
 * El modo local puro no usa esto: sin token y con el host por defecto,
 * `networkPolicy` no se pasa al servidor y el guard se queda exactamente como
 * estaba. Se llama cuando hay host propio u origen público.
 *
 * Si no hay origen público y el host no es loopback, no se puede saber con qué
 * nombre llegarán los clientes (la IP de la LAN, un nombre mDNS, el que use el
 * NAS), así que se acepta cualquiera: la cookie de sesión es la puerta y sin
 * ella no se lee nada. Fijar `NN_ANIME_PUBLIC_ORIGIN` cierra esa puerta a los
 * nombres que no sean el suyo.
 */
export function networkPolicy(input: {
  readonly host: string
  readonly port: number
  readonly publicOrigin: string | undefined
}): ServerNetwork {
  const extraHosts: string[] = []
  const originHost = input.publicOrigin === undefined ? undefined : new URL(input.publicOrigin).host

  if (originHost !== undefined) extraHosts.push(originHost.toLowerCase())

  if (!isWildcardHost(input.host) && input.host !== DEFAULT_HOST) {
    extraHosts.push(`${hostForUrl(input.host)}:${input.port}`.toLowerCase())
  }

  const extraOrigins =
    input.publicOrigin === undefined
      ? !isWildcardHost(input.host) && input.host !== DEFAULT_HOST
        ? [`http://${hostForUrl(input.host)}:${input.port}`]
        : []
      : [input.publicOrigin]

  return {
    extraHosts: [...new Set(extraHosts)],
    allowAnyHost: input.publicOrigin === undefined && !isLoopbackHost(input.host),
    extraOrigins,
    sameOrigin: true,
  }
}

export function serverEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): ServerEnvResult {
  const rawHost = usable(env.NN_ANIME_HOST)
  const host = rawHost === undefined ? DEFAULT_HOST : normalizeHost(rawHost)
  if (host === undefined) {
    return err({ key: 'cli.env.invalidHost', params: { value: rawHost ?? '' } })
  }

  const parsedPort = parsePort(env.NN_ANIME_PORT)
  if (!parsedPort.ok) {
    return err({
      key: 'cli.env.invalidPort',
      params: { value: parsedPort.value, min: MIN_PORT, max: MAX_PORT },
    })
  }

  const rawOrigin = usable(env.NN_ANIME_PUBLIC_ORIGIN)
  const publicOrigin = parseOrigin(rawOrigin)
  if (rawOrigin !== undefined && publicOrigin === undefined) {
    return err({ key: 'cli.env.invalidOrigin', params: { value: rawOrigin } })
  }

  const token = usable(env.NN_ANIME_TOKEN)
  const originHost = publicOrigin === undefined ? undefined : new URL(publicOrigin).hostname
  const outsideLoopback =
    !isLoopbackHost(host) || (originHost !== undefined && !isLoopbackHost(originHost))

  if (outsideLoopback && token === undefined) {
    return err({
      key: 'cli.env.noTokenOnServer',
      params: { where: publicOrigin ?? host },
    })
  }

  if (outsideLoopback && token !== undefined && token.length < MIN_TOKEN_LENGTH) {
    return err({ key: 'cli.env.weakToken', params: { min: MIN_TOKEN_LENGTH } })
  }

  return ok({
    host,
    port: parsedPort.value,
    noOpen: flag(env.NN_ANIME_NO_OPEN),
    token,
    publicOrigin,
    secureCookie: publicOrigin?.startsWith('https://') ?? false,
    locked: flag(env.NN_ANIME_LOCKED),
  })
}
