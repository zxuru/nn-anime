/**
 * Las rutas de proveedores: la lista y la prueba de uno.
 *
 * La prueba se mide contra el informe real y un `fetch` de mentira: lo que
 * importa no es que el plugin conteste, sino que la ruta corte a tiempo, cuente
 * el fallo y no invente una respuesta. Los casos de plazo usan un tiempo corto
 * inyectado para que la prueba dure milisegundos y no cinco segundos.
 */

import { describe, expect, test } from 'bun:test'
import {
  errorResponseSchema,
  providerProbeResponseSchema,
  providersResponseSchema,
  type SearchResult,
} from '@rona/core'
import { createRegistry, type Provider } from '@rona/provider-sdk'
import { createFixtureProvider } from '@rona/providers-fixture'
import { Hono } from 'hono'
import { createApp, type PluginReport } from '../index'
import { briefError, PROBE_QUERY, registerProvidersRoute, summarizePlugins } from './providers'

const PORT = 7727
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BOOT_TOKEN = 'token'
const BASE = `http://127.0.0.1:${PORT}`

function report(
  active: PluginReport['active'] = [],
  rejected: PluginReport['rejected'] = [],
): PluginReport {
  return { active, rejected }
}

/** La ruta sola, con el plazo inyectado: así el caso lento no espera cinco segundos. */
function route(report: PluginReport, timeoutMs?: number): Hono {
  const app = new Hono()
  registerProvidersRoute(app, {
    plugins: report,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  })

  return app
}

/** Un proveedor que declara lo que se le pida y permite espiar la consulta. */
function providerWithSearch(
  search: (query: string) => Promise<readonly SearchResult[]> = async () => [],
  capability = true,
): Provider {
  const registry = createRegistry([
    {
      id: 'solo-ficha',
      name: 'Sólo ficha',
      apiVersion: '1',
      capabilities: { search: capability, sub: true, dub: false, trending: false, feed: false },
      search,
      getAnime: async () => ({
        ref: { providerId: 'solo-ficha', value: 'a' },
        title: 'A',
        genres: [],
        studios: [],
      }),
      getEpisodes: async () => [],
      resolveStream: async () => [],
    },
  ])

  const provider = registry.get('solo-ficha')
  if (provider === undefined) throw new Error('el proveedor de prueba no se registró')

  return provider
}

describe('el último error de carga en el resumen', () => {
  test('un rechazo lo trae breve y sin la ruta absoluta', async () => {
    const informe = report(
      [],
      [
        {
          file: 'C:\\datos\\repos\\zxuru__plugins\\roto.ts',
          reason: {
            message: 'no se pudo importar C:\\datos\\repos\\zxuru__plugins\\roto.ts: se rompe',
          },
        },
      ],
    )
    const response = await route(informe).request(`${BASE}/api/providers`)
    const body = providersResponseSchema.parse(await response.json())
    const rechazado = body.providers[0]

    expect(rechazado?.status).toBe('rejected')
    // `reason` conserva el mensaje entero: es el que sirve para depurar.
    expect(rechazado?.reason).toContain('C:\\datos')
    // `lastError` es el que se puede enseñar en una fila.
    expect(rechazado?.lastError).toContain('se rompe')
    expect(rechazado?.lastError).not.toContain('C:\\datos')
  })

  test('un activo puede traer el aviso que dejó el loader', () => {
    const resumen = summarizePlugins(
      report([
        {
          provider: createFixtureProvider(),
          file: '/plugins/fixture.ts',
          lastError: { message: 'aviso en /home/ana/plugins/fixture.ts: falta la carátula' },
        },
      ]),
    )

    expect(resumen[0]?.lastError).toBe('aviso en …: falta la carátula')
  })

  test('`briefError` no confunde los dos `/` de una URL con una ruta', () => {
    expect(briefError('falló https://sitio.example/a/b')).toBe('falló https://sitio.example/a/b')
  })
})

describe('POST /api/providers/:id/probe', () => {
  test('un proveedor que responde dice cuánto tardó', async () => {
    let consulta = ''
    const fuente = providerWithSearch(async (query) => {
      consulta = query
      return []
    })
    const response = await route(
      report([{ provider: fuente, file: '/plugins/fuente.ts' }]),
    ).request(`${BASE}/api/providers/solo-ficha/probe`, { method: 'POST' })
    const body = providerProbeResponseSchema.parse(await response.json())

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.error).toBeUndefined()
    expect(Number.isInteger(body.latencyMs)).toBe(true)
    expect(body.latencyMs).toBeGreaterThanOrEqual(0)
    // La prueba es una búsqueda de verdad, con el término del arnés.
    expect(consulta).toBe(PROBE_QUERY)
  })

  test('uno que tarda se corta en el plazo', async () => {
    const lento = createFixtureProvider({ latencyMs: 200 })
    const response = await route(
      report([{ provider: lento, file: '/plugins/lento.ts' }]),
      25,
    ).request(`${BASE}/api/providers/fixture/probe`, { method: 'POST' })
    const body = providerProbeResponseSchema.parse(await response.json())

    expect(response.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.error).toContain('no respondió en 25 ms')
    expect(body.latencyMs).toBeGreaterThanOrEqual(20)
  })

  test('uno que ignora la señal también se corta en el plazo', async () => {
    // El proveedor que se cuelga sin mirar la señal es el caso que de verdad
    // mide la carrera: si el plazo sólo se apoyara en el SDK, la petición se
    // quedaría abierta para siempre.
    const colgado = providerWithSearch(() => new Promise<readonly SearchResult[]>(() => {}))
    const response = await route(
      report([{ provider: colgado, file: '/plugins/colgado.ts' }]),
      25,
    ).request(`${BASE}/api/providers/solo-ficha/probe`, { method: 'POST' })
    const body = providerProbeResponseSchema.parse(await response.json())

    expect(body.ok).toBe(false)
    expect(body.error).toContain('no respondió en 25 ms')
  })

  test('uno que lanza cuenta el error y no tumba la ruta', async () => {
    const roto = createFixtureProvider({ failures: { search: 'throws' } })
    const response = await route(report([{ provider: roto, file: '/plugins/roto.ts' }])).request(
      `${BASE}/api/providers/fixture/probe`,
      { method: 'POST' },
    )
    const body = providerProbeResponseSchema.parse(await response.json())

    expect(response.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.error).toContain('lanza a propósito')
  })

  test('uno que no declara búsqueda no se puede probar', async () => {
    const response = await route(
      report([{ provider: providerWithSearch(undefined, false), file: '/plugins/ficha.ts' }]),
    ).request(`${BASE}/api/providers/solo-ficha/probe`, { method: 'POST' })
    const body = errorResponseSchema.parse(await response.json())

    expect(response.status).toBe(409)
    expect(body.error).toContain('no declara búsqueda')
  })

  test('un rechazado es 409, porque existe y no cargó', async () => {
    const informe = report(
      [],
      [{ file: 'C:\\datos\\roto.ts', reason: { message: 'no cumple el contrato' } }],
    )
    const response = await route(informe).request(`${BASE}/api/providers/roto/probe`, {
      method: 'POST',
    })
    const body = errorResponseSchema.parse(await response.json())

    expect(response.status).toBe(409)
    expect(body.error).toContain('no cargó')
    expect(body.error).toContain('no cumple el contrato')
  })

  test('uno que no existe es 404', async () => {
    const response = await route(report()).request(`${BASE}/api/providers/fantasma/probe`, {
      method: 'POST',
    })
    const body = errorResponseSchema.parse(await response.json())

    expect(response.status).toBe(404)
    expect(body.error).toContain('fantasma')
  })

  test('exige sesión como el resto de la API', async () => {
    const app = createApp({
      port: PORT,
      session: {
        cookieName: SESSION_COOKIE,
        value: SESSION_VALUE,
        matches: (candidate) => candidate === SESSION_VALUE,
      },
      bootToken: BOOT_TOKEN,
      version: '0.1.0',
      plugins: report([{ provider: createFixtureProvider(), file: '/plugins/fixture.ts' }]),
    })
    const response = await app.request(`${BASE}/api/providers/fixture/probe`, {
      method: 'POST',
      // Sin `Origin`, el guard de Origin corta antes con un 403 y esta prueba
      // estaría midiendo el otro guard.
      headers: { origin: BASE },
    })

    expect(response.status).toBe(401)
  })
})
