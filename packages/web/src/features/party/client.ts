/**
 * Cliente HTTP de la sala.
 *
 * **Todo va contra la instancia propia**, también lo del invitado. La pestaña
 * del invitado no habla con el servidor del anfitrión: su instancia guarda el
 * enlace y el token del anfitrión en memoria y hace de puente. Así el navegador
 * no sale del origen —la CSP del proyecto es `connect-src 'self'`—, no hay CORS
 * ni cookies de terceros, y el token de la sala no llega nunca al navegador.
 *
 * Por eso aquí no hay `Authorization` en ninguna petición y no se construye
 * ninguna URL con la dirección del anfitrión: lo único que viaja es el
 * `baseUrl` que el invitado escribe, dentro del cuerpo del `join`, para que su
 * servidor sepa con quién hablar.
 *
 * Las respuestas se validan con Zod antes de devolverlas. El `join` del
 * invitado usa `partyRemoteSnapshotSchema` de `core`, que es la forma sin token
 * que devuelve su propia instancia; el resto usa los schemas compartidos.
 */

import {
  type PartyClockSample,
  type PartyCreateRoomResponse,
  type PartyEvent,
  type PartyHostState,
  type PartyInfoResponse,
  type PartyRemoteSnapshot,
  type PartyReport,
  partyCreateRoomResponseSchema,
  partyEventSchema,
  partyInfoResponseSchema,
  partyRemoteSnapshotSchema,
  partySyncReplySchema,
} from '@nn-anime/core/party'
import type { z } from 'zod'
import { ApiError, ApiShapeError } from '../../api/client'

/** Una función `fetch` con la firma que usan los tests para sustituirla. */
export type PartyFetch = (input: string, init: RequestInit) => Promise<Response>

export interface PartyRequestOptions {
  readonly signal?: AbortSignal | undefined
  /** Inyectable para las pruebas; en la aplicación siempre es `globalThis.fetch`. */
  readonly fetch?: PartyFetch | undefined
}

function realFetch(): PartyFetch {
  return (input, init) => globalThis.fetch(input, init)
}

function fetchOf(options: PartyRequestOptions): PartyFetch {
  return options.fetch ?? realFetch()
}

/** Petición al mismo origen. La sesión de la pestaña va en la cookie `HttpOnly`. */
/**
 * Tiempo límite de una petición corriente.
 *
 * El flujo SSE no lo lleva —vive mientras dure la sala—, pero una creación o un
 * reporte que se queda colgado deja el panel «creando» para siempre. Ocho
 * segundos es el mismo límite que usa el resto de la interfaz.
 */
const DEFAULT_TIMEOUT_MS = 8000

/**
 * Petición al mismo origen. La sesión de la pestaña va en la cookie `HttpOnly`.
 *
 * `timeoutMs: 0` desactiva el límite, y eso es lo que usa el flujo de eventos:
 * cortarlo cada ocho segundos cerraría la sala sola.
 */
async function sameOriginRequest(
  path: string,
  init: RequestInit,
  options: PartyRequestOptions,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const signal = options.signal ?? (timeoutMs === 0 ? undefined : AbortSignal.timeout(timeoutMs))
  const respuesta = await fetchOf(options)(path, {
    ...init,
    credentials: 'same-origin',
    ...(signal === undefined ? {} : { signal }),
  })

  if (!respuesta.ok) {
    throw new ApiError(
      respuesta.status,
      `${init.method ?? 'GET'} ${path} respondió ${respuesta.status}`,
    )
  }

  return respuesta
}

async function readJson<T>(path: string, respuesta: Response, schema: z.ZodType<T>): Promise<T> {
  let crudo: unknown
  try {
    crudo = await respuesta.json()
  } catch {
    throw new ApiShapeError(path, 'el cuerpo no es JSON válido')
  }

  const parsed = schema.safeParse(crudo)
  if (!parsed.success) throw new ApiShapeError(path, parsed.error.message)

  return parsed.data
}

function jsonInit(method: 'POST' | 'DELETE', body: unknown): RequestInit {
  return {
    method,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

/** Envía sin leer el cuerpo: las mutaciones de la sala contestan 204. */
async function sendWithoutBody(
  path: string,
  init: RequestInit,
  options: PartyRequestOptions,
): Promise<void> {
  await sameOriginRequest(path, init, options)
}

// --- Anfitrión (misma sesión de la aplicación) ----------------------------

/** Crea la sala en esta instancia. */
export async function createPartyRoom(
  options: PartyRequestOptions = {},
): Promise<PartyCreateRoomResponse> {
  const path = '/api/party/rooms'
  const respuesta = await sameOriginRequest(path, jsonInit('POST', {}), options)

  return readJson(path, respuesta, partyCreateRoomResponseSchema)
}

/** Las direcciones de esta instancia que el invitado puede escribir. */
export async function readPartyInfo(options: PartyRequestOptions = {}): Promise<PartyInfoResponse> {
  const path = '/api/party/info'
  const respuesta = await sameOriginRequest(path, { method: 'GET' }, options)

  return readJson(path, respuesta, partyInfoResponseSchema)
}

/** Cierra la sala: los invitados reciben `closed` por el flujo. */
export async function closePartyRoom(
  roomId: string,
  options: PartyRequestOptions = {},
): Promise<void> {
  await sendWithoutBody(
    `/api/party/rooms/${encodeURIComponent(roomId)}`,
    { method: 'DELETE' },
    options,
  )
}

/** Publica el estado autoritativo; el servidor añade `seq` y `atMs`. */
export async function publishPartyState(
  roomId: string,
  state: PartyHostState,
  options: PartyRequestOptions = {},
): Promise<void> {
  await sendWithoutBody(
    `/api/party/rooms/${encodeURIComponent(roomId)}/state`,
    jsonInit('POST', state),
    options,
  )
}

/**
 * El flujo del anfitrión, con su propia sesión.
 *
 * Va con la cookie de la aplicación y sin token: el servidor se lo sirve a quien
 * ya es el anfitrión de la sala para que reciba el roster.
 */
export async function* readHostPartyEvents(
  roomId: string,
  options: PartyRequestOptions = {},
): AsyncGenerator<PartyEvent> {
  yield* readEventStream(`/api/party/rooms/${encodeURIComponent(roomId)}/events`, options)
}

// --- Invitado (todo contra la instancia local) ----------------------------

export interface RemoteJoinInput {
  /** La dirección del anfitrión tal y como la escribió la persona. */
  readonly baseUrl: string
  readonly code: string
  readonly name: string
}

/**
 * Entra a la sala del anfitrión a través de la instancia local.
 *
 * `baseUrl` viaja en el cuerpo, ya normalizado: la instancia local es la única
 * que hace la petición remota y la única que ve el token que devuelve.
 */
export async function joinRemoteRoom(
  input: RemoteJoinInput,
  options: PartyRequestOptions = {},
): Promise<PartyRemoteSnapshot> {
  const path = '/api/party/remote/join'
  const respuesta = await sameOriginRequest(path, jsonInit('POST', input), options)

  return readJson(path, respuesta, partyRemoteSnapshotSchema)
}

/** El flujo del invitado: su instancia reenvía los eventos del anfitrión. */
export async function* readRemotePartyEvents(
  options: PartyRequestOptions = {},
): AsyncGenerator<PartyEvent> {
  yield* readEventStream('/api/party/remote/events', options)
}

/** Cuenta por dónde va, si está almacenando y si ya puede reproducir. */
export async function reportRemotePosition(
  report: PartyReport,
  options: PartyRequestOptions = {},
): Promise<void> {
  await sendWithoutBody('/api/party/remote/report', jsonInit('POST', report), options)
}

/**
 * Una muestra del reloj del anfitrión.
 *
 * `t0` y `t3` se toman aquí, con el reloj monótono del navegador; `t1` y `t2`
 * los pone el coordinador. El desfase se calcula con la mediana de cinco
 * muestras —`partyClockOffset`— para que un pico de latencia no mande.
 */
export async function measureRemoteClock(
  options: PartyRequestOptions & { readonly now?: (() => number) | undefined } = {},
): Promise<PartyClockSample> {
  const now = options.now ?? (() => performance.now())
  const path = '/api/party/remote/sync'
  const t0 = now()
  const respuesta = await sameOriginRequest(path, jsonInit('POST', { t0: Math.round(t0) }), options)
  const t3 = now()
  const reloj = await readJson(path, respuesta, partySyncReplySchema)

  return { t0: reloj.t0, t1: reloj.t1, t2: reloj.t2, t3 }
}

/** Sale de la sala y libera el hueco en el roster del anfitrión. */
export async function leaveRemoteRoom(options: PartyRequestOptions = {}): Promise<void> {
  await sendWithoutBody('/api/party/remote/leave', jsonInit('POST', {}), options)
}

// --- Dirección del anfitrión ---------------------------------------------

/**
 * Normaliza la dirección que escribe la persona, o `undefined` si no vale.
 *
 * Se acepta lo que se dicta y lo que se pega: `192.168.1.5:7717`,
 * `http://192.168.1.5:7717/`, o con `https`. Se exige que sea un origen —sin
 * ruta, sin credenciales, sin consulta— porque lo único que el servidor local
 * necesita es a quién preguntar; una ruta o un `javascript:` ahí es un error de
 * la persona o algo peor, y en los dos casos se rechaza.
 */
export function normalizeHostAddress(raw: string): string | undefined {
  const limpio = raw.trim().replace(/\/+$/, '')
  if (limpio === '') return undefined

  // Sin esquema se asume `http`: es lo que se teclea en una LAN, y un `https`
  // que no es no debe colarse por omisión.
  const conEsquema = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(limpio) ? limpio : `http://${limpio}`

  let url: URL
  try {
    url = new URL(conEsquema)
  } catch {
    return undefined
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (url.username !== '' || url.password !== '') return undefined
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return undefined
  if (url.hostname === '') return undefined

  return `${url.protocol}//${url.host}`
}

// --- SSE ------------------------------------------------------------------

export interface PartyEventParser {
  /** Añade un trozo y devuelve los eventos que quedaron completos. */
  push(chunk: string): readonly PartyEvent[]
}

/**
 * Un bloque SSE a un evento, o `undefined` si no hay nada legible.
 *
 * Se aceptan comentarios (`: ping`), varias líneas `data:` —que se unen con
 * salto de línea, como manda el formato— y campos que no se usan, como
 * `event:`. Un bloque que no es JSON o que no cumple `partyEventSchema` se
 * descarta entero: es un evento de otro protocolo o de una versión futura, y
 * pintarlo con campos en `undefined` sería peor que no pintarlo.
 */
function eventOfBlock(block: string): PartyEvent | undefined {
  const datos: string[] = []

  for (const linea of block.split('\n')) {
    if (linea === '' || linea.startsWith(':')) continue

    const dosPuntos = linea.indexOf(':')
    const campo = dosPuntos === -1 ? linea : linea.slice(0, dosPuntos)
    let valor = dosPuntos === -1 ? '' : linea.slice(dosPuntos + 1)

    // El formato permite exactamente un espacio después de los dos puntos.
    if (valor.startsWith(' ')) valor = valor.slice(1)
    if (campo === 'data') datos.push(valor)
  }

  if (datos.length === 0) return undefined

  let crudo: unknown
  try {
    crudo = JSON.parse(datos.join('\n'))
  } catch {
    return undefined
  }

  const parsed = partyEventSchema.safeParse(crudo)

  return parsed.success ? parsed.data : undefined
}

/**
 * Analizador incremental de SSE.
 *
 * Un corte de red puede caer en mitad de un `data:`, así que se acumula y sólo
 * se entrega lo que ya tiene su línea en blanco. Los saltos se normalizan a
 * `\n` porque `\r\n` y `\r` también separan eventos en el formato.
 */
export function createPartyEventParser(): PartyEventParser {
  let buffer = ''

  return {
    push(chunk) {
      buffer = (buffer + chunk).replace(/\r\n?/g, '\n')

      const eventos: PartyEvent[] = []
      let corte = buffer.indexOf('\n\n')

      while (corte !== -1) {
        const evento = eventOfBlock(buffer.slice(0, corte))
        if (evento !== undefined) eventos.push(evento)
        buffer = buffer.slice(corte + 2)
        corte = buffer.indexOf('\n\n')
      }

      return eventos
    },
  }
}

/** Los eventos de una respuesta, según van llegando, sin esperar al final. */
export async function* readEventStream(
  path: string,
  options: PartyRequestOptions = {},
): AsyncGenerator<PartyEvent> {
  // Sin límite: el flujo dura lo que dure la sala y el `AbortSignal` de quien lo
  // pidió es lo que decide cuándo se corta.
  const respuesta = await sameOriginRequest(path, { method: 'GET' }, options, 0)
  const body = respuesta.body
  if (body === null) return

  const reader = body.getReader()
  const decoder = new TextDecoder()
  const parser = createPartyEventParser()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      for (const evento of parser.push(decoder.decode(value, { stream: true }))) yield evento
    }
  } finally {
    // El `AbortSignal` cancela la lectura; soltar el lector evita dejar el
    // cuerpo bloqueado cuando el efecto que lo pidió ya no existe.
    reader.releaseLock()
  }
}
