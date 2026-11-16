/**
 * Salas del watch party, en memoria.
 *
 * No hay base de datos: una sala es un objeto que vive mientras el proceso y
 * mientras su caducidad no la cierre. Guardar el historial de quién entró y
 * cuándo sería exactamente la clase de dato que la aplicación no recoge.
 *
 * La credencial del invitado se guarda como hash SHA-256 y se compara en tiempo
 * constante. En memoria sobra con no tener el token en claro; si el proceso se
 * vuelca, lo que aparece son hashes.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  normalizeRoomCode,
  PARTY_DEFAULT_TTL_MS,
  PARTY_JOIN_ATTEMPTS,
  PARTY_JOIN_WINDOW_MS,
  PARTY_MAX_PARTICIPANTS,
  PARTY_MAX_ROOMS,
  PARTY_MAX_TTL_MS,
  PARTY_MESSAGES_PER_SECOND,
  type PartyEvent,
  type PartyHostState,
  type PartyJoinResponse,
  type PartyParticipant,
  type PartyReport,
  type PartyRoomSummary,
  type PartyState,
  roomCodeFromBytes,
} from '@nn-anime/core'

/** Por qué no se pudo abrir una sala nueva. */
export type PartyCreateFailure = 'too-many-rooms'

/** Por qué no se pudo entrar a una sala. */
export type PartyJoinFailure = 'not-found' | 'full' | 'rate-limited'

export type PartyCreateResult =
  | {
      readonly ok: true
      readonly roomId: string
      readonly code: string
      readonly expiresAt: number
    }
  | { readonly ok: false; readonly reason: PartyCreateFailure }

export type PartyJoinResult =
  | ({ readonly ok: true } & PartyJoinResponse)
  | { readonly ok: false; readonly reason: PartyJoinFailure }

export type PartyReportResult = 'ok' | 'missing' | 'rate-limited'

export interface PartyStoreOptions {
  /** Reloj monótono en milisegundos. En pruebas, uno de mentira. */
  readonly now?: () => number
  /** Vida por defecto de una sala. */
  readonly ttlMs?: number
  readonly maxRooms?: number
  /** Bytes aleatorios. En pruebas se inyectan para que un código sea estable. */
  readonly random?: (size: number) => Uint8Array
}

export interface PartySnapshot {
  readonly expiresAt: number
  readonly state: PartyState | null
  readonly roster: PartyParticipant[]
}

interface ParticipantRecord {
  readonly id: string
  readonly name: string
  readonly tokenHash: string
  ready: boolean
  buffering: boolean
  /** Marcas de los últimos mensajes, para el límite por participante. */
  readonly messages: number[]
}

export interface RoomRecord {
  readonly roomId: string
  readonly code: string
  readonly codeHash: string
  readonly expiresAt: number
  seq: number
  state: PartyState | null
  readonly participants: Map<string, ParticipantRecord>
  readonly subscribers: Set<(event: PartyEvent) => void>
}

/**
 * Intentos de entrada por ventana, en toda la instancia.
 *
 * El spec pedía cinco por minuto y por IP. El adaptador HTTP actual no expone
 * una dirección remota fiable (el servidor recibe `request` y nada más), así
 * que el límite es de instancia: veinte por minuto para todas las salas. Con un
 * código de 80 bits, veinte intentos por minuto no acercan la fuerza bruta a
 * ninguna parte; y sin límite por IP no se puede distinguir un invitado
 * equivocado de un escáner.
 */
const JOIN_ATTEMPTS_PER_WINDOW = PARTY_JOIN_ATTEMPTS * 4

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Compara dos hashes hexadecimales sin filtrar el prefijo por tiempo. */
function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')

  return a.length === b.length && timingSafeEqual(a, b)
}

export class PartyStore {
  readonly #rooms = new Map<string, RoomRecord>()
  readonly #roomsByCode = new Map<string, string>()
  readonly #joinAttempts: number[] = []
  readonly #now: () => number
  readonly #ttlMs: number
  readonly #maxRooms: number
  readonly #random: (size: number) => Uint8Array

  constructor(options: PartyStoreOptions = {}) {
    this.#now = options.now ?? (() => performance.now())
    this.#ttlMs = options.ttlMs ?? PARTY_DEFAULT_TTL_MS
    this.#maxRooms = options.maxRooms ?? PARTY_MAX_ROOMS
    this.#random = options.random ?? ((size) => new Uint8Array(randomBytes(size)))
  }

  now(): number {
    return this.#now()
  }

  has(roomId: string): boolean {
    this.#sweep()

    return this.#rooms.has(roomId)
  }

  createRoom(ttlMs?: number): PartyCreateResult {
    this.#sweep()

    if (this.#rooms.size >= this.#maxRooms) {
      return { ok: false, reason: 'too-many-rooms' }
    }

    const ttl = Math.min(Math.max(ttlMs ?? this.#ttlMs, 60_000), PARTY_MAX_TTL_MS)
    const roomId = Buffer.from(this.#random(16)).toString('base64url')
    const code = roomCodeFromBytes(this.#random(10))
    const expiresAt = this.#now() + ttl
    const room: RoomRecord = {
      roomId,
      code,
      codeHash: hashToken(code),
      expiresAt,
      seq: 0,
      state: null,
      participants: new Map(),
      subscribers: new Set(),
    }

    this.#rooms.set(roomId, room)
    this.#roomsByCode.set(room.codeHash, roomId)

    return { ok: true, roomId, code, expiresAt }
  }

  /** Las salas de este proceso, para que el anfitrión recupere la suya. */
  listRooms(): readonly PartyRoomSummary[] {
    this.#sweep()

    return [...this.#rooms.values()].map((room) => ({
      roomId: room.roomId,
      code: room.code,
      expiresAt: room.expiresAt,
      participants: room.participants.size,
    }))
  }

  closeRoom(roomId: string, reason: 'closed' | 'host-left' = 'closed'): boolean {
    const room = this.#rooms.get(roomId)
    if (room === undefined) return false

    this.#emit(room, { type: 'closed', reason })
    this.#rooms.delete(roomId)
    this.#roomsByCode.delete(room.codeHash)

    return true
  }

  join(codeRaw: string, name: string): PartyJoinResult {
    this.#sweep()
    this.#recordJoinAttempt()

    const intentos = this.#joinAttempts.filter(
      (marca) => this.#now() - marca < PARTY_JOIN_WINDOW_MS,
    )
    if (intentos.length >= JOIN_ATTEMPTS_PER_WINDOW) {
      return { ok: false, reason: 'rate-limited' }
    }

    const code = normalizeRoomCode(codeRaw)
    if (code === undefined) return { ok: false, reason: 'not-found' }

    const roomId = this.#roomsByCode.get(hashToken(code))
    if (roomId === undefined) return { ok: false, reason: 'not-found' }

    const room = this.#rooms.get(roomId)
    if (room === undefined) return { ok: false, reason: 'not-found' }
    if (room.participants.size >= PARTY_MAX_PARTICIPANTS) {
      return { ok: false, reason: 'full' }
    }

    const id = Buffer.from(this.#random(9)).toString('base64url')
    const token = Buffer.from(this.#random(32)).toString('base64url')
    const participant: ParticipantRecord = {
      id,
      name,
      tokenHash: hashToken(token),
      ready: false,
      buffering: false,
      messages: [],
    }

    room.participants.set(id, participant)
    this.#emit(room, { type: 'roster', roster: this.#roster(room) })

    return {
      ok: true,
      roomId: room.roomId,
      token,
      expiresAt: room.expiresAt,
      state: room.state,
      roster: this.#roster(room),
    }
  }

  /** El participante que presenta este token, si la sala y el token son válidos. */
  authorize(
    roomId: string,
    token: string,
  ): { readonly room: RoomRecord; readonly participant: ParticipantRecord } | undefined {
    this.#sweep()

    const room = this.#rooms.get(roomId)
    if (room === undefined) return undefined

    const hash = hashToken(token)
    for (const participant of room.participants.values()) {
      if (sameHash(participant.tokenHash, hash)) return { room, participant }
    }

    return undefined
  }

  snapshot(roomId: string): PartySnapshot | undefined {
    this.#sweep()

    const room = this.#rooms.get(roomId)
    if (room === undefined) return undefined

    return {
      expiresAt: room.expiresAt,
      state: room.state,
      roster: this.#roster(room),
    }
  }

  subscribe(roomId: string, listener: (event: PartyEvent) => void): (() => void) | undefined {
    this.#sweep()

    const room = this.#rooms.get(roomId)
    if (room === undefined) return undefined

    room.subscribers.add(listener)

    return () => room.subscribers.delete(listener)
  }

  /**
   * Publica el estado autoritativo del anfitrión.
   *
   * El sello `atMs` lo pone el coordinador y no el anfitrión: es el reloj contra
   * el que los invitados miden su desfase, y confiar en el reloj de un cliente
   * sería confiar en un dato que no se puede comprobar.
   */
  publishState(roomId: string, input: PartyHostState): PartyState | undefined {
    this.#sweep()

    const room = this.#rooms.get(roomId)
    if (room === undefined) return undefined

    room.seq += 1
    room.state = { ...input, seq: room.seq, atMs: this.#now() }
    this.#emit(room, { type: 'state', state: room.state })

    return room.state
  }

  report(roomId: string, participantId: string, report: PartyReport): PartyReportResult {
    this.#sweep()

    const room = this.#rooms.get(roomId)
    const participant = room?.participants.get(participantId)
    if (room === undefined || participant === undefined) return 'missing'
    if (!this.#allowMessage(participant)) return 'rate-limited'

    const cambiado =
      participant.ready !== report.ready || participant.buffering !== report.buffering
    participant.ready = report.ready
    participant.buffering = report.buffering

    if (cambiado) this.#emit(room, { type: 'roster', roster: this.#roster(room) })

    return 'ok'
  }

  /** Comprueba el límite de mensajes de un participante (para `sync`, por ejemplo). */
  allowParticipantMessage(roomId: string, participantId: string): boolean {
    this.#sweep()

    const room = this.#rooms.get(roomId)
    const participant = room?.participants.get(participantId)
    if (participant === undefined) return false

    return this.#allowMessage(participant)
  }

  sync(roomId: string): { readonly t1: number; readonly t2: number } | undefined {
    this.#sweep()

    if (!this.#rooms.has(roomId)) return undefined

    const t1 = this.#now()

    return { t1, t2: this.#now() }
  }

  leave(roomId: string, participantId: string): boolean {
    this.#sweep()

    const room = this.#rooms.get(roomId)
    if (room === undefined) return false
    if (!room.participants.delete(participantId)) return false

    this.#emit(room, { type: 'roster', roster: this.#roster(room) })

    return true
  }

  /** Cierra las salas caducadas. También se llama antes de cada operación. */
  sweep(): void {
    this.#sweep()
  }

  #sweep(): void {
    for (const room of [...this.#rooms.values()]) {
      if (room.expiresAt > this.#now()) continue

      this.#emit(room, { type: 'closed', reason: 'expired' })
      this.#rooms.delete(room.roomId)
      this.#roomsByCode.delete(room.codeHash)
    }
  }

  #roster(room: RoomRecord): PartyParticipant[] {
    return [...room.participants.values()].map((participant) => ({
      id: participant.id,
      name: participant.name,
      ready: participant.ready,
      buffering: participant.buffering,
    }))
  }

  #emit(room: RoomRecord, event: PartyEvent): void {
    for (const subscriber of [...room.subscribers]) {
      try {
        subscriber(event)
      } catch {
        // Un consumidor roto no puede tumbar la sala ni a los demás.
        room.subscribers.delete(subscriber)
      }
    }
  }

  #recordJoinAttempt(): void {
    const ahora = this.#now()

    this.#joinAttempts.push(ahora)
    while (
      this.#joinAttempts.length > 0 &&
      ahora - (this.#joinAttempts[0] ?? 0) >= PARTY_JOIN_WINDOW_MS
    ) {
      this.#joinAttempts.shift()
    }
  }

  #allowMessage(participant: ParticipantRecord): boolean {
    const ahora = this.#now()

    while (participant.messages.length > 0 && ahora - (participant.messages[0] ?? 0) >= 1_000) {
      participant.messages.shift()
    }

    if (participant.messages.length >= PARTY_MESSAGES_PER_SECOND) return false

    participant.messages.push(ahora)

    return true
  }
}
