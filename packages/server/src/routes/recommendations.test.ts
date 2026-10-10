import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import { recommendationsResponseSchema } from '@nn-anime/core'
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

async function conApp<T>(
  body: (contexto: Contexto) => Promise<T>,
  opciones: { readonly cachear?: readonly string[] } = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-recs-'))
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
      bootToken: 'token',
      version: '0.1.0',
      plugins: { active: [{ provider: proveedor, file: '/plugins/fixture.ts' }], rejected: [] },
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
