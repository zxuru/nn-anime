/**
 * Ruta de subtítulos: `GET /api/subtitles/:ticket`.
 *
 * Sirve una pista por el proxy, como todo lo demás: el cliente nunca ve la
 * dirección del upstream. Aquí sí se lee el cuerpo entero, y es a propósito: hay
 * que convertirlo, y una conversión necesita el texto completo. Por eso el tope
 * de 5 MB se comprueba **antes** de leer nada: es lo único que impide que una
 * pista enorme se convierta en memoria.
 *
 * El `Content-Type` se fuerza siempre a `text/vtt` cuando la pista es `srt` o
 * `vtt`. Un `ass` se devuelve tal cual —mpv lo entiende y el navegador no— y
 * quien decide no ofrecerlo en la web es el reproductor, no este módulo.
 */

import { errorResponseSchema } from '@nn-anime/core'
import {
  decodeSubtitle,
  type FetchLike,
  MAX_SUBTITLE_BYTES,
  type Resolver,
  srtToVtt,
  subtitleKind,
  subtitleTooLarge,
} from '@nn-anime/media-proxy'
import type { Hono } from 'hono'
import type { ServerContainer } from '../container'

export interface SubtitlesRouteOptions {
  readonly container: ServerContainer
  readonly fetchImpl?: FetchLike
  readonly resolver?: Resolver
}

export function registerSubtitlesRoute(app: Hono, options: SubtitlesRouteOptions): void {
  app.get('/api/subtitles/:ticket', async (c) => {
    const ticket = c.req.param('ticket')
    const salida = options.container.tickets.resolve(ticket)

    if (!salida.ok) {
      return c.json(
        errorResponseSchema.parse({
          error:
            salida.kind === 'expired'
              ? 'el ticket caducó; vuelve a resolver el stream'
              : 'ese ticket no existe',
        }),
        salida.kind === 'expired' ? 410 : 404,
      )
    }

    const tipo = subtitleKind(salida.contents.url)

    // Un `ass` no se convierte: se reenvía tal cual, con sus bytes.
    if (tipo === 'ass') {
      const { proxyBytes } = await import('@nn-anime/media-proxy')

      return await proxyBytes({
        url: salida.contents.url,
        headers: salida.contents.headers,
        signal: c.req.raw.signal,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
      })
    }

    const respuesta = await fetchTrack(options, salida.contents)
    if (!respuesta.ok) return respuesta.response

    const bytes = respuesta.bytes
    if (bytes.byteLength > MAX_SUBTITLE_BYTES) {
      const error = subtitleTooLarge(bytes.byteLength)

      return c.json(errorResponseSchema.parse({ error: error.message }), 413)
    }

    const { text } = decodeSubtitle(bytes)
    const cuerpo = tipo === 'srt' ? srtToVtt(text) : text

    return new Response(cuerpo, {
      status: 200,
      headers: {
        'content-type': 'text/vtt; charset=utf-8',
        'x-content-type-options': 'nosniff',
      },
    })
  })
}

/** Pide la pista al upstream y devuelve sus bytes, o la respuesta de error. */
async function fetchTrack(
  options: SubtitlesRouteOptions,
  contents: { readonly url: string; readonly headers: Readonly<Record<string, string>> },
): Promise<
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly response: Response }
> {
  const { fetchAllowed } = await import('@nn-anime/media-proxy')

  try {
    const upstream = await fetchAllowed({
      url: contents.url,
      headers: { ...contents.headers, 'accept-encoding': 'identity' },
      fetchImpl: options.fetchImpl ?? ((input: string, init: RequestInit) => fetch(input, init)),
      ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
    })

    if (!upstream.ok) {
      return {
        ok: false,
        response: new Response(upstream.body, {
          status: upstream.status,
          headers: { 'x-content-type-options': 'nosniff' },
        }),
      }
    }

    const declarado = Number(upstream.headers.get('content-length') ?? '0')
    if (Number.isFinite(declarado) && declarado > MAX_SUBTITLE_BYTES) {
      const error = subtitleTooLarge(declarado)

      return {
        ok: false,
        response: Response.json({ error: error.message }, { status: 413 }),
      }
    }

    return { ok: true, bytes: new Uint8Array(await upstream.arrayBuffer()) }
  } catch (cause) {
    return {
      ok: false,
      response: Response.json(
        { error: cause instanceof Error ? cause.message : String(cause) },
        { status: 502 },
      ),
    }
  }
}
