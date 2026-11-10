/**
 * Watch party: contrato compartido de la sala.
 *
 * Sólo estado de reproducción. Ni vídeo, ni tickets, ni URLs de stream: lo que
 * viaja es «qué se ve», «por dónde va» y «desde cuándo», y cada participante
 * resuelve el episodio en su propia instancia.
 *
 * Aquí no hay red ni relojes reales. Las funciones de sincronización son puras
 * para poder probarlas con un reloj simulado: el error de una corrección de
 * deriva no se mide mirando un vídeo, se mide con dos relojes.
 */

import { z } from 'zod'

/** Versión del protocolo. Un cambio incompatible sube este número. */
export const PARTY_PROTOCOL_VERSION = 1

/** Tope de participantes por sala. */
export const PARTY_MAX_PARTICIPANTS = 8

/** Tope de salas simultáneas por instancia. */
export const PARTY_MAX_ROOMS = 4

/** Vida por defecto de una sala: cuatro horas. */
export const PARTY_DEFAULT_TTL_MS = 4 * 60 * 60 * 1000

/** Vida máxima que se puede pedir. */
export const PARTY_MAX_TTL_MS = 12 * 60 * 60 * 1000

/** Longitud del código de sala, en caracteres. */
export const PARTY_CODE_LENGTH = 16

/** Tope del nombre que el invitado escribe: es texto, no un perfil. */
export const PARTY_MAX_NAME_LENGTH = 32

/** Tope del título que viaja en la sala. */
export const PARTY_MAX_TITLE_LENGTH = 200

/** Tope de un mensaje o cuerpo de la API de sala. */
export const PARTY_MAX_MESSAGE_BYTES = 4096

/** Intentos de entrar fallidos por sala antes de enfriar. */
export const PARTY_JOIN_ATTEMPTS = 5

/** Ventana de esos intentos. */
export const PARTY_JOIN_WINDOW_MS = 60_000

/** Cada cuánto late la posición mientras se reproduce, y cada cuánto se reporta. */
export const PARTY_HEARTBEAT_MS = 15_000
export const PARTY_REPORT_INTERVAL_MS = 2_000

/** Deriva tolerada: por debajo no se toca el reproductor. */
export const PARTY_DRIFT_OK_S = 0.5

/** Por encima de esto se salta; entre los dos umbrales se ajusta la velocidad. */
export const PARTY_DRIFT_SEEK_S = 1.5
export const PARTY_DRIFT_RATE_S = 0.15

/** Cuánto se separa la velocidad del valor del anfitrión al corregir. */
export const PARTY_RATE_DELTA = 0.05

/** Tope de posición, para que un mensaje hostil no pida un salto absurdo. */
export const PARTY_MAX_POSITION_S = 24 * 60 * 60

/**
 * Mensajes por segundo y participante.
 *
 * Un invitado manda un reporte cada dos segundos y mide el reloj con cinco
 * muestras al entrar; diez por segundo deja margen a un pico y corta una
 * inundación. El anfitrión no pasa por este contador: su navegador es la
 * autoridad y comparte origen con el coordinador.
 */
export const PARTY_MESSAGES_PER_SECOND = 10

/** Alfabeto de Crockford: sin I, L, O ni U, que se confunden al dictar. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const PARTY_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{16}$/

/**
 * Lo que se está viendo, sin ninguna referencia de proveedor.
 *
 * El invitado no recibe con qué resolver el episodio: recibe cómo se llama para
 * poder abrirlo él mismo. Compartir `providerId`/`ref` sería compartir la fuente,
 * y eso es justo lo que la sala no hace.
 */
export const partyMediaSchema = z
  .strictObject({
    kind: z.enum(['episode', 'movie']),
    title: z.string().trim().min(1).max(PARTY_MAX_TITLE_LENGTH),
    episode: z.number().int().min(1).max(100_000).optional(),
    season: z.number().int().min(1).max(1_000).optional(),
    episodeTitle: z.string().trim().min(1).max(PARTY_MAX_TITLE_LENGTH).optional(),
    durationS: z.number().min(0).max(PARTY_MAX_POSITION_S).optional(),
  })
  .superRefine((media, ctx) => {
    if (media.kind === 'episode' && media.episode === undefined) {
      ctx.addIssue({ code: 'custom', message: 'un episodio necesita número' })
    }
    if (media.kind === 'movie' && media.episode !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'una película no tiene episodios' })
    }
  })

/** El estado que publica el anfitrión. `seq` y `atMs` los pone el coordinador. */
export const partyHostStateSchema = z.strictObject({
  media: partyMediaSchema,
  positionS: z.number().min(0).max(PARTY_MAX_POSITION_S),
  paused: z.boolean(),
  rate: z.number().min(0.25).max(4),
})

/** El estado que ven los invitados: lo de arriba más el sello del servidor. */
export const partyStateSchema = partyHostStateSchema.extend({
  seq: z.number().int().nonnegative(),
  /** Reloj monótono del coordinador, en milisegundos. */
  atMs: z.number().int().nonnegative(),
})

/** Un participante tal y como lo ve el resto. Sin IP, sin token, sin historial. */
export const partyParticipantSchema = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(PARTY_MAX_NAME_LENGTH),
  ready: z.boolean(),
  buffering: z.boolean(),
})

export const partyRosterSchema = z.array(partyParticipantSchema).max(PARTY_MAX_PARTICIPANTS)

export const partyClosedReasonSchema = z.enum(['host-left', 'expired', 'closed'])

/** Lo que el coordinador manda por SSE. */
export const partyEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('welcome'),
    protocol: z.literal(PARTY_PROTOCOL_VERSION),
    roomId: z.string().min(1).max(64),
    expiresAt: z.number().int().positive(),
    state: partyStateSchema.nullable(),
    roster: partyRosterSchema,
  }),
  z.strictObject({ type: z.literal('state'), state: partyStateSchema }),
  z.strictObject({ type: z.literal('roster'), roster: partyRosterSchema }),
  z.strictObject({ type: z.literal('ping'), atMs: z.number().int().nonnegative() }),
  z.strictObject({ type: z.literal('closed'), reason: partyClosedReasonSchema }),
])

/** Lo que manda el invitado al coordinador por HTTP. */
export const partyReportSchema = z.strictObject({
  positionS: z.number().min(0).max(PARTY_MAX_POSITION_S),
  paused: z.boolean(),
  buffering: z.boolean(),
  ready: z.boolean(),
})

export const partySyncRequestSchema = z.strictObject({
  t0: z.number().int().nonnegative(),
})

export const partySyncReplySchema = z.strictObject({
  t0: z.number().int().nonnegative(),
  /** Cuando el servidor recibió la petición. */
  t1: z.number().int().nonnegative(),
  /** Cuando la contestó. Casi siempre t1; va aparte por si el manejador tarda. */
  t2: z.number().int().nonnegative(),
})

export const partyCreateRoomSchema = z.strictObject({
  /** Vida pedida; se acota a `PARTY_MAX_TTL_MS`. */
  ttlMs: z.number().int().min(60_000).max(PARTY_MAX_TTL_MS).optional(),
})

export const partyCreateRoomResponseSchema = z.strictObject({
  roomId: z.string().min(1).max(64),
  code: z.string().regex(PARTY_CODE_RE),
  expiresAt: z.number().int().positive(),
})

export const partyJoinRequestSchema = z.strictObject({
  code: z.string().min(1).max(32),
  name: z.string().trim().min(1).max(PARTY_MAX_NAME_LENGTH),
})

/**
 * Lo que el invitado teclea para enlazar con el anfitrión.
 *
 * `baseUrl` se valida y normaliza en su propio servidor (el del invitado), que
 * es quien habla con el anfitrión: la pestaña no cruza orígenes, así que el CSP
 * de la aplicación no se relaja y no hay CORS ni cookies de terceros.
 */
export const partyRemoteJoinRequestSchema = z.strictObject({
  baseUrl: z.string().trim().min(1).max(300),
  code: z.string().min(1).max(32),
  name: z.string().trim().min(1).max(PARTY_MAX_NAME_LENGTH),
})

/** Lo que el servidor del invitado devuelve a su propia pestaña (sin token). */
export const partyRemoteSnapshotSchema = z.strictObject({
  roomId: z.string().min(1).max(64),
  expiresAt: z.number().int().positive(),
  state: partyStateSchema.nullable(),
  roster: partyRosterSchema,
})

export const partyJoinResponseSchema = z.strictObject({
  roomId: z.string().min(1).max(64),
  token: z.string().min(32).max(128),
  expiresAt: z.number().int().positive(),
  state: partyStateSchema.nullable(),
  roster: partyRosterSchema,
})

export const partyRoomSummarySchema = z.strictObject({
  roomId: z.string().min(1).max(64),
  code: z.string().regex(PARTY_CODE_RE),
  expiresAt: z.number().int().positive(),
  participants: z.number().int().nonnegative(),
})

export const partyRoomsResponseSchema = z.strictObject({
  rooms: z.array(partyRoomSummarySchema),
})

/** Las direcciones de esta instancia que un invitado puede escribir. */
export const partyInfoResponseSchema = z.strictObject({
  port: z.number().int().min(1).max(65_535),
  urls: z.array(z.string().url()),
})

export type PartyMedia = z.infer<typeof partyMediaSchema>
export type PartyHostState = z.infer<typeof partyHostStateSchema>
export type PartyState = z.infer<typeof partyStateSchema>
export type PartyParticipant = z.infer<typeof partyParticipantSchema>
export type PartyRoster = z.infer<typeof partyRosterSchema>
export type PartyEvent = z.infer<typeof partyEventSchema>
export type PartyReport = z.infer<typeof partyReportSchema>
export type PartyCreateRoomResponse = z.infer<typeof partyCreateRoomResponseSchema>
export type PartyJoinResponse = z.infer<typeof partyJoinResponseSchema>
export type PartyRemoteJoinRequest = z.infer<typeof partyRemoteJoinRequestSchema>
export type PartyRemoteSnapshot = z.infer<typeof partyRemoteSnapshotSchema>
export type PartyRoomSummary = z.infer<typeof partyRoomSummarySchema>
export type PartyInfoResponse = z.infer<typeof partyInfoResponseSchema>

/** Una muestra del reloj: cliente envía, servidor recibe, servidor contesta, cliente recibe. */
export interface PartyClockSample {
  readonly t0: number
  readonly t1: number
  readonly t2: number
  readonly t3: number
}

/**
 * Desfase del reloj del coordinador respecto al del cliente, en milisegundos.
 *
 * Se queda con la mediana de las muestras: una sola ida y vuelta con un pico de
 * latencia movería la estimación más que cinco normales. `t2` se acepta pero no
 * se usa: la respuesta se sella al contestar y el cliente mide con `t3`, que es
 * lo que puede observar.
 */
export function partyClockOffset(samples: readonly PartyClockSample[]): number {
  const estimaciones = samples
    .map((sample) => sample.t1 - (sample.t0 + sample.t3) / 2)
    .sort((a, b) => a - b)

  if (estimaciones.length === 0) return 0

  const mitad = Math.floor(estimaciones.length / 2)

  return estimaciones.length % 2 === 0
    ? ((estimaciones[mitad - 1] ?? 0) + (estimaciones[mitad] ?? 0)) / 2
    : (estimaciones[mitad] ?? 0)
}

/** Por dónde iría el vídeo del anfitrión en el instante `nowMs` del cliente. */
export function partyTargetPositionS(state: PartyState, nowMs: number, offsetMs: number): number {
  const transcurrido = Math.max(0, nowMs + offsetMs - state.atMs) / 1000
  const objetivo = state.paused ? state.positionS : state.positionS + transcurrido * state.rate

  return Math.min(Math.max(objetivo, 0), PARTY_MAX_POSITION_S)
}

/** Lo que hay que hacerle al `<video>` del invitado, si algo. */
export type PartyCorrection =
  | { readonly kind: 'none' }
  | { readonly kind: 'play'; readonly targetS: number }
  | { readonly kind: 'pause'; readonly targetS: number }
  | { readonly kind: 'seek'; readonly targetS: number }
  | { readonly kind: 'rate'; readonly targetS: number; readonly rate: number }

/**
 * La corrección del invitado contra el estado del anfitrión.
 *
 * Primero lo que se nota en la cara: pausa, reproducción y saltos grandes.
 * Sólo si la deriva es pequeña se toca la velocidad, y se deja volver a 1 sola
 * cuando ya no hace falta: un ajuste de velocidad permanente convierte el
 * episodio en una cinta acelerada.
 */
export function partyCorrection(input: {
  readonly currentS: number
  readonly paused: boolean
  readonly state: PartyState
  readonly nowMs: number
  readonly offsetMs: number
}): PartyCorrection {
  const objetivo = partyTargetPositionS(input.state, input.nowMs, input.offsetMs)

  if (input.state.paused) {
    if (Math.abs(objetivo - input.currentS) > 0.1) {
      return { kind: 'seek', targetS: objetivo }
    }

    return input.paused ? { kind: 'none' } : { kind: 'pause', targetS: objetivo }
  }

  if (input.paused) return { kind: 'play', targetS: objetivo }

  const deriva = objetivo - input.currentS

  if (Math.abs(deriva) > PARTY_DRIFT_SEEK_S) {
    return { kind: 'seek', targetS: objetivo }
  }

  if (Math.abs(deriva) > PARTY_DRIFT_RATE_S) {
    const base = input.state.rate
    const rate = Math.min(
      Math.max(base + (deriva > 0 ? PARTY_RATE_DELTA : -PARTY_RATE_DELTA), 0.25),
      4,
    )

    return { kind: 'rate', targetS: objetivo, rate }
  }

  return { kind: 'none' }
}

/** `true` si el código tiene la forma que se muestra al compartirlo. */
export function isRoomCode(value: string): boolean {
  return PARTY_CODE_RE.test(value)
}

/**
 * Código tecleado por una persona, o `undefined` si no es uno.
 *
 * Se aceptan minúsculas, espacios y guiones porque el código se dicta y se pega
 * de un mensaje. Crockford manda I/L a 1 y O a 0; se aplica aquí para que un
 * código con esas letras siga entrando en vez de rechazarse por una errata.
 */
export function normalizeRoomCode(raw: string): string | undefined {
  const limpio = raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, '')

  if (limpio.length !== PARTY_CODE_LENGTH) return undefined
  if (!PARTY_CODE_RE.test(limpio)) return undefined

  return limpio
}

/** El código en grupos de cuatro, que es como se lee y se copia. */
export function formatRoomCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code
}

/**
 * La dirección del anfitrión, tal y como se puede usar para hablar con él.
 *
 * Acepta lo que una persona escribe —`192.168.1.5:7717`— y devuelve un origen
 * `http://192.168.1.5:7717`. Rechaza esquemas que no son HTTP, credenciales
 * embebidas y rutas: la base de la sala es un origen, no una URL cualquiera.
 * Quien llama a esto decide si la usa; el invitado la usa desde su servidor,
 * nunca desde la pestaña.
 */
export function normalizePartyBaseUrl(raw: string): string | undefined {
  const value = raw.trim()
  if (value === '') return undefined

  const conEsquema = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`

  let url: URL
  try {
    url = new URL(conEsquema)
  } catch {
    return undefined
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (url.username !== '' || url.password !== '') return undefined
  if (url.pathname !== '/' && url.pathname !== '') return undefined
  if (url.search !== '' || url.hash !== '') return undefined
  if (url.hostname === '') return undefined

  return url.origin
}

/**
 * Un código a partir de 10 bytes (80 bits) de entropía.
 *
 * Diez bytes y no menos: el código es la credencial de entrada y se puede
 * probar por fuerza bruta en una LAN. El límite de intentos ayuda, pero la
 * entropía es lo que lo hace inviable.
 */
export function roomCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length < 10) throw new RangeError('hacen falta diez bytes para un código')

  let bits = 0
  let valor = 0
  let salida = ''

  for (const byte of bytes) {
    valor = (valor << 8) | byte
    bits += 8

    while (bits >= 5) {
      bits -= 5
      salida += CROCKFORD[(valor >>> bits) & 31]
      valor &= (1 << bits) - 1
    }
  }

  return salida.slice(0, PARTY_CODE_LENGTH)
}
