import { describe, expect, test } from 'bun:test'
import type { CastInfoResponse, CastSessionResponse } from '@rona/core/api'
import { abrirCastSesion, cerrarCastSesion, leerCastInfo } from './cast'
import type { RequestDeps } from './client'

const INFO: CastInfoResponse = {
  available: true,
  urls: ['http://192.168.1.10:7717'],
}

const SESION: CastSessionResponse = {
  id: 'emision-1',
  kind: 'hls',
  urls: ['http://192.168.1.10:7717/stream/abc'],
  expiresAt: 1_900_000_000_000,
  title: 'Aurora nocturna',
  subtitles: [],
}

function deps(respuesta: unknown): {
  readonly llamadas: { url: string; init: RequestInit }[]
  readonly deps: RequestDeps
} {
  const llamadas: { url: string; init: RequestInit }[] = []

  return {
    llamadas,
    deps: {
      fetch: async (url, init) => {
        llamadas.push({ url, init })

        return new Response(JSON.stringify(respuesta), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    },
  }
}

describe('el cliente del cast', () => {
  test('pide la información y la valida', async () => {
    const { deps: pedir, llamadas } = deps(INFO)

    expect(await leerCastInfo(pedir)).toEqual(INFO)
    expect(llamadas[0]?.url).toBe('/api/cast/info')
  })

  test('abre una sesión con la referencia, no con una URL', async () => {
    const { deps: pedir, llamadas } = deps(SESION)
    const peticion = {
      episodeRef: { providerId: 'fixture', value: 'aurora-nocturna#1' },
      mode: 'sub' as const,
      title: 'Aurora nocturna',
    }

    expect(await abrirCastSesion(peticion, pedir)).toEqual(SESION)
    expect(llamadas[0]?.url).toBe('/api/cast/session')
    expect(llamadas[0]?.init.method).toBe('POST')
    expect(JSON.parse(String(llamadas[0]?.init.body))).toEqual(peticion)
  })

  test('cierra la sesión con su id y no con una URL', async () => {
    const { deps: pedir, llamadas } = deps({})

    await cerrarCastSesion('emision 1/2', pedir)

    expect(llamadas[0]?.url).toBe('/api/cast/session/emision%201%2F2')
    expect(llamadas[0]?.init.method).toBe('DELETE')
  })
})
