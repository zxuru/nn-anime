/**
 * La ruta de los saltos, contra la aplicación montada.
 *
 * Ninguna prueba sale a la red: el `fetch` de AniSkip y el resolutor se inyectan,
 * y el id de MAL se siembra en la base como lo dejaría un emparejamiento real. Lo
 * que se mide es lo que la interfaz va a recibir: los intervalos normalizados, el
 * 200 con lista vacía cuando el tercero falla y el 400 sólo cuando la petición
 * está mal escrita.
 */

import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@rona/catalog-store'
import { anilistEntrySchema, type SkipInterval, skipTimesResponseSchema } from '@rona/core'
import { createApp, createContainer } from '../index'

const PORT = 7721
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }

const ANILIST_ID = 555
const MAL_ID = 16498

/** La obra de AniList con su ficha de MAL, como la dejaría el emparejamiento. */
const ENTRADA = anilistEntrySchema.parse({
  id: ANILIST_ID,
  names: { romaji: 'Aurora Nocturna' },
  adult: false,
  genres: [],
  studios: [],
  coverUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/555.jpg',
  siteUrl: 'https://anilist.co/anime/555',
  malId: MAL_ID,
})

/** La forma real medida contra AniSkip, con el `mixed-op` que coexiste con `op`. */
const RESPUESTA = {
  found: true,
  results: [
    {
      interval: { startTime: 128.406, endTime: 218.406 },
      skipType: 'op',
      skipId: 'op-1',
      episodeLength: 1441.94,
    },
    {
      interval: { startTime: 129, endTime: 219 },
      skipType: 'mixed-op',
      skipId: 'mixed-op-1',
      episodeLength: 1441.94,
    },
    {
      interval: { startTime: 1300.5, endTime: 1386.2 },
      skipType: 'ed',
      skipId: 'ed-1',
      episodeLength: 1441.94,
    },
  ],
}

const ESPERADOS: SkipInterval[] = [
  { type: 'op', start: 128.406, end: 218.406 },
  { type: 'op', start: 129, end: 219 },
  { type: 'ed', start: 1300.5, end: 1386.2 },
]

interface Contexto {
  readonly pedir: (ruta: string) => Promise<Response>
  readonly llamadas: readonly string[]
  readonly store: ReturnType<typeof createContainer>['store']
}

async function conApp<T>(
  body: (contexto: Contexto) => Promise<T>,
  opciones: {
    /** Siembra el mapeo anilistId→MAL. Por defecto sí. */
    readonly mapear?: boolean
    readonly respuesta?: () => Response
    readonly offline?: boolean
  } = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'rona-skip-times-'))
  const db = openDb(join(dir, 'rona.db'))
  runMigrations(db)
  const container = createContainer({ db })
  const llamadas: string[] = []

  try {
    if (opciones.mapear !== false)
      await container.store.writeAniListMedia('aurora-nocturna', ENTRADA)

    const servidor = createApp({
      port: PORT,
      session: {
        cookieName: SESSION_COOKIE,
        value: SESSION_VALUE,
        matches: (candidate) => candidate === SESSION_VALUE,
      },
      bootToken: 'token',
      version: '0.1.0',
      plugins: { active: [], rejected: [] },
      container,
      aniskipFetchImpl: async (url) => {
        llamadas.push(url)

        return opciones.respuesta?.() ?? Response.json(RESPUESTA)
      },
      aniskipResolver: async () => ['140.82.121.3'],
      ...(opciones.offline === undefined ? {} : { aniskipOffline: opciones.offline }),
    })

    return await body({
      pedir: async (ruta) =>
        await Promise.resolve(servidor.request(`${BASE}${ruta}`, { headers: GOOD })),
      llamadas,
      store: container.store,
    })
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

describe('GET /api/skip-times/:anilistId/:episode', () => {
  test('con datos, devuelve los intervalos normalizados y una caché privada', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir(`/api/skip-times/${ANILIST_ID}/1?length=1441.94`)
      const cuerpo = skipTimesResponseSchema.parse(await respuesta.json())

      expect(respuesta.status).toBe(200)
      expect(cuerpo).toEqual(ESPERADOS)
      expect(respuesta.headers.get('cache-control')).toBe('private, max-age=3600')
    })
  })

  test('la petición va al host de AniSkip con el id de MAL resuelto', async () => {
    await conApp(async ({ pedir, llamadas }) => {
      await pedir(`/api/skip-times/${ANILIST_ID}/2?length=1440`)

      expect(llamadas).toHaveLength(1)

      const url = new URL(llamadas[0] ?? '')
      expect(url.hostname).toBe('api.aniskip.com')
      expect(url.pathname).toBe(`/v2/skip-times/${MAL_ID}/2`)
      expect(url.searchParams.get('episodeLength')).toBe('1440')
    })
  })

  test('sin ficha de MAL devuelve 200 con la lista vacía y no pregunta a nadie', async () => {
    await conApp(
      async ({ pedir, llamadas }) => {
        const respuesta = await pedir(`/api/skip-times/${ANILIST_ID}/1?length=1440`)

        expect(respuesta.status).toBe(200)
        expect(await respuesta.json()).toEqual([])
        expect(llamadas).toEqual([])
      },
      { mapear: false },
    )
  })

  test('un fallo de AniSkip no produce 500: la ruta responde 200 []', async () => {
    await conApp(
      async ({ pedir, llamadas }) => {
        const respuesta = await pedir(`/api/skip-times/${ANILIST_ID}/1?length=1440`)

        expect(respuesta.status).toBe(200)
        expect(await respuesta.json()).toEqual([])
        expect(llamadas).toHaveLength(1)
      },
      { respuesta: () => new Response('boom', { status: 500 }) },
    )
  })

  test('un cuerpo que no es JSON también degrada a 200 []', async () => {
    await conApp(
      async ({ pedir }) => {
        const respuesta = await pedir(`/api/skip-times/${ANILIST_ID}/1?length=1440`)

        expect(respuesta.status).toBe(200)
        expect(await respuesta.json()).toEqual([])
      },
      { respuesta: () => new Response('<html>') },
    )
  })

  test('un 404 found:false se sirve 200 [], se cachea como miss y no se repite', async () => {
    const cuerpo = { found: false, results: [], message: 'No skip times found', statusCode: 404 }

    await conApp(
      async ({ pedir, llamadas, store }) => {
        const primera = await pedir(`/api/skip-times/${ANILIST_ID}/1?length=1440`)
        const segunda = await pedir(`/api/skip-times/${ANILIST_ID}/1?length=1440`)

        expect(primera.status).toBe(200)
        expect(segunda.status).toBe(200)
        expect(await primera.json()).toEqual([])
        expect(await segunda.json()).toEqual([])
        // El 404 es «no hay datos», no un fallo: se pregunta una sola vez y la
        // segunda petición sale de la caché persistente con el TTL de miss.
        expect(llamadas).toHaveLength(1)

        const cache = await store.readSkipTimes(`${MAL_ID}:1:1440`)
        expect(cache?.value).toEqual([])
        expect(cache?.ttlS).toBe(21_600)
      },
      {
        respuesta: () =>
          Response.json(cuerpo, {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }),
      },
    )
  })

  test('la segunda petición del mismo episodio sale de la caché, sin red', async () => {
    await conApp(async ({ pedir, llamadas }) => {
      const primera = await pedir(`/api/skip-times/${ANILIST_ID}/1?length=1440`)
      const segunda = await pedir(`/api/skip-times/${ANILIST_ID}/1?length=1440`)

      expect(skipTimesResponseSchema.parse(await primera.json())).toEqual(ESPERADOS)
      expect(skipTimesResponseSchema.parse(await segunda.json())).toEqual(ESPERADOS)
      expect(llamadas).toHaveLength(1)
    })
  })

  test('con el interruptor del arnés no se sale a la red', async () => {
    await conApp(
      async ({ pedir, llamadas }) => {
        const respuesta = await pedir(`/api/skip-times/${ANILIST_ID}/1?length=1440`)

        expect(respuesta.status).toBe(200)
        expect(await respuesta.json()).toEqual([])
        expect(llamadas).toEqual([])
      },
      { offline: true },
    )
  })
})

describe('los parámetros inválidos son 400', () => {
  function ruta(anilistId: string, episode: string, length?: string): string {
    const consulta = length === undefined ? '' : `?length=${length}`

    return `/api/skip-times/${anilistId}/${episode}${consulta}`
  }

  const CASOS: readonly (readonly [string, string, string | undefined])[] = [
    ['0', '1', undefined],
    ['-1', '1', undefined],
    ['abc', '1', undefined],
    ['1.5', '1', undefined],
    ['99999999999999999999', '1', undefined],
    ['555', '-1', undefined],
    ['555', '1.5', undefined],
    ['555', 'abc', undefined],
    ['555', '1', '0'],
    ['555', '1', '-3'],
    ['555', '1', 'abc'],
    ['555', '1', 'Infinity'],
    ['555', '1', '99999999999999999999'],
    ['555', '1', '4294967296'],
  ]

  for (const [anilistId, episode, length] of CASOS) {
    test(`${ruta(anilistId, episode, length)} es 400`, async () => {
      await conApp(async ({ pedir, llamadas }) => {
        const respuesta = await pedir(ruta(anilistId, episode, length))

        expect(respuesta.status).toBe(400)
        expect(llamadas).toEqual([])
      })
    })
  }

  test('un parámetro inválido no gasta ninguna consulta aunque haya mapeo', async () => {
    await conApp(async ({ pedir, llamadas }) => {
      const respuesta = await pedir(ruta('abc', '1', '1440'))

      expect(respuesta.status).toBe(400)
      expect(llamadas).toEqual([])
    })
  })

  test('sin duración la petición es válida y responde 200 [] sin salir a la red', async () => {
    await conApp(async ({ pedir, llamadas }) => {
      const respuesta = await pedir(ruta('555', '1'))

      expect(respuesta.status).toBe(200)
      expect(await respuesta.json()).toEqual([])
      expect(llamadas).toEqual([])
    })
  })

  test('el episodio 0 es válido: existe como especial', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir(ruta('555', '0', '1440'))

      expect(respuesta.status).toBe(200)
    })
  })
})
