import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import { planToWatchResponseSchema } from '@nn-anime/core'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { createApp, createContainer } from '../index'

const PORT = 7719
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
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-pendientes-'))
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

function marcar(pedir: (ruta: string, init?: RequestInit) => Promise<Response>, value: boolean) {
  return pedir('/api/plan-to-watch', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ ref: AURORA, value }),
  })
}

/**
 * La marca de «quiero ver», por HTTP.
 *
 * Es el contrato de favoritos y vistos copiado a propósito —204 al dejarla en el
 * estado pedido, 404 si el título no está, 400 si el cuerpo no valida, 401 sin
 * sesión— y se mide aquí porque es lo que el botón de la ficha va a recibir.
 *
 * Lo que sí cambia respecto de la marca de visto es el filtro de adultos: como el
 * resto de listas que pintan tarjetas, ésta esconde lo marcado con el interruptor
 * apagado. Tiene su caso abajo.
 */
describe('la marca de quiero ver', () => {
  test('sin nada marcado, la lista está vacía', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/plan-to-watch')

      expect(respuesta.status).toBe(200)
      expect(await respuesta.json()).toEqual({ items: [] })
    })
  })

  test('marcar y leer: el título sale con su portada y su año, sin la fecha', async () => {
    await conApp(async ({ pedir }) => {
      await conDetalle(pedir)

      expect((await marcar(pedir, true)).status).toBe(204)

      const lista = planToWatchResponseSchema.parse(
        await (await pedir('/api/plan-to-watch')).json(),
      )

      expect(lista.items).toHaveLength(1)
      expect(lista.items[0]?.title).toBe('Aurora Nocturna')
      expect(lista.items[0]?.year).toBe(2019)
      expect(lista.items[0]?.coverUrl).toContain('fixture.invalid')
      // La fecha de la marca no viaja: la usa el motor y la interfaz no la pinta.
      expect(lista.items[0]).not.toHaveProperty('createdAt')
    })
  })

  test('marcar dos veces no duplica ni falla', async () => {
    await conApp(async ({ pedir, db }) => {
      await conDetalle(pedir)

      const estados = [(await marcar(pedir, true)).status, (await marcar(pedir, true)).status]

      expect(estados).toEqual([204, 204])
      const filas = db.query('SELECT COUNT(*) AS total FROM plan_to_watch').get() as {
        total: number
      }
      expect(filas.total).toBe(1)
    })
  })

  test('marcar no escribe ningún visionado: declara una intención, no un visionado', async () => {
    await conApp(async ({ pedir, db }) => {
      await conDetalle(pedir)
      await marcar(pedir, true)

      const filas = db.query('SELECT COUNT(*) AS total FROM watch_event').get() as {
        total: number
      }

      // Querer ver algo no es haberlo visto: fabricar progreso que nadie hizo
      // ensuciaría la afinidad del motor.
      expect(filas.total).toBe(0)
    })
  })

  test('no toca las otras dos marcas: las tres listas son independientes', async () => {
    await conApp(async ({ pedir }) => {
      await conDetalle(pedir)
      await marcar(pedir, true)

      // Marcar como pendiente no la mete en favoritos ni la marca como vista.
      expect(await (await pedir('/api/favorites')).json()).toEqual({ favorites: [] })
      expect(await (await pedir('/api/watched-titles')).json()).toEqual({ items: [] })

      await pedir('/api/watched-titles', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ref: AURORA, value: true }),
      })

      // Y marcar como vista no la saca de pendientes.
      const pendientes = planToWatchResponseSchema.parse(
        await (await pedir('/api/plan-to-watch')).json(),
      )
      expect(pendientes.items).toHaveLength(1)

      await marcar(pedir, false)

      // Ni quitarla de pendientes desmarca el visto.
      const vistos = (await (await pedir('/api/watched-titles')).json()) as { items: unknown[] }
      expect(vistos.items).toHaveLength(1)
    })
  })

  test('desmarcar lo saca de la lista', async () => {
    await conApp(async ({ pedir }) => {
      await conDetalle(pedir)
      await marcar(pedir, true)
      await marcar(pedir, false)

      expect(await (await pedir('/api/plan-to-watch')).json()).toEqual({ items: [] })
    })
  })

  test('marcar un título que no está es 404, no 500', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/plan-to-watch', {
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
      const sinValue = await pedir('/api/plan-to-watch', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ref: AURORA }),
      })
      const noJson = await pedir('/api/plan-to-watch', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: 'esto no es json',
      })

      expect([sinValue.status, noJson.status]).toEqual([400, 400])
    })
  })

  test('las dos exigen sesión', async () => {
    await conApp(async ({ pedir }) => {
      const lista = await pedir('/api/plan-to-watch', { headers: {} })
      // Sin `Origin` y siendo un método que muta, el guard de origen corta antes
      // que el de sesión: 403. Con `Origin` correcto pero sin cookie, 401.
      const sinOrigen = await pedir('/api/plan-to-watch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref: AURORA, value: true }),
      })
      const sinSesion = await pedir('/api/plan-to-watch', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ ref: AURORA, value: true }),
      })

      expect([lista.status, sinOrigen.status, sinSesion.status]).toEqual([401, 403, 401])
    })
  })
})

/**
 * Y la lectura **sí** filtra por adultos, al contrario que la marca de visto.
 *
 * Es una lista que el Perfil pinta como tarjetas, y las tres listas del Perfil se
 * filtran igual: con el interruptor apagado, lo marcado no se enseña. Se mide
 * apagado —el caso en el que el filtro muerde— y encendido, para comprobar que el
 * ajuste es lo que decide.
 */
describe('el filtro de adultos en quiero ver', () => {
  test('con el interruptor apagado la obra marcada no se enseña, y encendido sí', async () => {
    await conApp(async ({ pedir, db }) => {
      await conDetalle(pedir)
      await marcar(pedir, true)
      db.query("INSERT INTO adult_ref (provider_id, provider_ref) VALUES ('fixture', ?)").run(
        AURORA.value,
      )

      const apagado = planToWatchResponseSchema.parse(
        await (await pedir('/api/plan-to-watch')).json(),
      )
      expect(apagado.items).toEqual([])

      await pedir('/api/settings', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ adultContent: true }),
      })

      const encendido = planToWatchResponseSchema.parse(
        await (await pedir('/api/plan-to-watch')).json(),
      )
      expect(encendido.items).toHaveLength(1)
    })
  })
})
