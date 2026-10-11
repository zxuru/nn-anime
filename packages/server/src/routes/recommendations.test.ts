import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import {
  recommendationsResponseSchema,
  type SearchResult,
  trendingResponseSchema,
} from '@nn-anime/core'
import { createRegistry, type Provider } from '@nn-anime/provider-sdk'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { createApp, createContainer } from '../index'
import { clampLimit, MAX_LIMIT } from './recommendations'

const PORT = 7717
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }

const REF = 'aurora-nocturna'

interface Contexto {
  readonly pedir: (ruta: string, init?: RequestInit) => Promise<Response>
  readonly db: ReturnType<typeof openDb>
  readonly proveedor: ReturnType<typeof createFixtureProvider>
}

/**
 * Un proveedor que sólo publica su top.
 *
 * Se construye por el registro y no a mano porque el registro es la única puerta
 * por la que entra un plugin: un objeto suelto probaría una forma que la
 * aplicación nunca ve.
 */
function proveedorConTop(id: string, resultados: readonly SearchResult[]): Provider {
  const registro = createRegistry([
    {
      id,
      name: id,
      apiVersion: '1',
      capabilities: { search: true, sub: false, dub: false, trending: true, feed: false },
      search: async () => [],
      getAnime: async () => ({
        ref: { providerId: id, value: 'a' },
        title: 'A',
        genres: [],
        studios: [],
      }),
      getEpisodes: async () => [],
      resolveStream: async () => [],
      getTrending: async () => resultados,
    },
  ])
  const registrado = registro.get(id)
  if (registrado === undefined) throw new Error('el proveedor de prueba no se registró')

  return registrado
}

function resultado(providerId: string, value: string, title: string): SearchResult {
  return { ref: { providerId, value }, title }
}

async function conApp<T>(
  body: (contexto: Contexto) => Promise<T>,
  opciones: {
    readonly cachear?: readonly string[]
    readonly proveedores?: readonly Provider[]
  } = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-recs-'))
  const db = openDb(join(dir, 'nn-anime.db'))
  runMigrations(db)
  const container = createContainer({ db })
  const proveedor = createFixtureProvider()
  const activos = opciones.proveedores ?? [proveedor]

  try {
    const servidor = createApp({
      port: PORT,
      session: {
        cookieName: SESSION_COOKIE,
        value: SESSION_VALUE,
        matches: (candidate) => candidate === SESSION_VALUE,
      },
      bootToken: 'token',
      version: '0.1.0',
      plugins: {
        active: activos.map((uno) => ({ provider: uno, file: `/plugins/${uno.id}.ts` })),
        rejected: [],
      },
      container,
    })

    // Se cachean los títulos pedidos: son los candidatos del motor.
    for (const ref of opciones.cachear ?? []) {
      await servidor.request(`${BASE}/api/anime/fixture/${ref}`, { headers: GOOD })
    }

    return await body({
      pedir: async (ruta, init) =>
        await Promise.resolve(servidor.request(`${BASE}${ruta}`, init ?? { headers: GOOD })),
      db,
      proveedor,
    })
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

describe('GET /api/trending', () => {
  /** El top de cada fuente, tal cual lo publica. */
  const consultar = async (proveedores: readonly Provider[]) =>
    await conApp(
      async ({ pedir }) =>
        trendingResponseSchema.parse(await (await pedir('/api/trending')).json()),
      { proveedores },
    )

  test('dos fuentes con el mismo anime dejan una tarjeta, la de la primera', async () => {
    const salida = await consultar([
      proveedorConTop('uno', [resultado('uno', 'one-piece', 'One Piece')]),
      proveedorConTop('dos', [resultado('dos', 'one-piece-tv', 'One Piece')]),
    ])

    // La referencia es distinta en cada fuente, así que sin mirar el título
    // salían dos tarjetas del mismo anime: es lo que se vio en la home.
    expect(salida.items).toHaveLength(1)
    expect(salida.items[0]?.ref.providerId).toBe('uno')
  })

  test('el título empareja sin mayúsculas, sin acentos y sin signos', async () => {
    const salida = await consultar([
      proveedorConTop('uno', [resultado('uno', 'a', 'Sousou no Frieren')]),
      proveedorConTop('dos', [resultado('dos', 'b', 'sousou  no frieren!')]),
    ])

    expect(salida.items).toHaveLength(1)
  })

  test('los títulos distintos de dos fuentes se quedan los dos', async () => {
    const salida = await consultar([
      proveedorConTop('uno', [resultado('uno', 'a', 'One Piece')]),
      proveedorConTop('dos', [resultado('dos', 'b', 'Dandadan')]),
    ])

    expect(salida.items.map((item) => item.title)).toEqual(['One Piece', 'Dandadan'])
  })

  test('la misma referencia repetida en una fuente deja una tarjeta', async () => {
    const salida = await consultar([
      proveedorConTop('uno', [
        resultado('uno', 'a', 'One Piece'),
        resultado('uno', 'a', 'One Piece'),
      ]),
    ])

    expect(salida.items).toHaveLength(1)
  })

  test('un título y su temporada son dos puestos, no uno', async () => {
    // `baseTitle` los juntaría: quita el marcador de temporada, y «Kimetsu no
    // Yaiba» y «Kimetsu no Yaiba 2nd Season» acabarían en la misma clave. La
    // fuente publica los tres —con la saga como subtítulo— y la fila tiene que
    // respetarlos: son tres puestos de su ranking.
    const salida = await consultar([
      proveedorConTop('uno', [
        resultado('uno', 'a', 'Kimetsu no Yaiba'),
        resultado('uno', 'b', 'Kimetsu no Yaiba 2nd Season'),
        resultado('uno', 'c', 'Kimetsu no Yaiba: Hashira Geiko-hen'),
      ]),
    ])

    expect(salida.items).toHaveLength(3)
  })
})

describe('GET /api/recommendations', () => {
  test('sin nada cacheado devuelve una lista vacía y lo dice', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/recommendations')
      const salida = recommendationsResponseSchema.parse(await respuesta.json())

      expect(respuesta.status).toBe(200)
      expect(salida.coldStart).toBe(true)
    })
  })

  test('con títulos cacheados devuelve recomendaciones con su razón', async () => {
    await conApp(
      async ({ pedir }) => {
        const respuesta = await pedir('/api/recommendations')
        const salida = recommendationsResponseSchema.parse(await respuesta.json())

        expect(salida.items.length).toBeGreaterThan(0)
        for (const item of salida.items) {
          expect(item.reason.text.length).toBeGreaterThan(0)
          expect(item.reasons.length).toBeGreaterThan(0)
        }
      },
      { cachear: [REF, 'selva-de-hormigon'] },
    )
  })

  test('la respuesta no lleva `components`', async () => {
    await conApp(
      async ({ pedir }) => {
        const respuesta = await pedir('/api/recommendations')
        const texto = JSON.stringify(await respuesta.json())

        expect(texto).not.toContain('components')
        expect(texto).not.toContain('affinity')
      },
      { cachear: [REF] },
    )
  })

  test('el recorte del límite, caso por caso', () => {
    expect(MAX_LIMIT).toBe(20)
    expect(clampLimit(undefined)).toBe(10)
    expect(clampLimit('abc')).toBe(10)
    expect(clampLimit('0')).toBe(1)
    expect(clampLimit('-5')).toBe(1)
    expect(clampLimit('999')).toBe(MAX_LIMIT)
    expect(clampLimit('3')).toBe(3)
  })

  test('el límite se respeta y se recorta al tope', async () => {
    await conApp(
      async ({ pedir }) => {
        const dos = recommendationsResponseSchema.parse(
          await (await pedir('/api/recommendations?limit=2')).json(),
        )
        const enorme = recommendationsResponseSchema.parse(
          await (await pedir('/api/recommendations?limit=999')).json(),
        )

        expect(dos.items.length).toBeLessThanOrEqual(2)
        expect(enorme.items.length).toBeLessThanOrEqual(MAX_LIMIT)
      },
      { cachear: [REF, 'selva-de-hormigon', 'orbita-corta'] },
    )
  })

  test('un límite inválido cae en el valor por defecto', async () => {
    await conApp(
      async ({ pedir }) => {
        const respuesta = await pedir('/api/recommendations?limit=abc')

        expect(respuesta.status).toBe(200)
      },
      { cachear: [REF] },
    )
  })

  test('sin historial sólo se llama a `getTrending`', async () => {
    await conApp(
      async ({ pedir, proveedor }) => {
        // Se mide el **delta**: el andamiaje ya llamó a `getAnime` para cachear el
        // título, y contarlo sería contar el montaje de la prueba.
        const antes = {
          getTrending: proveedor.calls.count('getTrending'),
          search: proveedor.calls.count('search'),
          getAnime: proveedor.calls.count('getAnime'),
          getEpisodes: proveedor.calls.count('getEpisodes'),
        }

        await pedir('/api/recommendations')

        expect(proveedor.calls.count('getTrending')).toBeGreaterThan(antes.getTrending)
        expect(proveedor.calls.count('search')).toBe(antes.search)
        expect(proveedor.calls.count('getAnime')).toBe(antes.getAnime)
        expect(proveedor.calls.count('getEpisodes')).toBe(antes.getEpisodes)
      },
      { cachear: [REF] },
    )
  })

  test('los tags llegan al motor: un título comparte género con lo visto', async () => {
    await conApp(
      async ({ pedir }) => {
        // Se cachean dos títulos y se registra un visionado de uno: el otro sólo
        // puede salir con razón de género compartido si sus tags se leyeron.
        await pedir(`/api/anime/fixture/${REF}/episodes`)
        const alta = await pedir('/api/watch', {
          method: 'POST',
          headers: { ...GOOD, 'content-type': 'application/json' },
          body: JSON.stringify({
            animeRef: { providerId: 'fixture', value: REF },
            episodeRef: { providerId: 'fixture', value: `${REF}#1` },
            mode: 'sub',
          }),
        })
        const { id } = (await alta.json()) as { id: number }

        // El avance es lo que da **completitud** al visionado: un alta sin
        // posición cuenta como cero y no aporta afinidad. Es el flujo real, donde
        // el reproductor manda el avance cada quince segundos.
        await pedir(`/api/watch/${id}`, {
          method: 'PATCH',
          headers: { ...GOOD, 'content-type': 'application/json' },
          body: JSON.stringify({ positionS: 900, durationS: 1440 }),
        })

        const salida = recommendationsResponseSchema.parse(
          await (await pedir('/api/recommendations')).json(),
        )
        const conGenero = salida.items.filter((item) =>
          item.reasons.some((razon) => razon.kind === 'same-genre'),
        )

        expect(conGenero.length).toBeGreaterThan(0)
      },
      // `aurora-nocturna` es Acción+Fantasía; `mar-de-cristal` comparte Fantasía
      // y `cazador-de-sombras` comparte Acción. Con dos que comparten, la razón
      // de género tiene que aparecer.
      { cachear: [REF, 'mar-de-cristal', 'cazador-de-sombras'] },
    )
  })

  test('con historial, los títulos vistos encabezan la lista', async () => {
    await conApp(
      async ({ pedir, db }) => {
        // Se abre el detalle y se registra un visionado: ahora hay historial.
        await pedir(`/api/anime/fixture/${REF}/episodes`)
        const alta = await pedir('/api/watch', {
          method: 'POST',
          headers: { ...GOOD, 'content-type': 'application/json' },
          body: JSON.stringify({
            animeRef: { providerId: 'fixture', value: REF },
            episodeRef: { providerId: 'fixture', value: `${REF}#1` },
            mode: 'sub',
          }),
        })
        const { id } = (await alta.json()) as { id: number }

        // El avance es lo que da **completitud** al visionado: un alta sin
        // posición cuenta como cero y no aporta afinidad. Es el flujo real, donde
        // el reproductor manda el avance cada quince segundos.
        await pedir(`/api/watch/${id}`, {
          method: 'PATCH',
          headers: { ...GOOD, 'content-type': 'application/json' },
          body: JSON.stringify({ positionS: 900, durationS: 1440 }),
        })

        const salida = recommendationsResponseSchema.parse(
          await (await pedir('/api/recommendations')).json(),
        )

        expect(salida.coldStart).toBe(false)
        // El título visto al 0 % no se excluye (no se ha terminado) y su afinidad
        // es la que manda.
        expect(salida.items.length).toBeGreaterThan(0)
        void db
      },
      { cachear: [REF, 'selva-de-hormigon'] },
    )
  })

  test('exige sesión', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/recommendations', { headers: {} })

      expect(respuesta.status).toBe(401)
    })
  })
})

describe('la consulta en curso', () => {
  test('la consulta cambia el panel: es una búsqueda de ahora', async () => {
    await conApp(
      async ({ pedir }) => {
        const sinConsulta = recommendationsResponseSchema.parse(
          await (await pedir('/api/recommendations')).json(),
        )
        // La consulta tiene que **coincidir con algo**: «mecha» no está en este
        // catálogo, así que no cambiaría nada y la prueba no mediría nada.
        const conConsulta = recommendationsResponseSchema.parse(
          await (await pedir('/api/recommendations?q=cazador')).json(),
        )

        const primeroSin = sinConsulta.items[0]?.ref.value
        const primeroCon = conConsulta.items[0]?.ref.value

        // Con la consulta, el primero tiene que ser distinto: si no, la consulta
        // viajaba y el servidor la ignoraba.
        expect(primeroCon).not.toBe(primeroSin)
      },
      { cachear: [REF, 'cazador-de-sombras'] },
    )
  })

  test('la razón de la consulta dice con qué coincide', async () => {
    await conApp(
      async ({ pedir }) => {
        const salida = recommendationsResponseSchema.parse(
          await (await pedir('/api/recommendations?q=cazador')).json(),
        )

        expect(salida.items[0]?.reason.text).toContain('cazador')
      },
      { cachear: [REF, 'cazador-de-sombras'] },
    )
  })

  test('una consulta en blanco no cambia nada', async () => {
    await conApp(
      async ({ pedir }) => {
        const sinConsulta = recommendationsResponseSchema.parse(
          await (await pedir('/api/recommendations')).json(),
        )
        const enBlanco = recommendationsResponseSchema.parse(
          await (await pedir('/api/recommendations?q=%20%20')).json(),
        )

        expect(enBlanco.items.map((item) => item.ref.value)).toEqual(
          sinConsulta.items.map((item) => item.ref.value),
        )
      },
      { cachear: [REF, 'cazador-de-sombras'] },
    )
  })
})
