/**
 * La caché de intervalos de AniSkip, medida con reloj inyectado.
 *
 * Lo que se prueba aquí no es que se guarde y se lea —eso lo haría cualquier
 * tabla— sino las tres respuestas que el reproductor no distingue y la caché sí:
 * un acierto con intervalos, un «no hay» que se cachea para no volver a
 * preguntar y un MISS que sí se pregunta. Y lo que pasa con una fila que no se
 * entiende, que la caché es otra frontera.
 */

import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type SkipInterval, StoreError } from '@nn-anime/core'
import { TTL_SECONDS } from '../cache-policy'
import { openDb } from '../db'
import { runMigrations } from '../migrations/runner'
import { createSkipTimesRepository } from './skip-times'

const T0 = 1_700_000_000_000
const CLAVE = '38000:1:1440'

/** Los dos intervalos de un capítulo de veinticuatro minutos. */
function intervalos(): readonly SkipInterval[] {
  return [
    { type: 'op', start: 90, end: 180 },
    { type: 'ed', start: 1290, end: 1440 },
  ]
}

/** Cierra la base sin lanzar: algún test la cierra por su cuenta. */
function cerrarBase(db: Database): void {
  try {
    db.close()
  } catch {
    // Ya estaba cerrada: no hay nada que hacer.
  }
}

async function withDb<T>(body: (db: Database) => Promise<T> | T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-aniskip-'))
  const db = openDb(join(dir, 'nn-anime.db'))

  try {
    runMigrations(db)
    return await body(db)
  } finally {
    // Windows no deja borrar un archivo abierto, y SQLite mantiene la base y sus
    // `-wal`/`-shm` hasta el cierre: cerrarla antes del `rm` es lo que permite
    // borrar el directorio sin un EBUSY que tape el resultado del test.
    cerrarBase(db)
    await rm(dir, { recursive: true, force: true })
  }
}

/** La fila cruda, para medir lo que la interfaz del repositorio no expone. */
function filaGuardada(
  db: Database,
  key: string,
): { found: number; fetched_at: number; ttl_s: number } | null {
  return db
    .query<{ found: number; fetched_at: number; ttl_s: number }, [string]>(
      'SELECT found, fetched_at, ttl_s FROM aniskip_cache WHERE cache_key = ?',
    )
    .get(key)
}

describe('aniskip_cache: los intervalos de un episodio', () => {
  test('lo escrito se lee con su lista, su fecha y su TTL', async () => {
    await withDb((db) => {
      const repo = createSkipTimesRepository(db)
      repo.write(CLAVE, intervalos(), TTL_SECONDS.aniskip, T0)

      const leido = repo.read(CLAVE, T0)

      expect(leido).not.toBeNull()
      expect(leido?.value).toEqual(intervalos())
      expect(leido?.ttlS).toBe(TTL_SECONDS.aniskip)
      expect(leido?.fetchedAt.getTime()).toBe(T0)
      expect(leido?.stale).toBe(false)
    })
  })

  test('sin fila es un MISS, no una lista vacía', async () => {
    await withDb((db) => {
      expect(createSkipTimesRepository(db).read(CLAVE, T0)).toBeNull()
    })
  })

  test('el «no hay» también se cachea: lista vacía con su TTL corto', async () => {
    await withDb((db) => {
      const repo = createSkipTimesRepository(db)
      repo.write(CLAVE, [], TTL_SECONDS.aniskipMiss, T0)

      const leido = repo.read(CLAVE, T0)

      // La fila existe y la lista está vacía: «se preguntó y no hay». Seis horas
      // y no un mes, porque los intervalos los publica la comunidad y un capítulo
      // recién emitido puede tenerlos mañana.
      expect(leido).not.toBeNull()
      expect(leido?.value).toEqual([])
      expect(leido?.ttlS).toBe(TTL_SECONDS.aniskipMiss)
    })
  })

  test('los TTL son los del enunciado, y la caducidad cae donde dice', async () => {
    await withDb((db) => {
      const repo = createSkipTimesRepository(db)
      repo.write(CLAVE, intervalos(), TTL_SECONDS.aniskip, T0)
      repo.write('38000:2:1440', [], TTL_SECONDS.aniskipMiss, T0)

      expect(TTL_SECONDS.aniskip).toBe(2592000)
      expect(TTL_SECONDS.aniskipMiss).toBe(21600)
      expect(TTL_SECONDS.aniskipError).toBe(900)

      const justoAntes = T0 + TTL_SECONDS.aniskip * 1000 - 1
      const justoDespues = T0 + TTL_SECONDS.aniskip * 1000
      expect(repo.read(CLAVE, justoAntes)?.stale).toBe(false)
      expect(repo.read(CLAVE, justoDespues)?.stale).toBe(true)

      expect(repo.read('38000:2:1440', T0 + TTL_SECONDS.aniskipMiss * 1000)?.stale).toBe(true)
    })
  })

  test('volver a escribir pisa la lista, la fecha y el `found`', async () => {
    await withDb((db) => {
      const repo = createSkipTimesRepository(db)
      repo.write(CLAVE, intervalos(), TTL_SECONDS.aniskip, T0)
      expect(filaGuardada(db, CLAVE)?.found).toBe(1)

      repo.write(CLAVE, [], TTL_SECONDS.aniskipMiss, T0 + 5_000)

      const leido = repo.read(CLAVE, T0 + 5_000)
      expect(leido?.value).toEqual([])
      expect(leido?.fetchedAt.getTime()).toBe(T0 + 5_000)
      expect(filaGuardada(db, CLAVE)?.found).toBe(0)
    })
  })

  test('cada clave es su propio episodio: escribir uno no toca al otro', async () => {
    await withDb((db) => {
      const repo = createSkipTimesRepository(db)
      repo.write('38000:1:1440', intervalos(), TTL_SECONDS.aniskip, T0)
      repo.write('38000:2:1440', [{ type: 'recap', start: 0, end: 60 }], TTL_SECONDS.aniskip, T0)

      expect(repo.read('38000:1:1440', T0)?.value).toHaveLength(2)
      expect(repo.read('38000:2:1440', T0)?.value).toEqual([{ type: 'recap', start: 0, end: 60 }])
    })
  })

  test('el `found` manda: una fila de «no hay» no devuelve intervalos aunque el JSON los traiga', async () => {
    await withDb((db) => {
      // Lo que el repositorio nunca escribe: las dos mitades de la fila dicen
      // cosas distintas. Sólo una edición a mano las separa, y ante la duda no se
      // enciende un botón que saltaría la intro de un episodio sin intervalos.
      db.query(
        `INSERT INTO aniskip_cache (cache_key, intervals_json, found, fetched_at, ttl_s)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('rara', JSON.stringify(intervalos()), 0, T0, TTL_SECONDS.aniskipMiss)

      expect(createSkipTimesRepository(db).read('rara', T0)?.value).toEqual([])
    })
  })

  test('un JSON ilegible es un StoreError, como en el resto de las cachés', async () => {
    await withDb((db) => {
      db.query(
        `INSERT INTO aniskip_cache (cache_key, intervals_json, found, fetched_at, ttl_s)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('rota', '{esto no es json', 1, T0, TTL_SECONDS.aniskip)

      const repo = createSkipTimesRepository(db)

      expect(() => repo.read('rota', T0)).toThrow(StoreError)
      try {
        repo.read('rota', T0)
      } catch (error) {
        expect(error instanceof StoreError ? error.op : '').toBe('readSkipTimes')
      }
    })
  })

  test('una lista con una forma que no se entiende se denuncia, no se sirve', async () => {
    await withDb((db) => {
      // Un intervalo sin `end`: la forma del contrato la exige, y una fila que no
      // la cumple no puede llegar al reproductor como si fuera válida.
      db.query(
        `INSERT INTO aniskip_cache (cache_key, intervals_json, found, fetched_at, ttl_s)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('incompleta', JSON.stringify([{ type: 'op', start: 90 }]), 1, T0, TTL_SECONDS.aniskip)

      expect(() => createSkipTimesRepository(db).read('incompleta', T0)).toThrow(StoreError)
    })
  })
})
