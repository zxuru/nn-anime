import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@rona/catalog-store'
import {
  PROFILE_EXPORT_VERSION,
  profileExportSchema,
  profileImportResponseSchema,
  profileResponseSchema,
} from '@rona/core'
import { createFixtureProvider } from '@rona/providers-fixture'
import { createApp, createContainer } from '../index'
import {
  PROFILE_EXPORT_FILENAME,
  PROFILE_HISTORY_PREVIEW,
  PROFILE_IMPORT_MAX_BYTES,
} from './profile'

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
  const dir = await mkdtemp(join(tmpdir(), 'rona-perfil-'))
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
  ref: { readonly providerId: string; readonly value: string } = AURORA,
) {
  return pedir(ruta, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ ref, value }),
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

function exportar(pedir: (ruta: string, init?: RequestInit) => Promise<Response>) {
  return pedir('/api/profile/export')
}

function importar(pedir: (ruta: string, init?: RequestInit) => Promise<Response>, cuerpo: unknown) {
  return pedir('/api/profile/import', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(cuerpo),
  })
}

/**
 * Un perfil con las tres listas, un duplicado dentro del archivo y una
 * referencia que esta instalación no conoce.
 *
 * El duplicado es a propósito: contar dos veces la misma marca es la forma más
 * fácil de que el resumen mienta. La referencia ausente es el caso normal de
 * restaurar un perfil en una instalación nueva, donde nadie abrió esa ficha.
 */
const PERFIL_EXPORTADO = {
  version: 1,
  favorites: [
    { providerId: 'fixture', ref: REF, title: 'Aurora Nocturna' },
    { providerId: 'fixture', ref: REF, title: 'Aurora Nocturna' },
    { providerId: 'fixture', ref: 'no-existe', title: 'Sin ficha' },
  ],
  watched: [{ providerId: 'fixture', ref: REF, title: 'Aurora Nocturna' }],
  planToWatch: [{ providerId: 'fixture', ref: REF, title: 'Aurora Nocturna' }],
} as const

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

/**
 * El archivo portátil.
 *
 * Es la copia que el usuario guarda fuera de la aplicación, así que lo que se
 * mide es qué **no** lleva además de qué lleva: ni la clave de TMDB, ni las rutas
 * del disco, ni campos que el importador de mañana no sabría interpretar.
 */
describe('GET /api/profile/export', () => {
  test('un perfil vacío sale en la versión 1, con las tres listas y como descarga', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await exportar(pedir)

      expect(respuesta.status).toBe(200)
      expect(respuesta.headers.get('cache-control')).toBe('no-store')
      expect(respuesta.headers.get('content-disposition')).toBe(
        `attachment; filename="${PROFILE_EXPORT_FILENAME}"`,
      )

      const perfil = profileExportSchema.parse(await respuesta.json())

      expect(perfil).toEqual({
        version: PROFILE_EXPORT_VERSION,
        favorites: [],
        watched: [],
        planToWatch: [],
      })
    })
  })

  test('cada marca lleva proveedor, referencia y título, y nada más', async () => {
    await conApp(async ({ pedir }) => {
      await abrirFicha(pedir)
      await marcar(pedir, '/api/favorites', true)
      await marcar(pedir, '/api/watched-titles', true)
      await marcar(pedir, '/api/plan-to-watch', true)

      const perfil = profileExportSchema.parse(await (await exportar(pedir)).json())
      const entrada = { providerId: 'fixture', ref: REF, title: 'Aurora Nocturna' }

      expect(perfil.favorites).toEqual([entrada])
      expect(perfil.watched).toEqual([entrada])
      expect(perfil.planToWatch).toEqual([entrada])
      // El schema es estricto: si el export añadiera portada, año o fecha, el
      // `parse` de arriba habría lanzado. Se afirma igualmente para que se lea
      // el motivo.
      expect(Object.keys(perfil.favorites[0] ?? {}).sort()).toEqual(['providerId', 'ref', 'title'])
    })
  })

  test('no lleva secretos ni las rutas del disco', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await exportar(pedir)
      const texto = await respuesta.text()
      const perfil = profileExportSchema.parse(JSON.parse(texto))

      expect(texto).not.toContain('tmdb')
      expect(texto).not.toContain('paths')
      expect(Object.keys(perfil).sort()).toEqual(['favorites', 'planToWatch', 'version', 'watched'])
    })
  })
})

/**
 * La importación.
 *
 * Fusiona, no reemplaza: lo que ya estaba sigue, lo que no está en la base local
 * se cuenta y no se inventa, y repetir el archivo no duplica ni infla el resumen.
 */
describe('POST /api/profile/import', () => {
  test('fusiona las tres listas, deduplica el archivo y cuenta los que no están', async () => {
    await conApp(async ({ pedir }) => {
      await abrirFicha(pedir)

      const respuesta = await importar(pedir, PERFIL_EXPORTADO)
      expect(respuesta.status).toBe(200)
      expect(profileImportResponseSchema.parse(await respuesta.json())).toEqual({
        favorites: 1,
        watched: 1,
        planToWatch: 1,
        skipped: 1,
      })

      const { cuerpo } = await perfil(pedir)
      expect(cuerpo.favorites.map((item) => item.ref.value)).toEqual([REF])
      expect(cuerpo.watched.map((item) => item.ref.value)).toEqual([REF])
      expect(cuerpo.planToWatch.map((item) => item.ref.value)).toEqual([REF])
    })
  })

  test('importar dos veces el mismo archivo no duplica y la segunda no añade nada', async () => {
    await conApp(async ({ pedir }) => {
      await abrirFicha(pedir)
      await importar(pedir, PERFIL_EXPORTADO)

      const segunda = await importar(pedir, PERFIL_EXPORTADO)
      expect(profileImportResponseSchema.parse(await segunda.json())).toEqual({
        favorites: 0,
        watched: 0,
        planToWatch: 0,
        skipped: 1,
      })

      const { cuerpo } = await perfil(pedir)
      expect(cuerpo.favorites).toHaveLength(1)
      expect(cuerpo.watched).toHaveLength(1)
      expect(cuerpo.planToWatch).toHaveLength(1)
    })
  })

  test('no borra lo que ya estaba marcado', async () => {
    await conApp(async ({ pedir }) => {
      // Las dos fichas tienen que existir en la base: el perfil de mar está
      // marcado de antes y el de aurora es el que trae el archivo.
      await abrirFicha(pedir)
      await pedir('/api/anime/fixture/mar-de-cristal', { headers: GOOD })
      const mar = { providerId: 'fixture', value: 'mar-de-cristal' }
      await marcar(pedir, '/api/favorites', true, mar)

      await importar(pedir, PERFIL_EXPORTADO)

      const { cuerpo } = await perfil(pedir)
      expect(cuerpo.favorites.map((item) => item.title).sort()).toEqual([
        'Aurora Nocturna',
        'Mar de Cristal',
      ])
    })
  })

  test('una referencia que no está se omite y no se escribe en la caché', async () => {
    await conApp(async ({ pedir, db }) => {
      await abrirFicha(pedir)
      await importar(pedir, PERFIL_EXPORTADO)

      const ausente = db
        .query<{ total: number }, [string]>(
          'SELECT COUNT(*) AS total FROM anime WHERE provider_ref = ?',
        )
        .get('no-existe')
      expect(ausente?.total).toBe(0)

      // La única ficha que hay es la que abrió la prueba: importar no pidió ni
      // guardó nada de un proveedor.
      const todas = db.query<{ total: number }, []>('SELECT COUNT(*) AS total FROM anime').get()
      expect(todas?.total).toBe(1)
    })
  })

  test('un cuerpo que no cumple el schema es 400', async () => {
    await conApp(async ({ pedir }) => {
      for (const cuerpo of [
        { ...PERFIL_EXPORTADO, version: 2 },
        { version: 1, favorites: [], watched: [] },
        { ...PERFIL_EXPORTADO, tmdbApiKey: '0123456789abcdef0123456789abcdef' },
      ]) {
        expect((await importar(pedir, cuerpo)).status).toBe(400)
      }

      const noJson = await pedir('/api/profile/import', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: '{',
      })
      expect(noJson.status).toBe(400)
    })
  })

  test('un archivo que pasa del tope es 413 y no llega al schema', async () => {
    await conApp(async ({ pedir }) => {
      const grande = JSON.stringify({
        ...PERFIL_EXPORTADO,
        relleno: 'x'.repeat(PROFILE_IMPORT_MAX_BYTES),
      })

      const respuesta = await pedir('/api/profile/import', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: grande,
      })

      expect(respuesta.status).toBe(413)
    })
  })

  test('las dos rutas exigen sesión', async () => {
    await conApp(async ({ pedir }) => {
      expect((await pedir('/api/profile/export', { headers: {} })).status).toBe(401)
      expect(
        (
          await pedir('/api/profile/import', {
            method: 'POST',
            headers: { origin: BASE, 'content-type': 'application/json' },
            body: JSON.stringify(PERFIL_EXPORTADO),
          })
        ).status,
      ).toBe(401)
    })
  })
})
