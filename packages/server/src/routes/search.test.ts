import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import { type DiscoverItem, type ProviderSummary, providersResponseSchema } from '@nn-anime/core'
import { createRegistry, type Provider } from '@nn-anime/provider-sdk'
import { createFixtureProvider, fixtureProvider } from '@nn-anime/providers-fixture'
import { fakeAniList, type RawMediaFixture } from '../__fixtures__/anilist'
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
      capabilities: { search: true, sub: true, dub: false, trending: false, feed: false },
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
      feed: true,
      // El fixture declara que sirve las dos cosas, y las capacidades viajan
      // enteras: es lo que la interfaz lee para saber en qué pestaña enseñarlo.
      media: 'both',
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

  test('en Windows el rechazo se llama por su archivo, no por su ruta entera', async () => {
    // Lo encontró la comprobación en vivo: un proveedor habilitado de un
    // repositorio que no conforma salía en la lista con la ruta completa del
    // disco como identificador, porque el nombre se sacaba partiendo por `/`.
    const report: PluginReport = {
      active: [],
      rejected: [
        {
          file: 'C:\\datos\\repos\\zxuru__nn-anime-plugins\\marca\\index.js',
          reason: { message: 'no cumple el contrato' },
        },
      ],
    }
    const response = await app(report).request(`${BASE}/api/providers`, { headers: GOOD })
    const body = providersResponseSchema.parse(await response.json())

    expect(body.providers[0]?.id).toBe('index')
    expect(body.providers[0]?.name).toBe('index')
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
      feed: false,
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

  /**
   * El tipo filtra **antes de preguntar**.
   *
   * Una búsqueda de películas no puede gastar el ancho de banda de una fuente de
   * anime: son sitios de terceros, y filtrar los resultados al llegar dejaría el
   * gasto hecho. Se mide con el id del evento, que es quien dice a quién se le
   * preguntó.
   */
  test('`?media=` deja fuera a las fuentes que no pueden tener esa mitad', async () => {
    const report: PluginReport = {
      active: [
        { provider: createFixtureProvider({ id: 'anime', media: 'anime' }), file: '/p/a.ts' },
        { provider: createFixtureProvider({ id: 'pelis', media: 'movies' }), file: '/p/p.ts' },
        { provider: createFixtureProvider({ id: 'mixta', media: 'both' }), file: '/p/m.ts' },
      ],
      rejected: [],
    }
    const response = await app(report).request(`${BASE}/api/search?q=aurora&media=movies`, {
      headers: GOOD,
    })
    const eventos = await readSse(response)
    const ids = eventos
      .filter((evento) => evento.event === 'results')
      .map((evento) => (JSON.parse(evento.data) as { providerId: string }).providerId)

    // La mixta entra: sus resultados pueden ser de las dos mitades y el reparto por
    // `kind` lo hace la interfaz, que es quien tiene las tarjetas.
    expect([...ids].sort()).toEqual(['mixta', 'pelis'])
  })

  test('sin `media` se pregunta a todas, que es lo de siempre', async () => {
    const report: PluginReport = {
      active: [
        { provider: createFixtureProvider({ id: 'anime', media: 'anime' }), file: '/p/a.ts' },
        { provider: createFixtureProvider({ id: 'pelis', media: 'movies' }), file: '/p/p.ts' },
      ],
      rejected: [],
    }
    const eventos = await readSse(
      await app(report).request(`${BASE}/api/search?q=aurora`, { headers: GOOD }),
    )
    const ids = eventos
      .filter((evento) => evento.event === 'results')
      .map((evento) => (JSON.parse(evento.data) as { providerId: string }).providerId)

    expect([...ids].sort()).toEqual(['anime', 'pelis'])
  })

  test('un tipo fuera del vocabulario se rechaza con 400', async () => {
    const response = await app(SOLO_FIXTURE).request(
      `${BASE}/api/search?q=aurora&media=anime-y-peliculas`,
      { headers: GOOD },
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('media')
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
      servidor: ReturnType<typeof createApp>
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

      return await body({ proveedor, db, servidor, pedir })
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

  /**
   * Lo que trae el catálogo cacheado, si trae algo.
   *
   * Se busca por `providerId` y no por posición: los eventos de los proveedores
   * llegan en el orden en que responden, así que `eventos[0]` no es una promesa
   * que esta prueba pueda hacer.
   */
  function delCatalogo(
    eventos: readonly { event: string; data: string }[],
  ): readonly { title: string }[] {
    const evento = eventos
      .filter((crudo) => crudo.event === 'results')
      .map(
        (crudo) => JSON.parse(crudo.data) as { providerId: string; results: { title: string }[] },
      )
      .find((payload) => payload.providerId === 'catalog')

    return evento?.results ?? []
  }

  /** Abre el detalle del fixture, que es lo que deja los géneros en la base. */
  async function cachearDetalle(servidor: ReturnType<typeof createApp>): Promise<void> {
    const respuesta = await servidor.request(`${BASE}/api/anime/fixture/aurora-nocturna`, {
      headers: GOOD,
    })

    expect(respuesta.status).toBe(200)
    await respuesta.json()
  }

  test('un género devuelve los títulos que ya están en la base', async () => {
    await conCache(async ({ servidor }) => {
      await cachearDetalle(servidor)

      const respuesta = await servidor.request(
        `${BASE}/api/search?q=${encodeURIComponent('acción')}`,
        { headers: GOOD },
      )

      expect(delCatalogo(await readSse(respuesta)).map((hit) => hit.title)).toEqual([
        'Aurora Nocturna',
      ])
    })
  })

  test('el género se encuentra aunque se escriba sin tilde', async () => {
    await conCache(async ({ servidor }) => {
      await cachearDetalle(servidor)

      const respuesta = await servidor.request(`${BASE}/api/search?q=accion`, { headers: GOOD })

      expect(delCatalogo(await readSse(respuesta))).toHaveLength(1)
    })
  })

  /**
   * Y el estudio, que es la otra mitad de la misma pregunta.
   *
   * El fixture declara «Estudio Cobre» y ningún proveedor sabe buscar por estudio:
   * el único sitio donde ese nombre lleva a sus títulos es la base local, que es
   * lo que se mide aquí.
   */
  test('un estudio devuelve los títulos que ya están en la base', async () => {
    await conCache(async ({ servidor }) => {
      await cachearDetalle(servidor)

      const respuesta = await servidor.request(`${BASE}/api/search?q=cobre`, { headers: GOOD })

      expect(delCatalogo(await readSse(respuesta)).map((hit) => hit.title)).toEqual([
        'Aurora Nocturna',
      ])
    })
  })

  test('el estudio se encuentra con otra caja y sin tilde', async () => {
    await conCache(async ({ servidor }) => {
      await cachearDetalle(servidor)

      const respuesta = await servidor.request(`${BASE}/api/search?q=Estudio%20Cobre`, {
        headers: GOOD,
      })

      expect(delCatalogo(await readSse(respuesta))).toHaveLength(1)
    })
  })

  /**
   * Una consulta que encaja por las dos vías.
   *
   * «acción» es un género del fixture y, en esta fila sembrada a mano, también el
   * nombre del estudio. Las dos lecturas se piden siempre —ninguna se puede
   * descartar sin mirar— y la unión tiene que salir sin repetidos: sin el descarte
   * por referencia, el mismo título saldría dos veces en el evento del catálogo y
   * dos tarjetas iguales en la rejilla.
   */
  test('una consulta que encaja por género y por estudio no repite el título', async () => {
    await conCache(async ({ db, servidor }) => {
      await cachearDetalle(servidor)

      const fila = db
        .query<{ id: number }, [string]>(
          `INSERT INTO anime (provider_id, provider_ref, title, year, fetched_at, ttl_s, raw_json)
           VALUES ('fixture', 'accion-y-estudio', 'Acción y estudio', 2020, 1, 3600, ?)
           RETURNING id`,
        )
        .get(
          JSON.stringify({
            ref: { providerId: 'fixture', value: 'accion-y-estudio' },
            title: 'Acción y estudio',
            genres: ['Acción'],
            studios: ['Acción'],
          }),
        )
      db.query('INSERT INTO genre (anime_id, name) VALUES (?, ?)').run(fila?.id ?? 0, 'Acción')

      const respuesta = await servidor.request(`${BASE}/api/search?q=acci%C3%B3n`, {
        headers: GOOD,
      })

      expect(delCatalogo(await readSse(respuesta)).map((hit) => hit.title)).toEqual([
        'Acción y estudio',
        'Aurora Nocturna',
      ])
    })
  })

  test('sin nada cacheado no hay evento de catálogo: lo dice el proveedor', async () => {
    await conCache(async ({ pedir }) => {
      expect(await pedir('acción')).toEqual(['fixture'])
    })
  })

  test('el filtro de proveedor también deja fuera lo cacheado', async () => {
    await conCache(async ({ servidor }) => {
      await cachearDetalle(servidor)

      const respuesta = await servidor.request(
        `${BASE}/api/search?q=${encodeURIComponent('acción')}&provider=otro`,
        { headers: GOOD },
      )

      expect(delCatalogo(await readSse(respuesta))).toEqual([])
    })
  })

  test('sin consulta no se busca por género: el catálogo no se vuelca en la pantalla', async () => {
    await conCache(async ({ servidor }) => {
      await cachearDetalle(servidor)

      const respuesta = await servidor.request(`${BASE}/api/search`, { headers: GOOD })

      expect(delCatalogo(await readSse(respuesta))).toEqual([])
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

/**
 * La búsqueda cruzada, de punta a punta.
 *
 * Es el caso que la pidió: una búsqueda por **estudio** o por **género** que en
 * las fuentes no tiene nada más que dar —ninguna busca por ahí— y que AniList sí
 * contesta. Lo que se mide es que la lista llega como evento propio, que cada
 * pieza trae la referencia local cuando la base conoce la obra —el cruce con lo
 * que hay en los proveedores—, y que el cierre no se adelanta a la lista.
 */
describe('la búsqueda cruzada con AniList', () => {
  const REF_LOCAL = 'aurora-nocturna'

  /** La obra local del fixture: la base la conoce en cuanto se abre su ficha. */
  const AURORA: RawMediaFixture = {
    id: 555,
    romaji: 'Aurora Nocturna',
    year: 2019,
    format: 'TV',
    genres: ['Misterio'],
    studios: ['Estudio Cobre'],
  }

  const KIMETSU: RawMediaFixture = {
    id: 101922,
    romaji: 'Kimetsu no Yaiba',
    english: 'Demon Slayer',
    year: 2019,
    format: 'TV',
  }

  async function conCruzada<T>(
    fixture: Parameters<typeof fakeAniList>[0],
    body: (contexto: {
      readonly servidor: ReturnType<typeof createApp>
      readonly fake: ReturnType<typeof fakeAniList>
    }) => Promise<T>,
  ): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'nn-anime-cruzada-'))
    const db = openDb(join(dir, 'nn-anime.db'))
    runMigrations(db)
    const container = createContainer({ db })
    const fake = fakeAniList(fixture)

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
        plugins: SOLO_FIXTURE,
        container,
        anilistFetchImpl: fake.impl,
        anilistResolver: async () => ['140.82.121.3'],
        anilistClock: () => 1_700_000_000_000,
      })

      // La ficha local se cachea abriéndola, que es como la conoce la aplicación:
      // sin ella no hay nada con lo que cruzar la lista de AniList.
      await servidor.request(`${BASE}/api/anime/fixture/${REF_LOCAL}`, { headers: GOOD })

      return await body({ servidor, fake })
    } finally {
      await container.close().catch(() => {})
      await rm(dir, { recursive: true, force: true })
    }
  }

  function cruzadaDe(eventos: readonly { event: string; data: string }[]): readonly DiscoverItem[] {
    const evento = eventos.find((uno) => uno.event === 'anilist')
    if (evento === undefined) return []

    return (JSON.parse(evento.data) as { items: readonly DiscoverItem[] }).items
  }

  test('el estudio llega como lista, con la referencia local en la obra que la tiene', async () => {
    await conCruzada(
      { cross: { studios: [{ name: 'Estudio Cobre', media: [KIMETSU, AURORA] }] } },
      async ({ servidor }) => {
        const respuesta = await servidor.request(
          `${BASE}/api/search?q=Estudio%20Cobre&media=anime`,
          {
            headers: GOOD,
          },
        )
        const eventos = await readSse(respuesta)
        const items = cruzadaDe(eventos)

        expect(items.map((item) => item.anilistId)).toEqual([101922, 555])
        expect(items[0]?.cover).toBe('/api/anilist/image/cover/101922')
        // La de Aurora está en la base —su ficha se abrió—; la de Kimetsu no. Ése es
        // el cruce: la misma obra está en AniList y en una fuente, o sólo en AniList.
        expect(items[0]?.ref).toBeUndefined()
        expect(items[1]?.ref).toEqual({ providerId: 'fixture', value: REF_LOCAL })
      },
    )
  })

  test('la lista sale antes del cierre: no se da la búsqueda por terminada sin ella', async () => {
    await conCruzada(
      { cross: { studios: [{ name: 'Estudio Cobre', media: [KIMETSU] }] } },
      async ({ servidor }) => {
        const eventos = await readSse(
          await servidor.request(`${BASE}/api/search?q=Estudio%20Cobre&media=anime`, {
            headers: GOOD,
          }),
        )
        const nombres = eventos.map((evento) => evento.event)

        expect(nombres).toContain('anilist')
        expect(nombres.indexOf('anilist')).toBeLessThan(nombres.indexOf('done'))
      },
    )
  })

  test('el género en español se le pide a AniList con su nombre en inglés', async () => {
    await conCruzada({ cross: { genre: [KIMETSU] } }, async ({ servidor, fake }) => {
      const eventos = await readSse(
        await servidor.request(`${BASE}/api/search?q=Acci%C3%B3n&media=anime`, { headers: GOOD }),
      )

      const llamada = fake.calls.find((una) => una.query.includes('porEstudio: Page('))
      expect(llamada?.variables.genero).toBe('Action')
      expect(cruzadaDe(eventos).map((item) => item.anilistId)).toEqual([101922])
    })
  })

  test('sin nada que AniList tenga del término no se emite el evento, y la búsqueda cierra', async () => {
    await conCruzada({}, async ({ servidor }) => {
      const eventos = await readSse(
        await servidor.request(`${BASE}/api/search?q=naruto&media=anime`, { headers: GOOD }),
      )

      expect(eventos.some((evento) => evento.event === 'anilist')).toBe(false)
      expect(eventos.at(-1)?.event).toBe('done')
    })
  })

  /**
   * Con un género escrito, a las fuentes no se les pregunta.
   *
   * Un término con `#` no es un título —`#aventura` no lo busca nadie— y sus respuestas son
   * ruido que además se paga en su ancho de banda. Se mide con el contador del fixture: la
   * ruta no puede preguntar «por si acaso» y luego no pintarlo.
   */
  test('con un género no se pregunta a ningún proveedor, y cierra con cero', async () => {
    await conCruzada(
      { cross: { studios: [{ name: 'Acción', media: [KIMETSU] }], genre: [KIMETSU] } },
      async ({ servidor }) => {
        const antes = fixtureProvider.calls.count('search')

        const eventos = await readSse(
          await servidor.request(`${BASE}/api/search?q=%23action&media=anime`, { headers: GOOD }),
        )

        expect(fixtureProvider.calls.count('search')).toBe(antes)
        expect(eventos.filter((evento) => evento.event === 'results')).toEqual([])
        expect(eventos.some((evento) => evento.event === 'anilist')).toBe(true)
        expect(JSON.parse(eventos.at(-1)?.data ?? '{}')).toMatchObject({ providers: 0 })
      },
    )
  })

  test('sin género sí se pregunta, como siempre', async () => {
    await conCruzada({}, async ({ servidor }) => {
      const antes = fixtureProvider.calls.count('search')

      const eventos = await readSse(
        await servidor.request(`${BASE}/api/search?q=aurora&media=anime`, { headers: GOOD }),
      )

      expect(fixtureProvider.calls.count('search')).toBeGreaterThan(antes)
      expect(eventos.some((evento) => evento.event === 'results')).toBe(true)
    })
  })

  test('una obra marcada no sale con el interruptor apagado', async () => {
    await conCruzada(
      { cross: { studios: [{ name: 'Estudio Cobre', media: [{ ...KIMETSU, isAdult: true }] }] } },
      async ({ servidor }) => {
        const eventos = await readSse(
          await servidor.request(`${BASE}/api/search?q=Estudio%20Cobre&media=anime`, {
            headers: GOOD,
          }),
        )

        expect(eventos.some((evento) => evento.event === 'anilist')).toBe(false)
      },
    )
  })
})
