import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnimeDetail, ProviderRef } from '@nn-anime/core'
import { openDb } from '../db'
import { runMigrations } from '../migrations/runner'
import { createAnimeRepository } from './anime'
import { createRelatedRepository, type RelatedStore } from './related'

function anime(ref: ProviderRef, title: string, year: number): AnimeDetail {
  return {
    ref,
    title,
    year,
    kind: 'tv',
    genres: ['Aventura'],
    studios: ['Estudio Cobre'],
  }
}

/**
 * Envoltorio que cuenta las consultas preparadas, como el del historial.
 *
 * Lo que el spec prohíbe es «una consulta por fila»; eso se mide contando, no
 * leyendo la sentencia.
 */
function contarConsultas(db: Database): { readonly db: Database; readonly llamadas: () => number } {
  let llamadas = 0

  const envuelta = new Proxy(db, {
    get(target, prop, receptor) {
      if (prop === 'query') llamadas += 1
      const valor: unknown = Reflect.get(target, prop, receptor)

      return typeof valor === 'function' ? valor.bind(target) : valor
    },
  })

  return { db: envuelta, llamadas: () => llamadas }
}

interface Store {
  readonly related: RelatedStore
  readonly llamadas: () => number
}

/** Base temporal con la saga dentro. */
async function withStore<T>(
  titulos: readonly (readonly [ProviderRef, string, number])[],
  body: (store: Store) => T,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-relacionados-'))
  const db = openDb(join(dir, 'nn-anime.db'))

  try {
    runMigrations(db)
    const animeRepo = createAnimeRepository(db)
    for (const [ref, title, year] of titulos) animeRepo.write(ref, anime(ref, title, year))

    const contador = contarConsultas(db)
    const related = createRelatedRepository(contador.db)

    return body({ related, llamadas: contador.llamadas })
  } finally {
    db.close()
    await rm(dir, { recursive: true, force: true })
  }
}

const FRIEREN: ProviderRef = { providerId: 'fixture', value: 'frieren' }
const FRIEREN_2: ProviderRef = { providerId: 'fixture', value: 'frieren-2' }
const MAR: ProviderRef = { providerId: 'fixture', value: 'mar-de-cristal' }

describe('listRelated', () => {
  test('empareja la saga y no se devuelve a sí misma', async () => {
    await withStore(
      [
        [FRIEREN, 'Sousou no Frieren', 2023],
        [FRIEREN_2, 'Sousou no Frieren 2nd Season', 2024],
        [MAR, 'Mar de Cristal', 2023],
      ],
      (store) => {
        const lista = store.related.list(FRIEREN_2, 10)

        // Sin el filtro de la propia referencia, la mutación devuelve dos filas
        // y esta prueba cae.
        expect(lista.map((item) => item.ref.value)).toEqual(['frieren'])
        expect(lista[0]?.title).toBe('Sousou no Frieren')
        expect(lista[0]?.year).toBe(2023)
      },
    )
  })

  test('la consulta es una, no una por candidato', async () => {
    await withStore(
      [
        [FRIEREN, 'Sousou no Frieren', 2023],
        [FRIEREN_2, 'Sousou no Frieren 2nd Season', 2024],
        [MAR, 'Mar de Cristal', 2023],
      ],
      (store) => {
        const antes = store.llamadas()
        store.related.list(FRIEREN_2, 10)

        expect(store.llamadas()).toBe(antes)
      },
    )
  })

  test('ordena por cercanía de año: primero la del año de al lado', async () => {
    await withStore(
      [
        [{ providerId: 'fixture', value: 'overlord' }, 'Overlord', 2015],
        [{ providerId: 'fixture', value: 'overlord-2' }, 'Overlord II', 2018],
        [{ providerId: 'fixture', value: 'overlord-3' }, 'Overlord III', 2018],
        [{ providerId: 'fixture', value: 'overlord-4' }, 'Overlord IV', 2022],
      ],
      (store) => {
        const lista = store.related.list({ providerId: 'fixture', value: 'overlord-4' }, 10)

        // II y III están a la misma distancia del año pedido; el empate lo
        // resuelve el orden estable de la lectura, que es alfabético.
        expect(lista.map((item) => item.ref.value)).toEqual([
          'overlord-2',
          'overlord-3',
          'overlord',
        ])
      },
    )
  })

  test('sin hermanos devuelve lista vacía, no un error', async () => {
    await withStore([[MAR, 'Mar de Cristal', 2023]], (store) => {
      expect(store.related.list(MAR, 10)).toEqual([])
    })
  })

  test('una referencia que no está en la base tampoco es un error', async () => {
    await withStore([[MAR, 'Mar de Cristal', 2023]], (store) => {
      expect(store.related.list({ providerId: 'fixture', value: 'no-existe' }, 10)).toEqual([])
    })
  })

  test('el límite se respeta', async () => {
    await withStore(
      [
        [{ providerId: 'fixture', value: 'overlord' }, 'Overlord', 2015],
        [{ providerId: 'fixture', value: 'overlord-2' }, 'Overlord II', 2018],
        [{ providerId: 'fixture', value: 'overlord-3' }, 'Overlord III', 2018],
      ],
      (store) => {
        expect(store.related.list({ providerId: 'fixture', value: 'overlord-3' }, 1)).toHaveLength(
          1,
        )
      },
    )
  })

  test('no cruza proveedores: la misma saga en otra fuente no se mezcla', async () => {
    await withStore(
      [
        [{ providerId: 'fixture', value: 'a' }, 'Overlord', 2015],
        [{ providerId: 'otro', value: 'b' }, 'Overlord II', 2018],
      ],
      (store) => {
        expect(store.related.list({ providerId: 'otro', value: 'b' }, 10)).toEqual([])
      },
    )
  })
})
