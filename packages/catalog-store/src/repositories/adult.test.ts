import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnimeDetail, ProviderRef } from '@nn-anime/core'
import { openDb } from '../db'
import { runMigrations } from '../migrations/runner'
import { createAdultRepository } from './adult'
import { createAnimeRepository } from './anime'

const MARCADA: ProviderRef = { providerId: 'fixture', value: 'una-obra' }
const NORMAL: ProviderRef = { providerId: 'fixture', value: 'otra-obra' }

function anime(ref: ProviderRef, title: string): AnimeDetail {
  return { ref, title, genres: ['Acción'], studios: ['Estudio Cobre'] }
}

/**
 * Envoltorio que cuenta las consultas preparadas.
 *
 * Se envuelve la base y no se mira el SQL: lo que el spec prohíbe es el patrón «una
 * consulta por fila», y eso se mide contando, no leyendo la sentencia. Los métodos
 * se atan al objeto original porque los de `bun:sqlite` esperan su propio `this`.
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

interface Contexto {
  readonly db: Database
  readonly adult: ReturnType<typeof createAdultRepository>
  readonly anime: ReturnType<typeof createAnimeRepository>
}

async function conBase<T>(body: (contexto: Contexto) => T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-adulto-'))
  const db = openDb(join(dir, 'nn-anime.db'))

  try {
    runMigrations(db)

    return body({ db, adult: createAdultRepository(db), anime: createAnimeRepository(db) })
  } finally {
    // Windows no deja borrar un archivo abierto y SQLite mantiene la base y sus
    // `-wal`/`-shm` hasta el cierre: cerrarla antes del `rm` evita un EBUSY que
    // taparía el resultado del test.
    try {
      db.close()
    } catch {
      // Ya estaba cerrada: no hay nada que hacer.
    }
    await rm(dir, { recursive: true, force: true })
  }
}

describe('la marca de contenido para adultos', () => {
  test('marcar una referencia la deja marcada, y sólo a ella', async () => {
    await conBase(({ adult }) => {
      adult.mark(MARCADA)

      expect(adult.isMarked(MARCADA)).toBe(true)
      expect(adult.isMarked(NORMAL)).toBe(false)
    })
  })

  /**
   * Es la razón de que la marca viva en su propia tabla: la aprende el
   * emparejamiento de AniList sobre una entrada del feed, y esa obra puede no tener
   * fila de `anime` —nadie abrió su ficha—. Con una columna habría que inventarse un
   * detalle para poder escribirla.
   */
  test('se puede marcar una referencia que no tiene fila de anime', async () => {
    await conBase(({ adult, db }) => {
      adult.mark(MARCADA)

      const filas = db.query('SELECT COUNT(*) AS total FROM anime').get() as { total: number }

      expect(filas.total).toBe(0)
      expect(adult.isMarked(MARCADA)).toBe(true)
    })
  })

  test('la lectura por lote devuelve las marcadas y ninguna más', async () => {
    await conBase(({ adult }) => {
      adult.mark(MARCADA)

      expect(adult.list([MARCADA, NORMAL])).toEqual([MARCADA])
      expect(adult.list([NORMAL])).toEqual([])
      expect(adult.list([])).toEqual([])
    })
  })

  test('la lectura por lote es una sola consulta, aunque la lista repita referencias', async () => {
    await conBase(({ adult, db }) => {
      adult.mark(MARCADA)

      const contador = contarConsultas(db)
      const otro = createAdultRepository(contador.db)
      // Se cuenta el delta y no el total: crear el repositorio prepara lo que va a
      // usar, y eso no es lo que mide esta prueba.
      const antes = contador.llamadas()
      const marcadas = otro.list([MARCADA, NORMAL, MARCADA])

      expect(marcadas).toEqual([MARCADA])
      expect(contador.llamadas() - antes).toBe(1)
    })
  })

  test('marcar dos veces la misma referencia no duplica la fila', async () => {
    await conBase(({ adult, db }) => {
      adult.mark(MARCADA)
      adult.mark(MARCADA)

      const filas = db.query('SELECT COUNT(*) AS total FROM adult_ref').get() as { total: number }

      expect(filas.total).toBe(1)
    })
  })

  /**
   * El refresco del proveedor reescribe la fila del anime —es su detalle— y **no**
   * puede llevarse la marca: que una obra sea para adultos no se vence, y perderla
   * devolvería a la vitrina lo que el usuario ha pedido no ver.
   */
  test('un refresco del proveedor no borra la marca', async () => {
    await conBase(({ adult, anime: repo }) => {
      repo.write(MARCADA, anime(MARCADA, 'Una obra'))
      adult.mark(MARCADA)

      repo.write(MARCADA, anime(MARCADA, 'Una obra, con el título corregido'))

      expect(adult.isMarked(MARCADA)).toBe(true)
    })
  })
})
