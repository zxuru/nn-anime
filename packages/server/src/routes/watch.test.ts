import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { createApp, createContainer } from '../index'
import { HISTORY_PAGE_SIZE } from './watch'

const PORT = 7717
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }
const JSON_HEADERS = { ...GOOD, 'content-type': 'application/json' }

const REF = 'aurora-nocturna'
const ALTA = {
  animeRef: { providerId: 'fixture', value: REF },
  episodeRef: { providerId: 'fixture', value: `${REF}#1` },
  mode: 'sub' as const,
}

interface Contexto {
  readonly pedir: (ruta: string, init?: RequestInit) => Promise<Response>
  readonly db: ReturnType<typeof openDb>
  readonly recientes: () => Promise<readonly { positionS: number; mode: string }[]>
}

async function conApp<T>(body: (contexto: Contexto) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-watch-'))
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

    // El episodio tiene que estar en la base: la clave foránea lo exige, y el
    // flujo real es abrir la ficha antes de darle a reproducir.
    await servidor.request(`${BASE}/api/anime/fixture/${REF}/episodes`, { headers: GOOD })

    return await body({
      pedir: async (ruta, init) =>
        await Promise.resolve(servidor.request(`${BASE}${ruta}`, init ?? { headers: GOOD })),
      db,
      recientes: async () => {
        const filas = await container.store.listRecentlyWatched(10)

        return filas.map((fila) => ({ positionS: fila.positionS, mode: fila.mode }))
      },
    })
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

function alta(pedir: Contexto['pedir'], cuerpo: unknown = ALTA) {
  return pedir('/api/watch', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(cuerpo),
  })
}

describe('POST /api/watch', () => {
  test('abre una fila y devuelve su identificador', async () => {
    await conApp(async ({ pedir, recientes }) => {
      const respuesta = await alta(pedir)
      const cuerpo = (await respuesta.json()) as { id: number }

      expect(respuesta.status).toBe(201)
      expect(cuerpo.id).toBeGreaterThan(0)
      expect(await recientes()).toEqual([{ positionS: 0, mode: 'sub' }])
    })
  })

  test('sin reproducción real no se registra nada', async () => {
    await conApp(async ({ pedir, db }) => {
      // Sólo cargar la ficha no abre ningún visionado: el alta es de quien
      // reproduce, y el reproductor es quien la manda.
      await pedir(`/api/anime/fixture/${REF}`)

      const filas = db.query('SELECT COUNT(*) AS total FROM watch_event').get() as { total: number }

      expect(filas.total).toBe(0)
    })
  })

  test('`startAtS` se guarda como posición inicial', async () => {
    await conApp(async ({ pedir, recientes }) => {
      await alta(pedir, { ...ALTA, startAtS: 120 })

      expect(await recientes()).toEqual([{ positionS: 120, mode: 'sub' }])
    })
  })

  test('un episodio que no está en la base es 404', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await alta(pedir, {
        ...ALTA,
        episodeRef: { providerId: 'fixture', value: 'no-existe#9' },
      })

      expect(respuesta.status).toBe(404)
    })
  })

  test('un cuerpo inválido es 400', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await alta(pedir, { episodeRef: ALTA.episodeRef })

      expect(respuesta.status).toBe(400)
    })
  })

  test('exige sesión', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/watch', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify(ALTA),
      })

      expect(respuesta.status).toBe(401)
    })
  })
})

describe('PATCH /api/watch/:id', () => {
  test('mueve la posición y aparece en «continuar viendo»', async () => {
    await conApp(async ({ pedir, recientes }) => {
      const { id } = (await (await alta(pedir)).json()) as { id: number }

      const avance = await pedir(`/api/watch/${id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 300, durationS: 1440 }),
      })

      expect(avance.status).toBe(204)
      expect(await recientes()).toEqual([{ positionS: 300, mode: 'sub' }])
    })
  })

  test('varios avances dejan la última posición', async () => {
    await conApp(async ({ pedir, recientes }) => {
      const { id } = (await (await alta(pedir)).json()) as { id: number }

      for (const positionS of [15, 30, 45]) {
        await pedir(`/api/watch/${id}`, {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ positionS, durationS: 1440 }),
        })
      }

      expect(await recientes()).toEqual([{ positionS: 45, mode: 'sub' }])
    })
  })

  test('un identificador que no existe es 404 y uno inválido, 400', async () => {
    await conApp(async ({ pedir }) => {
      const inexistente = await pedir('/api/watch/9999', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 1, durationS: 2 }),
      })
      const invalido = await pedir('/api/watch/abc', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 1, durationS: 2 }),
      })

      expect([inexistente.status, invalido.status]).toEqual([404, 400])
    })
  })

  test('una posición negativa es 400', async () => {
    await conApp(async ({ pedir }) => {
      const { id } = (await (await alta(pedir)).json()) as { id: number }
      const respuesta = await pedir(`/api/watch/${id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: -5, durationS: 10 }),
      })

      expect(respuesta.status).toBe(400)
    })
  })
})

describe('los dos modos son dos visionados', () => {
  test('sub y dub abren filas distintas', async () => {
    await conApp(async ({ pedir, db }) => {
      await alta(pedir)
      await alta(pedir, { ...ALTA, mode: 'dub' })

      const filas = db.query('SELECT COUNT(*) AS total FROM watch_event').get() as { total: number }

      expect(filas.total).toBe(2)
    })
  })
})

describe('GET /api/watch/recent', () => {
  test('sin nada visto, la lista está vacía', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/watch/recent')

      expect(respuesta.status).toBe(200)
      expect(await respuesta.json()).toEqual({ items: [] })
    })
  })

  test('un visionado a medias aparece con su posición y su proporción', async () => {
    await conApp(async ({ pedir }) => {
      const { id } = (await (await alta(pedir)).json()) as { id: number }
      await pedir(`/api/watch/${id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 720, durationS: 1440 }),
      })

      const cuerpo = (await (await pedir('/api/watch/recent')).json()) as {
        items: { positionS: number; ratio: number; episodeNumber: number; mode: string }[]
      }

      expect(cuerpo.items).toHaveLength(1)
      expect(cuerpo.items[0]?.positionS).toBe(720)
      expect(cuerpo.items[0]?.ratio).toBeCloseTo(0.5, 6)
      expect(cuerpo.items[0]?.mode).toBe('sub')
    })
  })

  test('lo terminado no aparece: ya se vio', async () => {
    await conApp(async ({ pedir }) => {
      const { id } = (await (await alta(pedir)).json()) as { id: number }
      await pedir(`/api/watch/${id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 1440, durationS: 1440 }),
      })

      const cuerpo = (await (await pedir('/api/watch/recent')).json()) as { items: unknown[] }

      expect(cuerpo.items).toEqual([])
    })
  })

  test('abrir y cerrar no es «estar viendo»: por debajo del 2 % no aparece', async () => {
    await conApp(async ({ pedir }) => {
      const { id } = (await (await alta(pedir)).json()) as { id: number }
      await pedir(`/api/watch/${id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 5, durationS: 1440 }),
      })

      const cuerpo = (await (await pedir('/api/watch/recent')).json()) as { items: unknown[] }

      expect(cuerpo.items).toEqual([])
    })
  })

  test('lo que está a punto de acabarse tampoco', async () => {
    await conApp(async ({ pedir }) => {
      const { id } = (await (await alta(pedir)).json()) as { id: number }
      await pedir(`/api/watch/${id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 1430, durationS: 1440 }),
      })

      const cuerpo = (await (await pedir('/api/watch/recent')).json()) as { items: unknown[] }

      expect(cuerpo.items).toEqual([])
    })
  })

  test('sin duración conocida no se inventa una proporción', async () => {
    await conApp(async ({ pedir }) => {
      await alta(pedir)

      const cuerpo = (await (await pedir('/api/watch/recent')).json()) as { items: unknown[] }

      // Duración cero y sin terminar: proporción cero, así que no es «continuar».
      expect(cuerpo.items).toEqual([])
    })
  })

  test('el mismo episodio deja una sola tarjeta, la que más avanzó', async () => {
    await conApp(async ({ pedir }) => {
      // Cada reproducción abre su fila: abrir el episodio otra vez no puede
      // pintar la misma tarjeta dos veces.
      const primera = (await (await alta(pedir)).json()) as { id: number }
      await pedir(`/api/watch/${primera.id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 300, durationS: 1440 }),
      })

      const segunda = (await (await alta(pedir)).json()) as { id: number }
      await pedir(`/api/watch/${segunda.id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 30, durationS: 1440 }),
      })

      const cuerpo = (await (await pedir('/api/watch/recent')).json()) as {
        items: { positionS: number }[]
      }

      expect(cuerpo.items).toHaveLength(1)
      // La que más avanzó y no la última que se tocó: reabrir el episodio y
      // dejarlo a los treinta segundos no borra los cinco minutos de antes.
      expect(cuerpo.items[0]?.positionS).toBe(300)
    })
  })

  test('dos temporadas con el mismo número son dos tarjetas y conservan su referencia', async () => {
    await conApp(async ({ pedir, db }) => {
      // El proveedor de la serie es el fixture: el contenedor acota las lecturas
      // locales a los proveedores activos, y una serie de un proveedor que no
      // está cargado no saldría. Lo que se mide aquí es la proyección del
      // visionado, no el alcance.
      db.exec(
        "INSERT INTO anime (provider_id, provider_ref, title, fetched_at, ttl_s) VALUES ('fixture', 'serie/uno', 'Serie Uno', 0, 0)",
      )
      const anime = db
        .query('SELECT id FROM anime WHERE provider_id = ? AND provider_ref = ?')
        .get('fixture', 'serie/uno') as { id: number } | null
      if (anime === null) throw new Error('no se pudo crear el anime de la prueba')

      db.exec(
        `INSERT INTO episode (anime_id, provider_ref, number, season, mode, fetched_at, ttl_s) VALUES
           (${anime.id}, 'serie/uno/temporada/1#1', 1, 1, 'sub', 0, 0),
           (${anime.id}, 'serie/uno/temporada/2#1', 1, 2, 'sub', 0, 0)`,
      )

      for (const [temporada, posicion] of [
        [1, 100],
        [2, 200],
      ] as const) {
        const respuesta = await alta(pedir, {
          animeRef: { providerId: 'fixture', value: 'serie/uno' },
          episodeRef: { providerId: 'fixture', value: `serie/uno/temporada/${temporada}#1` },
          mode: 'sub',
        })
        expect(respuesta.status).toBe(201)
        const { id } = (await respuesta.json()) as { id: number }
        const avance = await pedir(`/api/watch/${id}`, {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ positionS: posicion, durationS: 1440 }),
        })
        expect(avance.status).toBe(204)
      }

      const cuerpo = (await (await pedir('/api/watch/recent')).json()) as {
        items: { season?: number; episodeRef: { value: string }; positionS: number }[]
      }

      // Dos episodios distintos, no uno: la clave es la referencia, no
      // `animeRef + número`. Y la referencia es la real, no una reconstruida.
      expect(cuerpo.items).toHaveLength(2)
      expect(
        cuerpo.items
          .map((item) => [item.season, item.episodeRef.value, item.positionS] as const)
          .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0)),
      ).toEqual([
        [1, 'serie/uno/temporada/1#1', 100],
        [2, 'serie/uno/temporada/2#1', 200],
      ])
    })
  })

  test('un episodio terminado no resucita por una fila vieja a medias', async () => {
    await conApp(async ({ pedir }) => {
      const vieja = (await (await alta(pedir)).json()) as { id: number }
      await pedir(`/api/watch/${vieja.id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 300, durationS: 1440 }),
      })

      const nueva = (await (await alta(pedir)).json()) as { id: number }
      await pedir(`/api/watch/${nueva.id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 1400, durationS: 1440 }),
      })

      const cuerpo = (await (await pedir('/api/watch/recent')).json()) as { items: unknown[] }

      expect(cuerpo.items).toEqual([])
    })
  })

  /**
   * La marca de visto se lleva su título de la fila.
   *
   * Aquí se mide la mitad **visible**: de dos títulos a medias, el marcado no sale
   * y el otro sí —que es lo que distingue «lo filtré» de «devolví vacío»—. El
   * filtro vive en esta ruta y no en `listRecentlyWatched` a propósito: esa lectura
   * es también la señal de afinidad del motor, así que filtrarla en la consulta
   * borraría del motor un título que sí se vio. Esa otra mitad se mide en
   * `recommend/signals.test.ts`.
   */
  test('una obra marcada como vista no sale, y las demás sí', async () => {
    await conApp(async ({ pedir }) => {
      const OTRO = 'mar-de-cristal'
      await pedir(`/api/anime/fixture/${OTRO}/episodes`, { headers: GOOD })

      const marcada = await alta(pedir, ALTA)
      await pedir(`/api/watch/${((await marcada.json()) as { id: number }).id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 720, durationS: 1440 }),
      })

      const otra = await alta(pedir, {
        animeRef: { providerId: 'fixture', value: OTRO },
        episodeRef: { providerId: 'fixture', value: `${OTRO}#1` },
        mode: 'sub',
      })
      await pedir(`/api/watch/${((await otra.json()) as { id: number }).id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ positionS: 700, durationS: 1440 }),
      })

      // Las dos están a medias: el control.
      const antes = (await (await pedir('/api/watch/recent')).json()) as {
        items: { title: string }[]
      }
      expect(antes.items.map((item) => item.title).sort()).toEqual([
        'Aurora Nocturna',
        'Mar de Cristal',
      ])

      await pedir('/api/watched-titles', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ref: { providerId: 'fixture', value: REF }, value: true }),
      })

      const despues = (await (await pedir('/api/watch/recent')).json()) as {
        items: { title: string }[]
      }

      expect(despues.items.map((item) => item.title)).toEqual(['Mar de Cristal'])
    })
  })

  test('exige sesión', async () => {
    await conApp(async ({ pedir }) => {
      expect((await pedir('/api/watch/recent', { headers: {} })).status).toBe(401)
    })
  })
})

/**
 * `GET /api/watch/history`, el historial paginado.
 *
 * Es la lectura que alimenta la pantalla del Historial, a la que se llega desde el
 * Perfil. Lo que se mide aquí, además del troceado, es la diferencia con
 * «continuar viendo»: **nada se descarta** —lo terminado también cuenta— y **nada
 * se agrupa** por episodio, porque el historial cuenta lo que pasó y no lo que
 * queda por terminar.
 */
describe('GET /api/watch/history', () => {
  /** Registra un visionado y lo deja en el estado pedido. */
  async function visionado(
    pedir: Contexto['pedir'],
    numero: number,
    positionS: number,
    durationS: number,
  ) {
    const alta = await pedir('/api/watch', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        animeRef: { providerId: 'fixture', value: REF },
        episodeRef: { providerId: 'fixture', value: `${REF}#${numero}` },
        mode: 'sub',
      }),
    })
    const { id } = (await alta.json()) as { id: number }

    await pedir(`/api/watch/${id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ positionS, durationS }),
    })

    return id
  }

  test('sin nada reproducido, la página está vacía y no promete más', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/watch/history')
      const cuerpo = (await respuesta.json()) as {
        items: unknown[]
        page: number
        hasMore: boolean
      }

      expect(respuesta.status).toBe(200)
      expect(cuerpo.items).toEqual([])
      expect(cuerpo.page).toBe(1)
      expect(cuerpo.hasMore).toBe(false)
    })
  })

  test('una fila por visionado, con su episodio, su modo y su proporción', async () => {
    await conApp(async ({ pedir }) => {
      await visionado(pedir, 1, 300, 1440)

      const cuerpo = (await (await pedir('/api/watch/history')).json()) as {
        items: { episodeNumber: number; mode: string; ratio: number; finished: boolean }[]
      }

      expect(cuerpo.items).toHaveLength(1)
      expect(cuerpo.items[0]?.episodeNumber).toBe(1)
      expect(cuerpo.items[0]?.mode).toBe('sub')
      expect(cuerpo.items[0]?.ratio).toBeCloseTo(300 / 1440, 3)
      expect(cuerpo.items[0]?.finished).toBe(false)
    })
  })

  test('lo terminado también cuenta, al contrario que en «continuar viendo»', async () => {
    await conApp(async ({ pedir }) => {
      await visionado(pedir, 1, 1440, 1440)

      const historial = (await (await pedir('/api/watch/history')).json()) as {
        items: { finished: boolean }[]
      }
      const recientes = (await (await pedir('/api/watch/recent')).json()) as { items: unknown[] }

      expect(historial.items[0]?.finished).toBe(true)
      // La fila de la home lo descarta: ya se vio. El historial lo conserva.
      expect(recientes.items).toEqual([])
    })
  })

  test('el mismo episodio dos veces son dos renglones: no se agrupa', async () => {
    await conApp(async ({ pedir }) => {
      await visionado(pedir, 1, 100, 1440)
      await visionado(pedir, 1, 200, 1440)

      const cuerpo = (await (await pedir('/api/watch/history')).json()) as {
        items: { episodeNumber: number }[]
      }

      expect(cuerpo.items).toHaveLength(2)
      expect(cuerpo.items.map((item) => item.episodeNumber)).toEqual([1, 1])
    })
  })

  test('la segunda página no repite lo de la primera', async () => {
    await conApp(async ({ pedir }) => {
      /*
        Una página llena y una fila más.

        Se reproduce **el mismo episodio** una y otra vez, que es legítimo: el
        historial no agrupa, así que cada reproducción es un renglón. Con los doce
        episodios del fixture no habría forma de llenar una página de cincuenta, y
        sembrar la base a mano probaría el troceado sobre datos que ninguna ruta
        escribió.

        Cada uno con su posición: es lo que hace única a cada fila para poder
        comprobar que las dos páginas no repiten ninguna.
      */
      for (let indice = 0; indice < HISTORY_PAGE_SIZE + 1; indice++) {
        await visionado(pedir, 1, 100 + indice, 1440)
      }

      const primera = (await (await pedir('/api/watch/history')).json()) as {
        items: { positionS: number }[]
        hasMore: boolean
      }
      const segunda = (await (await pedir('/api/watch/history?page=2')).json()) as {
        items: { positionS: number }[]
        hasMore: boolean
      }

      expect(primera.items).toHaveLength(HISTORY_PAGE_SIZE)
      expect(primera.hasMore).toBe(true)
      expect(segunda.items).toHaveLength(1)
      expect(segunda.hasMore).toBe(false)

      const posiciones = [...primera.items, ...segunda.items].map((item) => item.positionS)

      expect(new Set(posiciones).size).toBe(HISTORY_PAGE_SIZE + 1)
    })
  })

  test('una página más allá del final es una lista vacía, no un error', async () => {
    await conApp(async ({ pedir }) => {
      await visionado(pedir, 1, 100, 1440)

      const respuesta = await pedir('/api/watch/history?page=9')

      expect(respuesta.status).toBe(200)
      expect(await respuesta.json()).toEqual({ items: [], page: 9, hasMore: false })
    })
  })

  test('una página inventada es 400 con el motivo, como en la lista de episodios', async () => {
    await conApp(async ({ pedir }) => {
      const cero = await pedir('/api/watch/history?page=0')
      const texto = await pedir('/api/watch/history?page=abc')

      expect([cero.status, texto.status]).toEqual([400, 400])
      expect(JSON.stringify(await texto.json())).toContain('página')
    })
  })

  test('exige sesión', async () => {
    await conApp(async ({ pedir }) => {
      expect((await pedir('/api/watch/history', { headers: {} })).status).toBe(401)
    })
  })
})
