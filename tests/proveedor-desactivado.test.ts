/**
 * Un proveedor que ya no está cargado no ofrece tarjetas.
 *
 * El caso que lo destapó, con la instalación real delante: se desmarca `animex`
 * en Ajustes y la home sigue pintando «The Ramparts of Ice Season 2» como
 * destacado. Al pulsarlo, la ficha contesta 404 —«no hay ningún proveedor
 * llamado animex»—: la aplicación ofreció una puerta que ella misma había
 * cerrado. Desmarcar no borra nada, y **no debe borrar**: volver a marcarlo
 * tiene que devolver el historial a su sitio.
 *
 * Se miden las seis lecturas locales que pueden ofrecer una tarjeta, y se mide
 * **lo contrario** en cada una: con el proveedor cargado, las mismas filas de la
 * base salen. Sin ese control, una lectura que devolviera vacío por cualquier
 * motivo daría la prueba por buena.
 *
 * `/api/feed` y `/api/trending` no están en la lista: sólo preguntan a los
 * proveedores cargados, así que nunca ofrecieron al ausente.
 */

import { describe, expect, test } from 'bun:test'
import type { StoreConnection } from '@nn-anime/catalog-store'
import {
  continueWatchingResponseSchema,
  favoritesResponseSchema,
  recentResponseSchema,
  recommendationsResponseSchema,
  relatedResponseSchema,
  sourcesResponseSchema,
} from '@nn-anime/core'
import type { Provider } from '@nn-anime/provider-sdk'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { type Ciclo, conCiclo } from './fixtures'

/** El proveedor que se desmarca en Ajustes. Sus filas siguen en la base. */
const FANTASMA = 'fantasma'

/** El que sigue cargado, y el que pide las dos lecturas de la ficha. */
const FIJO = 'fixture'

/** Un instante fijo: las filas no dependen del reloj de la máquina. */
const AHORA = 1_800_000_000_000

/** Una lectura local que puede ofrecer una tarjeta, con su ruta y sus referencias. */
interface Superficie {
  readonly ruta: string
  readonly proveedores: (crudo: unknown) => readonly string[]
}

const SUPERFICIES: readonly Superficie[] = [
  {
    ruta: '/api/recommendations?limit=20',
    proveedores: (crudo) =>
      recommendationsResponseSchema.parse(crudo).items.map((item) => item.ref.providerId),
  },
  {
    ruta: '/api/catalog/recent?limit=20',
    proveedores: (crudo) =>
      recentResponseSchema.parse(crudo).items.map((item) => item.ref.providerId),
  },
  {
    ruta: '/api/watch/recent',
    proveedores: (crudo) =>
      continueWatchingResponseSchema.parse(crudo).items.map((item) => item.animeRef.providerId),
  },
  {
    ruta: '/api/favorites',
    proveedores: (crudo) =>
      favoritesResponseSchema.parse(crudo).favorites.map((item) => item.ref.providerId),
  },
  {
    ruta: `/api/anime/${FIJO}/dandadan/related`,
    proveedores: (crudo) =>
      relatedResponseSchema.parse(crudo).items.map((item) => item.ref.providerId),
  },
  {
    ruta: `/api/anime/${FIJO}/dandadan/sources`,
    proveedores: (crudo) =>
      sourcesResponseSchema.parse(crudo).items.map((item) => item.ref.providerId),
  },
]

/**
 * El proveedor que se carga de más en el control.
 *
 * No declara ninguna capacidad: no aporta resultados, sólo existe en el
 * registro. Así lo único que puede hacer salir sus filas es la lectura de la
 * base, que es lo que se está midiendo.
 */
function callado(): Provider {
  const base = createFixtureProvider()

  return {
    ...base,
    id: FANTASMA,
    capabilities: { search: false, sub: false, dub: false, trending: false, feed: false },
  }
}

function insertarAnime(
  db: StoreConnection,
  providerId: string,
  ref: string,
  title: string,
  year: number,
  fetchedAt: number,
): number {
  const fila = db
    .query<{ id: number }, [string, string, string, number, number]>(
      `INSERT INTO anime (provider_id, provider_ref, title, year, fetched_at, ttl_s)
       VALUES (?, ?, ?, ?, ?, 3600) RETURNING id`,
    )
    .get(providerId, ref, title, year, fetchedAt)

  return fila?.id ?? 0
}

function insertarEpisodio(db: StoreConnection, animeId: number, ref: string): number {
  const fila = db
    .query<{ id: number }, [number, string, number]>(
      `INSERT INTO episode (anime_id, provider_ref, number, mode, fetched_at, ttl_s)
       VALUES (?, ?, 1, 'sub', ?, 3600) RETURNING id`,
    )
    .get(animeId, ref, AHORA)

  return fila?.id ?? 0
}

function insertarVisionado(
  db: StoreConnection,
  animeId: number,
  episodeId: number,
  providerId: string,
): void {
  // Al 20 %: ni terminado —no es «continuar viendo»— ni por debajo del 2 %, que
  // es el corte que la fila aplica.
  db.query(
    `INSERT INTO watch_event
       (anime_id, episode_id, provider_id, mode, position_s, duration_s, started_at, finished)
     VALUES (?, ?, ?, 'sub', 300, 1440, ?, 0)`,
  ).run(animeId, episodeId, providerId, AHORA)
}

function insertarBusqueda(
  db: StoreConnection,
  providerId: string,
  ref: string,
  title: string,
  year: number,
  fetchedAt: number,
): void {
  db.query(
    `INSERT INTO search_cache (provider_id, query, results_json, fetched_at, ttl_s)
     VALUES (?, ?, ?, ?, 3600)`,
  ).run(
    providerId,
    title,
    JSON.stringify([{ ref: { providerId, value: ref }, title, year }]),
    fetchedAt,
  )
}

/**
 * Las filas de la base, escritas a mano.
 *
 * Es lo que queda después de desmarcar un proveedor: nada se borra. Las dos
 * obras de `fixture` existen para que las lecturas de la ficha —«relacionados» y
 * «otras fuentes»— tengan con qué comparar, y para que ninguna superficie quede
 * vacía en el control.
 */
function sembrar(db: StoreConnection): void {
  // La misma obra en las dos fuentes: es lo que hace aparecer al ausente en
  // «otras fuentes», que pide una obra por título y año.
  const dandadanFijo = insertarAnime(db, FIJO, 'dandadan', 'Dandadan', 2024, AHORA)
  insertarAnime(db, FANTASMA, 'dandadan', 'Dandadan', 2024, AHORA - 1000)
  // Un hermano de saga, que es la otra lectura de la ficha. La tercera entrega
  // sólo la tiene el ausente: con la misma entrega en las dos fuentes, la fila
  // se queda con la del proveedor que se está viendo y el control no mediría.
  insertarAnime(db, FIJO, 'dandadan-2', 'Dandadan 2nd Season', 2025, AHORA - 2000)
  insertarAnime(db, FANTASMA, 'dandadan-3', 'Dandadan 3rd Season', 2026, AHORA - 3000)
  // El título del informe: el que salía de destacado y contestaba 404.
  const ramparts = insertarAnime(
    db,
    FANTASMA,
    'koori-no-jouheki',
    'The Ramparts of Ice',
    2026,
    AHORA - 4000,
  )

  // «Continuar viendo» y favoritos de las dos fuentes: las dos filas son del
  // usuario, y ninguna puede ofrecer una tarjeta que no se pueda abrir.
  insertarVisionado(db, ramparts, insertarEpisodio(db, ramparts, 'koori-no-jouheki#1'), FANTASMA)
  insertarVisionado(db, dandadanFijo, insertarEpisodio(db, dandadanFijo, 'dandadan#1'), FIJO)
  db.query('INSERT INTO favorite (anime_id, created_at) VALUES (?, ?)').run(ramparts, AHORA)
  db.query('INSERT INTO favorite (anime_id, created_at) VALUES (?, ?)').run(dandadanFijo, AHORA)

  // Un título que sólo salió en una búsqueda: nunca se abrió su ficha, así que
  // su única fila es la de la caché de búsqueda.
  insertarBusqueda(db, FANTASMA, 'solo-busqueda', 'Sólo por búsqueda', 2026, AHORA - 5000)
}

/** Los proveedores que ofrece cada superficie, ya sin repetir. */
async function proveedoresVistos(ciclo: Ciclo): Promise<Record<string, readonly string[]>> {
  const vistos: Record<string, readonly string[]> = {}

  for (const superficie of SUPERFICIES) {
    const respuesta = await ciclo.pedir(superficie.ruta)
    expect({ ruta: superficie.ruta, status: respuesta.status }).toEqual({
      ruta: superficie.ruta,
      status: 200,
    })

    vistos[superficie.ruta] = [...new Set(superficie.proveedores(await respuesta.json()))]
  }

  return vistos
}

/** Las superficies donde sale el proveedor ausente. */
function dondeSale(vistos: Record<string, readonly string[]>): readonly string[] {
  return Object.entries(vistos)
    .filter(([, proveedores]) => proveedores.includes(FANTASMA))
    .map(([ruta]) => ruta)
}

/** Monta la aplicación con las filas sembradas, con el ausente cargado o no. */
async function conFilas<T>(activo: boolean, cuerpo: (ciclo: Ciclo) => Promise<T>): Promise<T> {
  return conCiclo(
    async (ciclo) => {
      sembrar(ciclo.db)

      return cuerpo(ciclo)
    },
    activo ? { activos: [callado()] } : {},
  )
}

describe('un proveedor deshabilitado', () => {
  test('el control: con el proveedor cargado, sus filas salen en las seis', async () => {
    await conFilas(true, async (ciclo) => {
      expect(dondeSale(await proveedoresVistos(ciclo))).toEqual(SUPERFICIES.map((s) => s.ruta))
    })
  })

  test('sin el proveedor cargado, ninguna lectura local ofrece sus filas', async () => {
    await conFilas(false, async (ciclo) => {
      expect(dondeSale(await proveedoresVistos(ciclo))).toEqual([])
    })
  })
})
