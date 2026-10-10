import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import { type ProviderSummary, providersResponseSchema } from '@nn-anime/core'
import { createRegistry, type Provider } from '@nn-anime/provider-sdk'
import { createFixtureProvider, fixtureProvider } from '@nn-anime/providers-fixture'
import { createApp, createContainer, type PluginReport } from '../index'

const PORT = 7717
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BOOT_TOKEN = 'token'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }

function providerFrom(raw: Record<string, unknown>): Provider {
  const id = String(raw.id ?? 'prueba')
  const registry = createRegistry([
    {
      id,
      name: id,
      apiVersion: '1',
      capabilities: { search: true, sub: true, dub: false, trending: false },
      search: async () => [],
      getAnime: async () => ({
        ref: { providerId: id, value: 'a' },
        title: 'A',
        genres: [],
        studios: [],
      }),
      getEpisodes: async () => [],
      resolveStream: async () => [],
      ...raw,
    },
  ])

  const registered = registry.get(id)
  if (registered === undefined) throw new Error('el proveedor de prueba no se registró')

  return registered
}

function app(plugins: PluginReport, extra: { searchTimeoutMs?: number } = {}) {
  return createApp({
    port: PORT,
    session: {
      cookieName: SESSION_COOKIE,
      value: SESSION_VALUE,
      matches: (candidate) => candidate === SESSION_VALUE,
    },
    bootToken: BOOT_TOKEN,
    version: '0.1.0',
    plugins,
    ...extra,
  })
}

const SOLO_FIXTURE: PluginReport = {
  active: [{ provider: fixtureProvider, file: '/plugins/fixture.ts' }],
  rejected: [],
}

/** Lee el cuerpo de un SSE como eventos sueltos, sin depender de cómo se trocee. */
async function readSse(response: Response): Promise<readonly { event: string; data: string }[]> {
  const text = await response.text()
  const eventos: { event: string; data: string }[] = []

  for (const bloque of text.split('\n\n')) {
    const lineas = bloque.split('\n')
    const tipo = lineas
      .find((linea) => linea.startsWith('event:'))
      ?.slice(6)
      .trim()
    const data = lineas
      .filter((linea) => linea.startsWith('data:'))
      .map((linea) => linea.slice(5).trim())
      .join('\n')
    if (tipo !== undefined && data !== '') eventos.push({ event: tipo, data })
  }

  return eventos
}

function resumenRechazado(message: string) {
  return { file: '/plugins/roto.ts', reason: { message } }
}

describe('GET /api/providers', () => {
  test('lista id, nombre, capacidades y estado', async () => {
    const response = await app(SOLO_FIXTURE).request(`${BASE}/api/providers`, { headers: GOOD })
    const body = providersResponseSchema.parse(await response.json())

    expect(response.status).toBe(200)
    expect(body.providers).toHaveLength(1)
    expect(body.providers[0]?.id).toBe('fixture')
    expect(body.providers[0]?.name).toBe('Proveedor de prueba')
    expect(body.providers[0]?.capabilities).toEqual({
      search: true,
      sub: true,
      dub: true,
      trending: true,
    })
    expect(body.providers[0]?.status).toBe('active')
  })

  test('un plugin roto aparece como rechazado, con motivo y sin 500', async () => {
    const report: PluginReport = {
      active: SOLO_FIXTURE.active,
      rejected: [resumenRechazado('no se pudo importar: se rompe al cargarse')],
    }
    const response = await app(report).request(`${BASE}/api/providers`, { headers: GOOD })

    expect(response.status).toBe(200)
    const body = providersResponseSchema.parse(await response.json())
    const rechazado = body.providers.find((provider) => provider.status === 'rejected')

    expect(rechazado?.id).toBe('roto')
    expect(rechazado?.reason).toContain('se rompe al cargarse')
  })

  test('sin plugins la lista está vacía, no ausente', async () => {
    const response = await app({ active: [], rejected: [] }).request(`${BASE}/api/providers`, {
      headers: GOOD,
    })

    expect(await response.json()).toEqual({ providers: [] })
  })

  test('el motivo del rechazo no inventa capacidades que nadie declaró', async () => {
    const report: PluginReport = { active: [], rejected: [resumenRechazado('no es un proveedor')] }
    const body = (await (
      await app(report).request(`${BASE}/api/providers`, { headers: GOOD })
    ).json()) as { providers: readonly ProviderSummary[] }

    expect(body.providers[0]?.capabilities).toEqual({
      search: false,
      sub: false,
      dub: false,
      trending: false,
    })
  })

  test('exige sesión', async () => {
    const response = await app(SOLO_FIXTURE).request(`${BASE}/api/providers`)

    expect(response.status).toBe(401)
  })

  test('rechaza un Host ajeno aunque la cookie sea válida', async () => {
    const response = await app(SOLO_FIXTURE).request(`${BASE}/api/providers`, {
      headers: { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, host: 'otro.example' },
    })

    expect(response.status).toBe(403)
  })
})

describe('GET /api/search como SSE', () => {
  test('responde text/event-stream con un evento por proveedor y el cierre', async () => {
    const report: PluginReport = {
      active: [
        { provider: createFixtureProvider({ id: 'uno' }), file: '/plugins/uno.ts' },
        { provider: createFixtureProvider({ id: 'dos' }), file: '/plugins/dos.ts' },
      ],
      rejected: [],
    }
    const response = await app(report).request(`${BASE}/api/search?q=aurora`, { headers: GOOD })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const eventos = await readSse(response)
    expect(eventos.map((evento) => evento.event)).toContain('results')
    expect(eventos.at(-1)?.event).toBe('done')

    const cierre = JSON.parse(eventos.at(-1)?.data ?? '{}') as { providers: number }
    expect(cierre.providers).toBe(2)
  })

  test('cada evento de resultados trae el id del proveedor y títulos legibles', async () => {
    const response = await app(SOLO_FIXTURE).request(`${BASE}/api/search?q=aurora`, {
      headers: GOOD,
    })
    const eventos = await readSse(response)
    const resultados = eventos.find((evento) => evento.event === 'results')

    const data = JSON.parse(resultados?.data ?? '{}') as {
      providerId: string
      results: readonly { title: string }[]
    }
    expect(data.providerId).toBe('fixture')
    expect(data.results[0]?.title).toBe('Aurora Nocturna')
  })

  test('un proveedor que lanza produce un evento de error, no un 500', async () => {
    const roto = providerFrom({
      id: 'roto',
      search: async () => {
        throw new Error('el sitio cambió')
      },
    })
    const response = await app({
      active: [{ provider: roto, file: '/plugins/roto.ts' }],
      rejected: [],
    }).request(`${BASE}/api/search?q=aurora`, { headers: GOOD })

    const eventos = await readSse(response)
    const error = eventos.find((evento) => evento.event === 'error')
    const data = JSON.parse(error?.data ?? '{}') as {
      providerId: string
      kind: string
      message: string
    }

    expect(response.status).toBe(200)
    expect(data.providerId).toBe('roto')
    expect(data.kind).toBe('threw')
    expect(data.message).toContain('el sitio cambió')
    expect(eventos.at(-1)?.event).toBe('done')
  })

  test('un proveedor que nunca responde no impide el cierre', async () => {
    const colgado = createFixtureProvider({ failures: { search: 'timeout' } })
    const bueno = createFixtureProvider({ id: 'bueno' })

    const response = await app(
      {
        active: [
          { provider: colgado, file: '/plugins/lento.ts' },
          { provider: bueno, file: '/plugins/bueno.ts' },
        ],
        rejected: [],
      },
      { searchTimeoutMs: 40 },
    ).request(`${BASE}/api/search?q=aurora`, { headers: GOOD })

    const eventos = await readSse(response)

    expect(eventos.some((evento) => evento.event === 'error')).toBe(true)
    expect(eventos.at(-1)?.event).toBe('done')
  })

  test('`?provider=` limita la búsqueda a los indicados', async () => {
    const report: PluginReport = {
      active: [
        { provider: createFixtureProvider({ id: 'uno' }), file: '/plugins/uno.ts' },
        { provider: createFixtureProvider({ id: 'dos' }), file: '/plugins/dos.ts' },
      ],
      rejected: [],
    }
    const response = await app(report).request(`${BASE}/api/search?q=aurora&provider=dos`, {
      headers: GOOD,
    })
    const eventos = await readSse(response)
    const ids = eventos
      .filter((evento) => evento.event === 'results')
      .map((evento) => (JSON.parse(evento.data) as { providerId: string }).providerId)

    expect(ids).toEqual(['dos'])
  })

  test('varios `provider=` a la vez se aceptan', async () => {
    const report: PluginReport = {
      active: [
        { provider: createFixtureProvider({ id: 'uno' }), file: '/plugins/uno.ts' },
        { provider: createFixtureProvider({ id: 'dos' }), file: '/plugins/dos.ts' },
        { provider: createFixtureProvider({ id: 'tres' }), file: '/plugins/tres.ts' },
      ],
      rejected: [],
    }
    const response = await app(report).request(
      `${BASE}/api/search?q=aurora&provider=uno&provider=tres`,
      { headers: GOOD },
    )
    const eventos = await readSse(response)
    const ids = eventos
      .filter((evento) => evento.event === 'results')
      .map((evento) => (JSON.parse(evento.data) as { providerId: string }).providerId)

    expect([...ids].sort()).toEqual(['tres', 'uno'])
  })

  test('sin proveedores cierra con el recuento en cero', async () => {
    const response = await app({ active: [], rejected: [] }).request(
      `${BASE}/api/search?q=aurora`,
      {
        headers: GOOD,
      },
    )
    const eventos = await readSse(response)

    expect(eventos).toEqual([{ event: 'done', data: '{"type":"done","providers":0}' }])
  })

  test('sin `q` busca igual: el catálogo entero del proveedor', async () => {
    const response = await app(SOLO_FIXTURE).request(`${BASE}/api/search`, { headers: GOOD })
    const eventos = await readSse(response)
    const resultados = eventos.find((evento) => evento.event === 'results')

    const data = JSON.parse(resultados?.data ?? '{}') as { results: readonly unknown[] }
    expect(data.results.length).toBeGreaterThanOrEqual(12)
  })

  test('una consulta inválida se rechaza con 400 y una forma que la interfaz entiende', async () => {
    const larga = 'a'.repeat(201)
    const response = await app(SOLO_FIXTURE).request(`${BASE}/api/search?q=${larga}`, {
      headers: GOOD,
    })
    const body = (await response.json()) as { error?: string }

    expect(response.status).toBe(400)
    expect(body.error).toContain('inválida')
  })

  test('un filtro de proveedor con forma inválida también se rechaza', async () => {
    const response = await app(SOLO_FIXTURE).request(
      `${BASE}/api/search?q=a&provider=Mal%20Formado`,
      {
        headers: GOOD,
      },
    )

    expect(response.status).toBe(400)
  })

  test('exige sesión', async () => {
    const response = await app(SOLO_FIXTURE).request(`${BASE}/api/search?q=aurora`)

    expect(response.status).toBe(401)
  })
})

describe('con caché de resultados', () => {
  /** App con una base temporal y su contenedor, más el contador del fixture. */
  async function conCache<T>(
    body: (context: {
      proveedor: ReturnType<typeof createFixtureProvider>
      db: ReturnType<typeof openDb>
      pedir: (query: string) => Promise<readonly string[]>
    }) => Promise<T>,
  ): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'nn-anime-busqueda-'))
    const db = openDb(join(dir, 'nn-anime.db'))
    runMigrations(db)
    const container = createContainer({ db })
    const proveedor = createFixtureProvider()

    try {
      const servidor = createApp({
        port: PORT,
        session: {
          cookieName: SESSION_COOKIE,
          value: SESSION_VALUE,
          matches: (candidate) => candidate === SESSION_VALUE,
        },
        bootToken: BOOT_TOKEN,
        version: '0.1.0',
        plugins: { active: [{ provider: proveedor, file: '/plugins/fixture.ts' }], rejected: [] },
        container,
      })

      const pedir = async (query: string): Promise<readonly string[]> => {
        const respuesta = await servidor.request(
          `${BASE}/api/search?q=${encodeURIComponent(query)}`,
          { headers: GOOD },
        )
        const eventos = await readSse(respuesta)

        return eventos
          .filter((evento) => evento.event === 'results')
          .map((evento) => (JSON.parse(evento.data) as { providerId: string }).providerId)
      }

      return await body({ proveedor, db, pedir })
    } finally {
      await container.close().catch(() => {})
      await rm(dir, { recursive: true, force: true })
    }
  }

  test('la segunda búsqueda idéntica no llama al proveedor', async () => {
    await conCache(async ({ proveedor, pedir }) => {
      await pedir('aurora')
      const trasLaPrimera = proveedor.calls.count('search')

      const ids = await pedir('aurora')

      expect(ids).toEqual(['fixture'])
      expect(trasLaPrimera).toBe(1)
      expect(proveedor.calls.count('search')).toBe(1)
    })
  })

  test('la consulta normalizada comparte entrada: «AURORA» no vuelve a preguntar', async () => {
    await conCache(async ({ proveedor, pedir }) => {
      await pedir('aurora')
      await pedir('  AURORA  ')

      expect(proveedor.calls.count('search')).toBe(1)
    })
  })

  test('una consulta distinta sí vuelve al proveedor', async () => {
    await conCache(async ({ proveedor, pedir }) => {
      await pedir('aurora')
      await pedir('mar')

      expect(proveedor.calls.count('search')).toBe(2)
    })
  })

  test('con dato vencido se responde de la caché y el refresco ocurre por detrás', async () => {
    await conCache(async ({ proveedor, db, pedir }) => {
      await pedir('aurora')

      // Se envejece la fila sin tocar el reloj del proceso.
      db.query('UPDATE search_cache SET fetched_at = fetched_at - 100000000').run()

      const ids = await pedir('aurora')

      // Se sirvió lo cacheado, sin esperar a nadie.
      expect(ids).toEqual(['fixture'])

      // Y por detrás se pidió otra vez al proveedor para refrescar.
      for (let intento = 0; intento < 50 && proveedor.calls.count('search') < 2; intento++) {
        await Bun.sleep(10)
      }

      expect(proveedor.calls.count('search')).toBe(2)
      const fila = db.query('SELECT fetched_at FROM search_cache').get() as { fetched_at: number }
      expect(Date.now() - fila.fetched_at).toBeLessThan(60_000)
    })
  })

  test('una segunda ejecución del proceso sirve desde la base sin llamar al proveedor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nn-anime-busqueda-'))
    const ruta = join(dir, 'nn-anime.db')

    const servidorCon = (
      db: ReturnType<typeof openDb>,
      proveedor: ReturnType<typeof createFixtureProvider>,
    ) =>
      createApp({
        port: PORT,
        session: {
          cookieName: SESSION_COOKIE,
          value: SESSION_VALUE,
          matches: (candidate) => candidate === SESSION_VALUE,
        },
        bootToken: BOOT_TOKEN,
        version: '0.1.0',
        plugins: { active: [{ provider: proveedor, file: '/plugins/fixture.ts' }], rejected: [] },
        container: createContainer({ db }),
      })

    const buscar = async (
      servidor: ReturnType<typeof servidorCon>,
      query: string,
    ): Promise<void> => {
      const respuesta = await servidor.request(`${BASE}/api/search?q=${query}`, { headers: GOOD })
      await readSse(respuesta)
    }

    try {
      // Primera ejecución: se busca y queda en la base.
      const primera = openDb(ruta)
      runMigrations(primera)
      const proveedorPrimero = createFixtureProvider()
      const containerPrimero = createContainer({ db: primera })
      await buscar(servidorCon(primera, proveedorPrimero), 'aurora')
      expect(proveedorPrimero.calls.count('search')).toBe(1)
      await containerPrimero.close()

      // Segunda ejecución: proceso nuevo, base reabierta, proveedor nuevo con su
      // contador a cero. La búsqueda se sirve sin tocar al proveedor.
      const segunda = openDb(ruta)
      const proveedorSegundo = createFixtureProvider()
      const containerSegundo = createContainer({ db: segunda })
      await buscar(servidorCon(segunda, proveedorSegundo), 'aurora')

      expect(proveedorSegundo.calls.count('search')).toBe(0)
      await containerSegundo.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('un proveedor que falla no escribe nada en la caché', async () => {
    await conCache(async ({ db }) => {
      const roto = createFixtureProvider({ failures: { search: 'http500' } })
      const servidor = createApp({
        port: PORT,
        session: {
          cookieName: SESSION_COOKIE,
          value: SESSION_VALUE,
          matches: (candidate) => candidate === SESSION_VALUE,
        },
        bootToken: BOOT_TOKEN,
        version: '0.1.0',
        plugins: { active: [{ provider: roto, file: '/plugins/roto.ts' }], rejected: [] },
        container: createContainer({ db }),
      })

      const respuesta = await servidor.request(`${BASE}/api/search?q=aurora`, { headers: GOOD })
      const eventos = await readSse(respuesta)

      expect(eventos.some((evento) => evento.event === 'error')).toBe(true)
      const filas = db.query('SELECT COUNT(*) AS total FROM search_cache').get() as {
        total: number
      }
      expect(filas.total).toBe(0)
    })
  })
})

describe('cancelación', () => {
  test('si el cliente corta la conexión, los proveedores reciben el aborto', async () => {
    const aborted: string[] = []

    // Un proveedor que se queda esperando y anota el aborto de su señal: es la
    // única forma de comprobar que la cancelación llega hasta el plugin y no se
    // queda en la puerta.
    const lento = providerFrom({
      id: 'lento',
      search: (_query: string, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => {
              aborted.push('lento')
              reject(options.signal.reason)
            },
            { once: true },
          )
        }),
    })

    const controlador = new AbortController()
    const servidor = app({ active: [{ provider: lento, file: '/plugins/lento.ts' }], rejected: [] })

    const peticion = servidor.request(`${BASE}/api/search?q=aurora`, {
      headers: GOOD,
      signal: controlador.signal,
    })

    // Se corta en cuanto el servidor ha empezado a atender: lo que se prueba es
    // que la cancelación llega al proveedor, no cuándo exactamente.
    await Bun.sleep(20)
    controlador.abort()

    await Promise.resolve(peticion).catch(() => {})

    const espera = async (): Promise<void> => {
      for (let intento = 0; intento < 50 && aborted.length === 0; intento++) await Bun.sleep(10)
    }
    await espera()

    expect(aborted).toEqual(['lento'])
  })
})
