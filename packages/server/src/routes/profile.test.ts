import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import { profileResponseSchema } from '@nn-anime/core'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { createApp, createContainer } from '../index'
import { PROFILE_HISTORY_PREVIEW } from './profile'

const PORT = 7720
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }
const JSON_HEADERS = { ...GOOD, 'content-type': 'application/json' }

const REF = 'aurora-nocturna'
const AURORA = { providerId: 'fixture', value: REF }

async function conApp<T>(
  body: (contexto: {
    pedir: (ruta: string, init?: RequestInit) => Promise<Response>
    db: ReturnType<typeof openDb>
  }) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-perfil-'))
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

/** Abre la ficha y su lista de episodios: sin ellos, marcar y reproducir es un 404. */
async function abrirFicha(pedir: (ruta: string, init?: RequestInit) => Promise<Response>) {
  await pedir(`/api/anime/fixture/${REF}`, { headers: GOOD })
  await pedir(`/api/anime/fixture/${REF}/episodes`, { headers: GOOD })
}

function marcar(
  pedir: (ruta: string, init?: RequestInit) => Promise<Response>,
  ruta: string,
  value: boolean,
) {
  return pedir(ruta, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ ref: AURORA, value }),
  })
}

/** Un visionado real: el alta sólo la hace el reproductor cuando empieza a verse. */
async function ver(
  pedir: (ruta: string, init?: RequestInit) => Promise<Response>,
  numero: number,
  startAtS = 0,
) {
  const respuesta = await pedir('/api/watch', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      animeRef: AURORA,
      episodeRef: { providerId: 'fixture', value: `${REF}#${numero}` },
      mode: 'sub',
      startAtS,
    }),
  })

  return ((await respuesta.json()) as { id: number }).id
}

/**
 * El avance, como lo manda el reproductor.
 *
 * Hace falta para que la duración esté: el alta la escribe a cero porque en ese
 * momento nadie la conoce —el medio todavía no ha cargado—, así que la proporción
 * vista sólo existe a partir del primer avance.
 */
function avanzar(
  pedir: (ruta: string, init?: RequestInit) => Promise<Response>,
  id: number,
  positionS: number,
  durationS: number,
) {
  return pedir(`/api/watch/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ positionS, durationS }),
  })
}

function perfil(pedir: (ruta: string, init?: RequestInit) => Promise<Response>) {
  return pedir('/api/profile').then(async (respuesta) => ({
    status: respuesta.status,
    cuerpo: profileResponseSchema.parse(await respuesta.json()),
  }))
}

/**
 * El Perfil, por HTTP.
 *
 * Es **una** respuesta con las cuatro listas del usuario, y de ahí salen los casos:
 * que las cuatro estén siempre —aunque estén vacías—, que las fechas de las marcas
 * no viajen, que el historial venga con la forma paginada de su ruta, y que el
 * filtro de adultos se aplique a las cuatro por igual.
 */
describe('GET /api/profile', () => {
  test('sin nada del usuario, las cuatro secciones están y vacías', async () => {
    await conApp(async ({ pedir }) => {
      const { status, cuerpo } = await perfil(pedir)

      expect(status).toBe(200)
      expect(cuerpo.favorites).toEqual([])
      expect(cuerpo.watched).toEqual([])
      expect(cuerpo.planToWatch).toEqual([])
      expect(cuerpo.history).toEqual({ items: [], page: 1, hasMore: false })
    })
  })

  test('reúne las tres marcas y el visionado en una sola respuesta', async () => {
    await conApp(async ({ pedir }) => {
      await abrirFicha(pedir)
      await marcar(pedir, '/api/favorites', true)
      await marcar(pedir, '/api/watched-titles', true)
      await marcar(pedir, '/api/plan-to-watch', true)
      const id = await ver(pedir, 1, 300)
      await avanzar(pedir, id, 300, 1440)

      const { cuerpo } = await perfil(pedir)

      expect(cuerpo.favorites.map((item) => item.title)).toEqual(['Aurora Nocturna'])
      expect(cuerpo.watched.map((item) => item.title)).toEqual(['Aurora Nocturna'])
      expect(cuerpo.planToWatch.map((item) => item.title)).toEqual(['Aurora Nocturna'])
      expect(cuerpo.history.items).toHaveLength(1)
      expect(cuerpo.history.items[0]?.episodeNumber).toBe(1)
      expect(cuerpo.history.items[0]?.positionS).toBe(300)
      // La proporción la calcula el servidor, como en «continuar viendo».
      expect(cuerpo.history.items[0]?.ratio).toBeCloseTo(300 / 1440, 3)
      expect(cuerpo.history.page).toBe(1)
    })
  })

  test('las fechas de las marcas no viajan: son para el motor, no para la pantalla', async () => {
    await conApp(async ({ pedir }) => {
      await abrirFicha(pedir)
      await marcar(pedir, '/api/watched-titles', true)
      await marcar(pedir, '/api/plan-to-watch', true)

      const { cuerpo } = await perfil(pedir)

      // El schema del contrato es estricto: si las fechas viajaran, el `parse` de
      // arriba habría lanzado. Se afirma igualmente para que el motivo se lea.
      expect(cuerpo.watched[0]).not.toHaveProperty('watchedAt')
      expect(cuerpo.planToWatch[0]).not.toHaveProperty('createdAt')
    })
  })

  test('el historial trae una fila de más que la vista previa, y lo dice', async () => {
    await conApp(async ({ pedir }) => {
      await abrirFicha(pedir)
      for (let numero = 1; numero <= PROFILE_HISTORY_PREVIEW + 1; numero++) {
        await ver(pedir, numero)
      }

      const { cuerpo } = await perfil(pedir)

      // La vista previa se corta en su tope y `hasMore` avisa de que queda algo
      // detrás, que es lo que decide si el Perfil ofrece el enlace al Historial.
      expect(cuerpo.history.items).toHaveLength(PROFILE_HISTORY_PREVIEW)
      expect(cuerpo.history.hasMore).toBe(true)
    })
  })

  test('con el historial justo en el tope no promete más de lo que hay', async () => {
    await conApp(async ({ pedir }) => {
      await abrirFicha(pedir)
      for (let numero = 1; numero <= PROFILE_HISTORY_PREVIEW; numero++) await ver(pedir, numero)

      const { cuerpo } = await perfil(pedir)

      expect(cuerpo.history.items).toHaveLength(PROFILE_HISTORY_PREVIEW)
      expect(cuerpo.history.hasMore).toBe(false)
    })
  })

  test('las cuatro listas se filtran por adultos con el interruptor apagado', async () => {
    await conApp(async ({ pedir, db }) => {
      await abrirFicha(pedir)
      await marcar(pedir, '/api/favorites', true)
      await marcar(pedir, '/api/watched-titles', true)
      await marcar(pedir, '/api/plan-to-watch', true)
      await ver(pedir, 1)
      db.query("INSERT INTO adult_ref (provider_id, provider_ref) VALUES ('fixture', ?)").run(REF)

      const { cuerpo } = await perfil(pedir)

      // La marca es del usuario, pero el Perfil pinta tarjetas: con el interruptor
      // apagado no se enseña ninguna de las cuatro.
      expect(cuerpo.favorites).toEqual([])
      expect(cuerpo.watched).toEqual([])
      expect(cuerpo.planToWatch).toEqual([])
      expect(cuerpo.history.items).toEqual([])
    })
  })

  test('exige sesión', async () => {
    await conApp(async ({ pedir }) => {
      expect((await pedir('/api/profile', { headers: {} })).status).toBe(401)
    })
  })
})
