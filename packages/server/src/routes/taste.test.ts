import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@rona/catalog-store'
import {
  recommendationsResponseSchema,
  tasteResponseSchema,
  tasteRowsResponseSchema,
  tasteTitlesResponseSchema,
} from '@rona/core'
import { createFixtureProvider } from '@rona/providers-fixture'
import { createApp, createContainer } from '../index'

const PORT = 7717
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }
const JSON_HEADERS = { ...GOOD, 'content-type': 'application/json' }

const AURORA = {
  providerId: 'fixture',
  ref: 'aurora-nocturna',
  title: 'Aurora Nocturna',
}

async function conApp<T>(
  body: (contexto: {
    readonly pedir: (ruta: string, init?: RequestInit) => Promise<Response>
    readonly db: ReturnType<typeof openDb>
  }) => Promise<T>,
  opciones: { readonly autoOpen?: boolean } = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'rona-gustos-'))
  const db = openDb(join(dir, 'rona.db'))
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
      anilistOffline: true,
      tasteSkipLimit: 2,
      ...(opciones.autoOpen === undefined ? {} : { tasteAutoOpen: opciones.autoOpen }),
    })

    return await body({
      pedir: async (ruta, init) =>
        await Promise.resolve(servidor.request(`${BASE}${ruta}`, init ?? { headers: GOOD })),
      db,
    })
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

/** Cachea el detalle de un título: es lo que lo convierte en candidato del motor. */
async function cachear(
  pedir: (ruta: string, init?: RequestInit) => Promise<Response>,
  ref: string,
): Promise<void> {
  const respuesta = await pedir(`/api/anime/fixture/${ref}`, { headers: GOOD })
  expect(respuesta.status).toBe(200)
}

async function encuesta(
  pedir: (ruta: string, init?: RequestInit) => Promise<Response>,
  body: unknown,
): Promise<Response> {
  return pedir('/api/taste', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })
}

describe('el perfil de gustos', () => {
  test('sin encuesta, el estado es «no empezada» y el límite viene del servidor', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/taste')

      expect(respuesta.status).toBe(200)
      expect(respuesta.headers.get('cache-control')).toBe('no-store')

      const cuerpo = tasteResponseSchema.parse(await respuesta.json())
      expect(cuerpo.profile.survey.status).toBe('not_started')
      expect(cuerpo.profile.genres).toEqual([])
      expect(cuerpo.skipLimit).toBe(2)
      expect(cuerpo.autoOpen).toBe(true)
    })
  })

  test('la abertura automática se puede apagar sin apagar el aviso', async () => {
    await conApp(
      async ({ pedir }) => {
        const cuerpo = tasteResponseSchema.parse(await (await pedir('/api/taste')).json())

        expect(cuerpo.autoOpen).toBe(false)
      },
      { autoOpen: false },
    )
  })

  test('borrar el perfil deja la encuesta sin empezar', async () => {
    await conApp(async ({ pedir }) => {
      await encuesta(pedir, { status: 'completed', genres: ['Acción'], tone: 'dark' })

      const respuesta = await pedir('/api/taste', { method: 'DELETE', headers: GOOD })
      expect(respuesta.status).toBe(200)

      const cuerpo = tasteResponseSchema.parse(await respuesta.json())
      expect(cuerpo.profile.survey.status).toBe('not_started')
      expect(cuerpo.profile.survey.skips).toBe(0)
      expect(cuerpo.profile.genres).toEqual([])
      expect(cuerpo.profile.tone).toBeNull()
    })
  })

  test('completar guarda géneros, títulos y formato con origen y fecha', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await encuesta(pedir, {
        status: 'completed',
        genres: ['Acción', 'Acción', 'Fantasía'],
        excludedGenres: ['Terror'],
        titles: [AURORA],
        format: 'movies',
        tone: 'dark',
        audio: 'sub',
        catalog: 'airing',
      })

      expect(respuesta.status).toBe(200)
      const cuerpo = tasteResponseSchema.parse(await respuesta.json())

      // Dos veces «Acción» es un género, no dos: la comparación no depende de tildes.
      expect(cuerpo.profile.genres.map((genero) => genero.name)).toEqual(['Acción', 'Fantasía'])
      expect(cuerpo.profile.genres[0]?.source).toBe('survey')
      expect(cuerpo.profile.genres[0]?.weight).toBe(1)
      expect(cuerpo.profile.genres[0]?.updatedAt.length).toBeGreaterThan(0)
      expect(cuerpo.profile.excludedGenres[0]?.name).toBe('Terror')
      expect(cuerpo.profile.titles[0]?.ref).toBe(AURORA.ref)
      expect(cuerpo.profile.titles[0]?.relation).toBe('liked')
      expect(cuerpo.profile.format?.value).toBe('movies')
      expect(cuerpo.profile.tone?.value).toBe('dark')
      expect(cuerpo.profile.audio?.value).toBe('sub')
      expect(cuerpo.profile.catalog?.value).toBe('airing')
      expect(cuerpo.profile.survey.status).toBe('completed')
      expect(cuerpo.profile.survey.skips).toBe(0)
    })
  })

  test('omitir cuenta y conserva lo marcado; completar reinicia la cuenta', async () => {
    await conApp(async ({ pedir }) => {
      await encuesta(pedir, { status: 'completed', genres: ['Acción'] })

      const primera = tasteResponseSchema.parse(
        await (await encuesta(pedir, { status: 'skipped' })).json(),
      )
      expect(primera.profile.survey.status).toBe('skipped')
      expect(primera.profile.survey.skips).toBe(1)
      // Omitir sin marcar nada no borra la encuesta que ya estaba.
      expect(primera.profile.genres.map((genero) => genero.name)).toEqual(['Acción'])

      const segunda = tasteResponseSchema.parse(
        await (await encuesta(pedir, { status: 'skipped' })).json(),
      )
      expect(segunda.profile.survey.skips).toBe(2)

      const completada = tasteResponseSchema.parse(
        await (await encuesta(pedir, { status: 'completed', genres: ['Comedia'] })).json(),
      )
      expect(completada.profile.survey.status).toBe('completed')
      expect(completada.profile.survey.skips).toBe(0)
    })
  })

  test('reabrir y editar sustituye las respuestas y mantiene el mismo usuario', async () => {
    await conApp(async ({ pedir }) => {
      await encuesta(pedir, { status: 'completed', genres: ['Acción'], tone: 'dark' })
      const editada = tasteResponseSchema.parse(
        await (
          await encuesta(pedir, {
            status: 'completed',
            genres: ['Comedia'],
            tone: 'light',
            format: 'short-series',
          })
        ).json(),
      )

      expect(editada.profile.userId).toBe('local')
      expect(editada.profile.genres.map((genero) => genero.name)).toEqual(['Comedia'])
      expect(editada.profile.tone?.value).toBe('light')
      expect(editada.profile.format?.value).toBe('short-series')
    })
  })

  test('una encuesta inválida no se guarda', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await encuesta(pedir, { status: 'completed', genres: 'Acción' })

      expect(respuesta.status).toBe(400)
      const perfil = tasteResponseSchema.parse(await (await pedir('/api/taste')).json())
      expect(perfil.profile.survey.status).toBe('not_started')
    })
  })
})

describe('los títulos del paso 2', () => {
  test('salen del catálogo conocido, con portada y sin pedir nada a la red', async () => {
    await conApp(async ({ pedir }) => {
      await cachear(pedir, 'aurora-nocturna')
      await cachear(pedir, 'cazador-de-sombras')
      await cachear(pedir, 'cocina-de-medianoche')

      const respuesta = await pedir('/api/taste/titles')
      const cuerpo = tasteTitlesResponseSchema.parse(await respuesta.json())

      expect(cuerpo.items.map((item) => item.title)).toContain('Aurora Nocturna')
      expect(cuerpo.items.length).toBeGreaterThanOrEqual(3)
      expect(cuerpo.items.length).toBeLessThanOrEqual(12)
    })
  })
})

describe('las filas del inicio', () => {
  test('agrupan por el género declarado y respetan las exclusiones', async () => {
    await conApp(async ({ pedir }) => {
      await cachear(pedir, 'aurora-nocturna')
      await cachear(pedir, 'cazador-de-sombras')
      await cachear(pedir, 'cocina-de-medianoche')

      await encuesta(pedir, { status: 'completed', genres: ['Acción'] })
      const conAccion = tasteRowsResponseSchema.parse(await (await pedir('/api/taste/rows')).json())

      const accion = conAccion.rows.find((fila) => fila.genre === 'Acción')
      expect(accion).toBeDefined()
      expect(accion?.items.map((item) => item.title)).toContain('Aurora Nocturna')

      await encuesta(pedir, {
        status: 'completed',
        genres: ['Acción'],
        excludedGenres: ['Acción'],
      })
      const sinAccion = tasteRowsResponseSchema.parse(await (await pedir('/api/taste/rows')).json())
      expect(sinAccion.rows.some((fila) => fila.genre === 'Acción')).toBe(false)
    })
  })

  test('sin encuesta no hay filas: la home sigue igual', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/taste/rows')
      const cuerpo = tasteRowsResponseSchema.parse(await respuesta.json())

      expect(cuerpo.rows).toEqual([])
    })
  })
})

describe('el motor con la encuesta', () => {
  test('sin historial, la recomendación sale de lo declarado y se explica como tal', async () => {
    await conApp(async ({ pedir }) => {
      await cachear(pedir, 'aurora-nocturna')
      await cachear(pedir, 'cocina-de-medianoche')
      await encuesta(pedir, { status: 'completed', genres: ['Acción'] })

      const respuesta = await pedir('/api/recommendations?limit=5')
      expect(respuesta.status).toBe(200)
      const cuerpo = recommendationsResponseSchema.parse(await respuesta.json())

      expect(cuerpo.coldStart).toBe(false)
      expect(cuerpo.items.length).toBeGreaterThan(0)
      expect(cuerpo.items[0]?.title).toBe('Aurora Nocturna')
      expect(cuerpo.items[0]?.reason.text.length).toBeGreaterThan(0)
      expect(
        cuerpo.items.some((item) => item.reasons.some((razon) => razon.kind.startsWith('taste-'))),
      ).toBe(true)
    })
  })

  test('sin encuesta y sin historial, sigue el arranque en frío por populares', async () => {
    await conApp(async ({ pedir }) => {
      await cachear(pedir, 'aurora-nocturna')
      await cachear(pedir, 'cocina-de-medianoche')

      const cuerpo = recommendationsResponseSchema.parse(
        await (await pedir('/api/recommendations?limit=5')).json(),
      )

      expect(cuerpo.coldStart).toBe(true)
      expect(cuerpo.items.length).toBeGreaterThan(0)
    })
  })
})
