import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import { watchedTitlesResponseSchema } from '@nn-anime/core'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { createApp, createContainer } from '../index'

const PORT = 7718
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }
const JSON_HEADERS = { ...GOOD, 'content-type': 'application/json' }

const AURORA = { providerId: 'fixture', value: 'aurora-nocturna' }

async function conApp<T>(
  body: (contexto: {
    pedir: (ruta: string, init?: RequestInit) => Promise<Response>
    db: ReturnType<typeof openDb>
  }) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-vistos-'))
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

/** Abre la ficha: sin detalle, el título no está en la base y marcar es un 404. */
async function conDetalle(pedir: (ruta: string, init?: RequestInit) => Promise<Response>) {
  return pedir('/api/anime/fixture/aurora-nocturna', { headers: GOOD })
}

/**
 * La marca de visto, por HTTP.
 *
 * Es el contrato de los favoritos copiado a propósito —204 al dejarla en el estado
 * pedido, 404 si el título no está, 400 si el cuerpo no valida, 401 sin sesión— y
 * se mide aquí porque es lo que el botón de la ficha va a recibir. Lo que **no** se
 * copia es el filtro de adultos, y eso tiene su caso abajo.
 */
describe('la marca de visto', () => {
  test('sin nada marcado, la lista está vacía', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/watched-titles')

      expect(respuesta.status).toBe(200)
      expect(await respuesta.json()).toEqual({ items: [] })
    })
  })

  test('marcar y leer: el título sale con su portada y su año, sin la fecha', async () => {
    await conApp(async ({ pedir }) => {
      await conDetalle(pedir)
      const alta = await pedir('/api/watched-titles', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ref: AURORA, value: true }),
      })

      expect(alta.status).toBe(204)

      const lista = watchedTitlesResponseSchema.parse(
        await (await pedir('/api/watched-titles')).json(),
      )
      expect(lista.items).toHaveLength(1)
      expect(lista.items[0]?.title).toBe('Aurora Nocturna')
      expect(lista.items[0]?.year).toBe(2019)
      expect(lista.items[0]?.coverUrl).toContain('fixture.invalid')
      // La fecha de la marca no viaja: la usa el motor y la interfaz no la pinta.
      expect(lista.items[0]).not.toHaveProperty('watchedAt')
    })
  })

  test('marcar dos veces no duplica ni falla', async () => {
    await conApp(async ({ pedir, db }) => {
      await conDetalle(pedir)
      const cuerpo = JSON.stringify({ ref: AURORA, value: true })

      const primera = await pedir('/api/watched-titles', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: cuerpo,
      })
      const segunda = await pedir('/api/watched-titles', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: cuerpo,
      })

      expect([primera.status, segunda.status]).toEqual([204, 204])
      const filas = db.query('SELECT COUNT(*) AS total FROM watched_title').get() as {
        total: number
      }
      expect(filas.total).toBe(1)
    })
  })

  test('marcar no escribe ningún visionado: la marca es de la obra', async () => {
    await conApp(async ({ pedir, db }) => {
      await conDetalle(pedir)
      await pedir('/api/watched-titles', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ref: AURORA, value: true }),
      })

      const filas = db.query('SELECT COUNT(*) AS total FROM watch_event').get() as {
        total: number
      }

      // Un `watch_event` por episodio fabricaría un progreso que nadie hizo y
      // ensuciaría la afinidad del motor, que se calcula con lo que se reprodujo.
      expect(filas.total).toBe(0)
    })
  })

  test('desmarcar lo saca de la lista', async () => {
    await conApp(async ({ pedir }) => {
      await conDetalle(pedir)
      await pedir('/api/watched-titles', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ref: AURORA, value: true }),
      })
      await pedir('/api/watched-titles', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ref: AURORA, value: false }),
      })

      expect(await (await pedir('/api/watched-titles')).json()).toEqual({ items: [] })
    })
  })

  test('marcar un título que no está es 404, no 500', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/watched-titles', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ref: { providerId: 'fixture', value: 'no-existe' }, value: true }),
      })

      expect(respuesta.status).toBe(404)
      expect(JSON.stringify(await respuesta.json())).toContain('no está')
    })
  })

  test('un cuerpo inválido es 400', async () => {
    await conApp(async ({ pedir }) => {
      const sinValue = await pedir('/api/watched-titles', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ref: AURORA }),
      })
      const noJson = await pedir('/api/watched-titles', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: 'esto no es json',
      })

      expect([sinValue.status, noJson.status]).toEqual([400, 400])
    })
  })

  test('las dos exigen sesión', async () => {
    await conApp(async ({ pedir }) => {
      const lista = await pedir('/api/watched-titles', { headers: {} })
      // Sin `Origin` y siendo un método que muta, el guard de origen corta antes
      // que el de sesión: 403. Con `Origin` correcto pero sin cookie, 401.
      const sinOrigen = await pedir('/api/watched-titles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref: AURORA, value: true }),
      })
      const sinSesion = await pedir('/api/watched-titles', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ ref: AURORA, value: true }),
      })

      expect([lista.status, sinOrigen.status, sinSesion.status]).toEqual([401, 403, 401])
    })
  })
})

/**
 * Y la lectura **no** filtra por adultos, que es la decisión que la separa de los
 * favoritos.
 *
 * La lee el botón de la ficha para contestar «¿esta obra está marcada?». Filtrarla
 * dejaría el botón en «no está» sobre una obra que sí lo está, y pulsarlo no haría
 * nada visible: la marca es del usuario, no del catálogo. Se mide con el
 * interruptor **apagado**, que es el caso en el que el filtro mordería.
 */
describe('el filtro de adultos en la marca de visto', () => {
  test('la obra marcada se lee con el interruptor apagado', async () => {
    await conApp(async ({ pedir, db }) => {
      await conDetalle(pedir)
      await pedir('/api/watched-titles', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ref: AURORA, value: true }),
      })
      db.query("INSERT INTO adult_ref (provider_id, provider_ref) VALUES ('fixture', ?)").run(
        AURORA.value,
      )

      const apagado = watchedTitlesResponseSchema.parse(
        await (await pedir('/api/watched-titles')).json(),
      )

      expect(apagado.items).toHaveLength(1)

      // Y con el interruptor encendido, lo mismo: el ajuste no cambia la respuesta.
      await pedir('/api/settings', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ adultContent: true }),
      })

      const encendido = watchedTitlesResponseSchema.parse(
        await (await pedir('/api/watched-titles')).json(),
      )
      expect(encendido.items).toHaveLength(1)
    })
  })
})
