/**
 * El invitado, desde su propio servidor.
 *
 * La pestaña del invitado no habla con el anfitrión: su servidor sí. Tres cosas
 * se ganan con eso y ninguna es cosmética:
 *
 * 1. El CSP sigue siendo `connect-src 'self'`; no hay que abrirlo a la LAN.
 * 2. No hay CORS ni cookie de terceros: la pestaña sólo consume su origen.
 * 3. El token del anfitrión se queda en la memoria del servidor local, no en la
 *    del navegador.
 *
 * Lo que el usuario teclea es una dirección a la que su propio servidor se
 * conecta. No hay redirecciones, ni proxy de contenido, ni URL arbitraria: sólo
 * se componen las rutas fijas de la API de sala sobre el origen validado.
 */

import {
  normalizePartyBaseUrl,
  PARTY_MAX_MESSAGE_BYTES,
  PARTY_PROTOCOL_VERSION,
  type PartyEvent,
  type PartyJoinResponse,
  type PartyRemoteSnapshot,
  type PartyReport,
  partyEventSchema,
  partyJoinResponseSchema,
  partyRemoteJoinRequestSchema,
  partyReportSchema,
  partySyncReplySchema,
  partySyncRequestSchema,
} from '@nn-anime/core'
import type { Hono } from 'hono'

/** `fetch` inyectable: las pruebas no salen a la red. */
export type PartyFetch = (input: string, init?: RequestInit) => Promise<Response>

export type RemoteJoinFailure =
  | 'invalid-base'
  | 'not-found'
  | 'full'
  | 'rate-limited'
  | 'unavailable'

export type RemoteJoinResult =
  | { readonly ok: true; readonly snapshot: PartyRemoteSnapshot }
  | { readonly ok: false; readonly reason: RemoteJoinFailure }

export type RemoteReportResult = 'ok' | 'no-link' | 'rate-limited' | 'failed'

export interface RemotePartyOptions {
  readonly fetchImpl?: PartyFetch
  readonly now?: () => number
  /** Espera antes de reintentar el SSE del anfitrión. */
  readonly retryMs?: number
  /** Tiempo límite de las peticiones que no son el flujo SSE. */
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_RETRY_MS = 1_000
const MAX_JSON_BYTES = 32 * 1024

interface RemoteLink {
  readonly baseUrl: string
  readonly roomId: string
  readonly token: string
  readonly expiresAt: number
  readonly name: string
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function leerJson<T>(
  response: Response,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
): Promise<T | undefined> {
  const texto = await response.text()
  if (texto.length > MAX_JSON_BYTES) return undefined

  try {
    const parsed = schema.safeParse(JSON.parse(texto))

    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export class RemoteParty {
  readonly #fetch: PartyFetch
  readonly #now: () => number
  readonly #retryMs: number
  readonly #timeoutMs: number
  readonly #subscribers = new Set<(event: PartyEvent) => void>()

  #link: RemoteLink | undefined
  #snapshot: PartyRemoteSnapshot | undefined
  #controller: AbortController | undefined
  #running = false

  constructor(options: RemotePartyOptions = {}) {
    this.#fetch = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
    this.#now = options.now ?? (() => Date.now())
    this.#retryMs = options.retryMs ?? DEFAULT_RETRY_MS
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  snapshot(): PartyRemoteSnapshot | undefined {
    return this.#snapshot
  }

  hasLink(): boolean {
    return this.#link !== undefined
  }

  async join(input: {
    readonly baseUrl: string
    readonly code: string
    readonly name: string
  }): Promise<RemoteJoinResult> {
    const baseUrl = normalizePartyBaseUrl(input.baseUrl)
    if (baseUrl === undefined) return { ok: false, reason: 'invalid-base' }

    let response: Response
    try {
      response = await this.#fetch(`${baseUrl}/api/party/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ code: input.code, name: input.name }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs),
      })
    } catch {
      return { ok: false, reason: 'unavailable' }
    }

    if (response.status === 404) return { ok: false, reason: 'not-found' }
    if (response.status === 409) return { ok: false, reason: 'full' }
    if (response.status === 429) return { ok: false, reason: 'rate-limited' }
    if (!response.ok) return { ok: false, reason: 'unavailable' }

    const entrada = await leerJson<PartyJoinResponse>(response, partyJoinResponseSchema)
    if (entrada === undefined) return { ok: false, reason: 'unavailable' }

    this.#detener()
    this.#link = {
      baseUrl,
      roomId: entrada.roomId,
      token: entrada.token,
      expiresAt: entrada.expiresAt,
      name: input.name,
    }
    this.#snapshot = {
      roomId: entrada.roomId,
      expiresAt: entrada.expiresAt,
      state: entrada.state,
      roster: entrada.roster,
    }

    void this.#bucle()

    return { ok: true, snapshot: this.#snapshot }
  }

  subscribe(listener: (event: PartyEvent) => void): () => void {
    this.#subscribers.add(listener)

    if (this.#snapshot !== undefined) {
      listener({
        type: 'welcome',
        protocol: PARTY_PROTOCOL_VERSION,
        roomId: this.#snapshot.roomId,
        expiresAt: this.#snapshot.expiresAt,
        state: this.#snapshot.state,
        roster: this.#snapshot.roster,
      })
    }

    return () => this.#subscribers.delete(listener)
  }

  async report(report: PartyReport): Promise<RemoteReportResult> {
    const link = this.#link
    if (link === undefined) return 'no-link'

    try {
      const response = await this.#fetch(`${link.baseUrl}/api/party/rooms/${link.roomId}/report`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${link.token}`,
        },
        body: JSON.stringify(partyReportSchema.parse(report)),
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs),
      })

      if (response.status === 429) return 'rate-limited'
      if (response.status === 401 || response.status === 404) {
        this.#cerrar('host-left')

        return 'failed'
      }

      return response.ok ? 'ok' : 'failed'
    } catch {
      return 'failed'
    }
  }

  async sync(t0: number): Promise<{ t0: number; t1: number; t2: number } | undefined> {
    const link = this.#link
    if (link === undefined) return undefined

    try {
      const response = await this.#fetch(`${link.baseUrl}/api/party/rooms/${link.roomId}/sync`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${link.token}`,
        },
        body: JSON.stringify({ t0 }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs),
      })

      if (!response.ok) return undefined

      return await leerJson(response, partySyncReplySchema)
    } catch {
      return undefined
    }
  }

  async leave(): Promise<void> {
    const link = this.#link
    if (link === undefined) return

    this.#detener()

    try {
      await this.#fetch(`${link.baseUrl}/api/party/rooms/${link.roomId}/leave`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${link.token}`,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs),
      })
    } catch {
      // Salir es best-effort: la sala caduca sola.
    }

    this.#cerrar('closed')
  }

  #detener(): void {
    this.#controller?.abort()
    this.#controller = undefined
    this.#link = undefined
  }

  #cerrar(reason: 'host-left' | 'expired' | 'closed'): void {
    this.#detener()
    this.#snapshot = undefined
    this.#emitir({ type: 'closed', reason })
  }

  async #bucle(): Promise<void> {
    if (this.#running) return
    this.#running = true

    try {
      while (this.#link !== undefined) {
        const link = this.#link
        const controller = new AbortController()
        this.#controller = controller

        try {
          const response = await this.#fetch(
            `${link.baseUrl}/api/party/rooms/${link.roomId}/events`,
            {
              headers: {
                accept: 'text/event-stream',
                authorization: `Bearer ${link.token}`,
              },
              signal: controller.signal,
              redirect: 'error',
            },
          )

          if (response.status === 401 || response.status === 404) {
            this.#cerrar('host-left')

            return
          }
          if (!response.ok || response.body === null) throw new Error(`SSE ${response.status}`)

          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let resto = ''

          try {
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break

              resto += decoder.decode(value, { stream: true })

              let corte = resto.indexOf('\n\n')
              while (corte !== -1) {
                const bloque = resto.slice(0, corte)
                resto = resto.slice(corte + 2)
                this.#procesar(bloque)
                corte = resto.indexOf('\n\n')
              }
            }
          } finally {
            await reader.cancel().catch(() => undefined)
          }
        } catch {
          if (controller.signal.aborted) return
        }

        if (this.#link === undefined) return

        if (this.#now() >= this.#link.expiresAt) {
          this.#cerrar('expired')

          return
        }

        await esperar(this.#retryMs)
      }
    } finally {
      this.#running = false
    }
  }

  #procesar(bloque: string): void {
    const linea = bloque.split('\n').find((candidata) => candidata.startsWith('data: '))

    if (linea === undefined) return
    if (linea.length > PARTY_MAX_MESSAGE_BYTES + 8) return

    let crudo: unknown
    try {
      crudo = JSON.parse(linea.slice('data: '.length))
    } catch {
      return
    }

    const parsed = partyEventSchema.safeParse(crudo)
    if (!parsed.success) return

    const evento = parsed.data

    if (evento.type === 'welcome') {
      this.#snapshot = {
        roomId: evento.roomId,
        expiresAt: evento.expiresAt,
        state: evento.state,
        roster: evento.roster,
      }
    } else if (evento.type === 'state') {
      if (this.#snapshot !== undefined) {
        this.#snapshot = { ...this.#snapshot, state: evento.state }
      }
    } else if (evento.type === 'roster') {
      if (this.#snapshot !== undefined) {
        this.#snapshot = { ...this.#snapshot, roster: evento.roster }
      }
    } else if (evento.type === 'closed') {
      this.#cerrar(evento.reason === 'expired' ? 'expired' : 'host-left')

      return
    }

    this.#emitir(evento)
  }

  #emitir(evento: PartyEvent): void {
    for (const subscriber of [...this.#subscribers]) {
      try {
        subscriber(evento)
      } catch {
        this.#subscribers.delete(subscriber)
      }
    }
  }
}

export interface RemotePartyRoutesOptions {
  readonly relay?: RemoteParty
  readonly fetchImpl?: PartyFetch
  readonly now?: () => number
}

export function registerRemotePartyRoutes(
  app: Hono,
  options: RemotePartyRoutesOptions = {},
): RemoteParty {
  const relay =
    options.relay ??
    new RemoteParty({
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.now === undefined ? {} : { now: options.now }),
    })

  // Estas rutas las llama la pestaña del invitado a su propio servidor: las
  // cubre el guard de sesión normal, porque se registran después de él.

  app.post('/api/party/remote/join', async (c) => {
    const parsed = await c.req
      .json()
      .then((cuerpo) => partyRemoteJoinRequestSchema.safeParse(cuerpo))
      .catch(() => undefined)

    if (parsed === undefined || !parsed.success) {
      return c.json({ error: 'invalid-body' }, 400)
    }

    const resultado = await relay.join(parsed.data)

    if (!resultado.ok) {
      if (resultado.reason === 'invalid-base') return c.json({ error: 'invalid-base' }, 400)
      if (resultado.reason === 'not-found') return c.json({ error: 'not-found' }, 404)
      if (resultado.reason === 'full') return c.json({ error: 'full' }, 409)
      if (resultado.reason === 'rate-limited') return c.json({ error: 'rate-limited' }, 429)

      return c.json({ error: 'host-unavailable' }, 502)
    }

    return c.json(resultado.snapshot, 200)
  })

  app.get('/api/party/remote', (c) => {
    const snapshot = relay.snapshot()
    if (snapshot === undefined) return c.text('', 404)

    return c.json(snapshot)
  })

  app.get('/api/party/remote/events', (c) => {
    if (!relay.hasLink()) return c.text('', 404)

    const encoder = new TextEncoder()
    let enviar: (event: PartyEvent) => void = () => {}
    let terminado = false
    let timer: ReturnType<typeof setInterval> | undefined
    let baja: (() => void) | undefined

    const cleanup = (): void => {
      if (terminado) return

      terminado = true
      if (timer !== undefined) clearInterval(timer)
      c.req.raw.signal.removeEventListener('abort', cleanup)
      baja?.()
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        enviar = (event) => {
          if (terminado) return

          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch {
            cleanup()

            return
          }

          if (event.type === 'closed') {
            cleanup()
            try {
              controller.close()
            } catch {
              // Ya estaba cerrado.
            }
          }
        }

        // La suscripción va **después** de asignar `enviar`: `subscribe` entrega
        // el `welcome` de la instantánea en el acto, y suscribirse antes lo
        // mandaba a un `enviar` que todavía no hacía nada.
        baja = relay.subscribe((event) => enviar(event))

        // El reloj local del flujo: si el anfitrión tarda en mandar, el navegador
        // no se queda con una conexión muda que un proxy pueda cortar.
        timer = setInterval(() => {
          enviar({ type: 'ping', atMs: Math.floor(performance.now()) })
        }, 15_000)

        c.req.raw.signal.addEventListener('abort', cleanup)
      },
      cancel() {
        cleanup()
      },
    })

    return c.body(stream, 200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    })
  })

  app.post('/api/party/remote/report', async (c) => {
    const parsed = await c.req
      .json()
      .then((cuerpo) => partyReportSchema.safeParse(cuerpo))
      .catch(() => undefined)

    if (parsed === undefined || !parsed.success) {
      return c.json({ error: 'invalid-body' }, 400)
    }

    const resultado = await relay.report(parsed.data)

    if (resultado === 'no-link') return c.json({ error: 'no-link' }, 404)
    if (resultado === 'rate-limited') return c.json({ error: 'rate-limited' }, 429)
    if (resultado === 'failed') return c.json({ error: 'host-unavailable' }, 502)

    return c.body(null, 204)
  })

  app.post('/api/party/remote/sync', async (c) => {
    const parsed = await c.req
      .json()
      .then((cuerpo) => partySyncRequestSchema.safeParse(cuerpo))
      .catch(() => undefined)

    if (parsed === undefined || !parsed.success) {
      return c.json({ error: 'invalid-body' }, 400)
    }

    const reloj = await relay.sync(parsed.data.t0)
    if (reloj === undefined) {
      if (!relay.hasLink()) return c.json({ error: 'no-link' }, 404)

      return c.json({ error: 'host-unavailable' }, 502)
    }

    return c.json(reloj)
  })

  app.post('/api/party/remote/leave', async (c) => {
    await relay.leave()

    return c.body(null, 204)
  })

  return relay
}
