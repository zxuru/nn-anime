/**
 * Rutas HTTP de la sala.
 *
 * Se montan **antes** que los guards de `/api/*` a propósito: el invitado no
 * tiene la cookie de la aplicación, sino una credencial de sala. Por eso estas
 * rutas traen su propia comprobación y su propio CORS, y por eso el guard de
 * sesión y el de token no se aplican aquí. Lo que sí se aplica es el guard de
 * `Host` y las cabeceras de seguridad, que van montados sobre `*`.
 *
 * El anfitrión usa la cookie de siempre (mismo origen). El invitado usa un
 * `Authorization: Bearer` que vive sólo en la memoria de su pestaña: no hay
 * cookie de terceros, no hay CSRF y no hay credencial ambiental.
 */

import {
  PARTY_HEARTBEAT_MS,
  PARTY_PROTOCOL_VERSION,
  type PartyEvent,
  partyCreateRoomSchema,
  partyHostStateSchema,
  partyJoinRequestSchema,
  partyReportSchema,
  partySyncRequestSchema,
} from '@nn-anime/core'
import type { Context, Hono } from 'hono'
import type { z } from 'zod'
import { readCookie } from '../cookies'
import type { SessionStore } from '../session'
import { lanUrls } from './lan'
import { PartyStore } from './store'

export interface PartyRoutesOptions {
  readonly session: SessionStore
  readonly getPort: () => number
  /** El almacén. Se inyecta en las pruebas para controlar reloj y azar. */
  readonly store?: PartyStore
  readonly now?: () => number
  readonly ttlMs?: number
  /** Direcciones que se enseñan al anfitrión. Inyectable para probar sin red. */
  readonly urls?: (port: number) => string[]
}

function bearerOf(c: Context): string | undefined {
  const header = c.req.header('authorization')
  if (header === undefined) return undefined

  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())

  return match?.[1]
}

function isHost(c: Context, session: SessionStore): boolean {
  const cookie = readCookie(c.req.header('cookie'), session.cookieName)

  return session.matches(cookie)
}

async function readJson<T>(c: Context, schema: z.ZodType<T>): Promise<T | undefined> {
  try {
    const parsed = schema.safeParse(await c.req.json())

    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

/** Cuerpo opcional: un POST sin cuerpo es un `{}` y no un 400. */
async function readOptionalJson<T>(c: Context, schema: z.ZodType<T>): Promise<T | undefined> {
  try {
    const crudo = (await c.req.json()) as unknown

    const parsed = schema.safeParse(crudo)

    return parsed.success ? parsed.data : undefined
  } catch {
    const parsed = schema.safeParse({})

    return parsed.success ? parsed.data : undefined
  }
}

export function registerPartyRoutes(app: Hono, options: PartyRoutesOptions): PartyStore {
  const store =
    options.store ??
    new PartyStore({
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
    })
  const urls = options.urls ?? ((port: number) => lanUrls(port))

  // --- Anfitrión ---------------------------------------------------------

  app.post('/api/party/rooms', async (c) => {
    if (!isHost(c, options.session)) return c.text('', 401)

    const body = await readOptionalJson(c, partyCreateRoomSchema)
    if (body === undefined) return c.json({ error: 'invalid-body' }, 400)

    const creada = store.createRoom(body.ttlMs)
    if (!creada.ok) return c.json({ error: creada.reason }, 429)

    // `ok` es del resultado interno, no del contrato HTTP: la respuesta lleva
    // exactamente lo que declara `partyCreateRoomResponseSchema`.
    return c.json({ roomId: creada.roomId, code: creada.code, expiresAt: creada.expiresAt }, 201)
  })

  app.get('/api/party/rooms', (c) => {
    if (!isHost(c, options.session)) return c.text('', 401)

    return c.json({ rooms: store.listRooms() })
  })

  app.delete('/api/party/rooms/:roomId', (c) => {
    if (!isHost(c, options.session)) return c.text('', 401)

    const cerrada = store.closeRoom(c.req.param('roomId'))
    if (!cerrada) return c.text('', 404)

    return c.body(null, 204)
  })

  app.post('/api/party/rooms/:roomId/state', async (c) => {
    if (!isHost(c, options.session)) return c.text('', 401)

    const body = await readJson(c, partyHostStateSchema)
    if (body === undefined) return c.json({ error: 'invalid-body' }, 400)

    const estado = store.publishState(c.req.param('roomId'), body)
    if (estado === undefined) return c.text('', 404)

    return c.body(null, 204)
  })

  app.get('/api/party/info', (c) => {
    if (!isHost(c, options.session)) return c.text('', 401)

    const port = options.getPort()

    return c.json({ port, urls: urls(port) })
  })

  // --- Invitado ----------------------------------------------------------

  app.post('/api/party/join', async (c) => {
    const body = await readJson(c, partyJoinRequestSchema)
    if (body === undefined) return c.json({ error: 'invalid-body' }, 400)

    const entrada = store.join(body.code, body.name)
    if (!entrada.ok) {
      if (entrada.reason === 'rate-limited') return c.json({ error: 'rate-limited' }, 429)
      if (entrada.reason === 'full') return c.json({ error: 'full' }, 409)

      // Sala inexistente, caducada o código erróneo: el mismo 404 para no
      // decirle a quien prueba cuál de las tres cosas pasó.
      return c.text('', 404)
    }

    // Mismo criterio que en el alta: el cuerpo es el contrato, sin `ok`.
    return c.json({
      roomId: entrada.roomId,
      token: entrada.token,
      expiresAt: entrada.expiresAt,
      state: entrada.state,
      roster: entrada.roster,
    })
  })

  app.get('/api/party/rooms/:roomId', (c) => {
    const roomId = c.req.param('roomId')
    const host = isHost(c, options.session)
    const token = host ? undefined : bearerOf(c)
    const autorizado = token === undefined ? undefined : store.authorize(roomId, token)

    if (!host && autorizado === undefined) return c.text('', 401)

    const snapshot = store.snapshot(roomId)
    if (snapshot === undefined) return c.text('', 404)

    return c.json({
      roomId,
      expiresAt: snapshot.expiresAt,
      state: snapshot.state,
      roster: snapshot.roster,
    })
  })

  app.get('/api/party/rooms/:roomId/events', (c) => {
    const roomId = c.req.param('roomId')
    const host = isHost(c, options.session)
    const token = host ? undefined : bearerOf(c)
    const participante = token === undefined ? undefined : store.authorize(roomId, token)

    if (!host && participante === undefined) return c.text('', 401)

    const snapshot = store.snapshot(roomId)
    if (snapshot === undefined) return c.text('', 404)

    const encoder = new TextEncoder()
    let enviar: (event: PartyEvent) => void = () => {}
    let cerrar: (() => void) | undefined
    const unsubscribe = store.subscribe(roomId, (event) => enviar(event))

    if (unsubscribe === undefined) return c.text('', 404)

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let terminado = false
        let timer: ReturnType<typeof setInterval> | undefined

        const cleanup = (): void => {
          if (terminado) return

          terminado = true
          if (timer !== undefined) clearInterval(timer)
          c.req.raw.signal.removeEventListener('abort', cleanup)
          unsubscribe()
        }

        cerrar = cleanup
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
              // Ya estaba cerrado: no hay nada que hacer.
            }
          }
        }

        c.req.raw.signal.addEventListener('abort', cleanup)
        enviar({
          type: 'welcome',
          protocol: PARTY_PROTOCOL_VERSION,
          roomId,
          expiresAt: snapshot.expiresAt,
          state: snapshot.state,
          roster: snapshot.roster,
        })

        timer = setInterval(() => {
          store.sweep()
          enviar({ type: 'ping', atMs: store.now() })
        }, PARTY_HEARTBEAT_MS)
      },
      cancel() {
        cerrar?.()
      },
    })

    return c.body(stream, 200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    })
  })

  app.post('/api/party/rooms/:roomId/report', async (c) => {
    const roomId = c.req.param('roomId')
    const token = bearerOf(c)
    const autorizado = token === undefined ? undefined : store.authorize(roomId, token)
    if (autorizado === undefined) return c.text('', 401)

    const body = await readJson(c, partyReportSchema)
    if (body === undefined) return c.json({ error: 'invalid-body' }, 400)

    const resultado = store.report(roomId, autorizado.participant.id, body)
    if (resultado === 'missing') return c.text('', 401)
    if (resultado === 'rate-limited') return c.json({ error: 'rate-limited' }, 429)

    return c.body(null, 204)
  })

  app.post('/api/party/rooms/:roomId/leave', (c) => {
    const roomId = c.req.param('roomId')
    const token = bearerOf(c)
    const autorizado = token === undefined ? undefined : store.authorize(roomId, token)
    if (autorizado === undefined) return c.text('', 401)

    store.leave(roomId, autorizado.participant.id)

    return c.body(null, 204)
  })

  app.post('/api/party/rooms/:roomId/sync', async (c) => {
    const roomId = c.req.param('roomId')
    const host = isHost(c, options.session)
    const token = host ? undefined : bearerOf(c)
    const autorizado = token === undefined ? undefined : store.authorize(roomId, token)

    if (!host && autorizado === undefined) return c.text('', 401)

    if (
      !host &&
      autorizado !== undefined &&
      !store.allowParticipantMessage(roomId, autorizado.participant.id)
    ) {
      return c.json({ error: 'rate-limited' }, 429)
    }

    const body = await readJson(c, partySyncRequestSchema)
    if (body === undefined) return c.json({ error: 'invalid-body' }, 400)

    const reloj = store.sync(roomId)
    if (reloj === undefined) return c.text('', 404)

    return c.json({ t0: body.t0, t1: reloj.t1, t2: reloj.t2 })
  })

  return store
}
