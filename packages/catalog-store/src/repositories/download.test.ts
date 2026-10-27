import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../db'
import { runMigrations } from '../migrations/runner'
import { createDownloadRepository, type NewDownload } from './download'

const ALTA: NewDownload = {
  providerId: 'fixture',
  providerRef: 'aurora-nocturna',
  episodeRef: 'aurora-nocturna#1',
  title: 'Aurora Nocturna',
  episodeLabel: 'Episodio 1',
  kind: 'hls',
}

async function conBase<T>(body: (db: Database) => T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-descargas-'))
  const db = openDb(join(dir, 'nn-anime.db'))

  try {
    runMigrations(db)
    return body(db)
  } finally {
    try {
      db.close()
    } catch {
      // Ya estaba cerrada.
    }
    await rm(dir, { recursive: true, force: true })
  }
}

describe('la cola de descargas', () => {
  test('el alta nace en cola, sin archivo y con su fecha', async () => {
    await conBase((db) => {
      const repo = createDownloadRepository(db, () => 1_000)
      const fila = repo.create(ALTA)

      expect(fila.status).toBe('queued')
      expect(fila.bytes).toBe(0)
      expect(fila.path).toBeUndefined()
      expect(fila.createdAt.getTime()).toBe(1_000)
      expect(fila.updatedAt.getTime()).toBe(1_000)
    })
  })

  test('el alta es idempotente por episodio: dos veces es la misma fila', async () => {
    await conBase((db) => {
      const repo = createDownloadRepository(db)
      const primera = repo.create(ALTA)
      const segunda = repo.create({ ...ALTA, title: 'Otro título' })

      expect(segunda.id).toBe(primera.id)
      expect(repo.list()).toHaveLength(1)
      // La fila existente no se reescribe: manda la primera petición.
      expect(segunda.title).toBe('Aurora Nocturna')
    })
  })

  test('el progreso, el estado, la ruta y el error se actualizan', async () => {
    await conBase((db) => {
      const repo = createDownloadRepository(db, () => 2_000)
      const fila = repo.create(ALTA)

      const actualizada = repo.update(fila.id, {
        status: 'downloading',
        bytes: 10,
        totalBytes: 100,
        path: 'fixture/aurora-nocturna/1.mp4',
        error: 'corte',
      })

      expect(actualizada?.status).toBe('downloading')
      expect(actualizada?.bytes).toBe(10)
      expect(actualizada?.totalBytes).toBe(100)
      expect(actualizada?.path).toBe('fixture/aurora-nocturna/1.mp4')
      expect(actualizada?.error).toBe('corte')
      expect(actualizada?.updatedAt.getTime()).toBe(2_000)

      // `null` borra el error al reanudar; no lo deja pegado.
      expect(repo.update(fila.id, { error: null })?.error).toBeUndefined()
    })
  })

  test('borrar devuelve lo que había y la deja fuera de la lista', async () => {
    await conBase((db) => {
      const repo = createDownloadRepository(db)
      const fila = repo.create(ALTA)

      expect(repo.remove(fila.id)?.id).toBe(fila.id)
      expect(repo.get(fila.id)).toBeUndefined()
      expect(repo.list()).toEqual([])
    })
  })

  test('al arrancar vuelven a la cola las que quedaron descargando', async () => {
    await conBase((db) => {
      const repo = createDownloadRepository(db)
      const una = repo.create(ALTA)
      const otra = repo.create({
        ...ALTA,
        episodeRef: 'aurora-nocturna#2',
        episodeLabel: 'Episodio 2',
      })
      const pausada = repo.create({
        ...ALTA,
        episodeRef: 'aurora-nocturna#3',
        episodeLabel: 'Episodio 3',
      })

      repo.update(una.id, { status: 'downloading' })
      repo.update(otra.id, { status: 'downloading' })
      repo.update(pausada.id, { status: 'paused' })

      expect(repo.requeueInterrupted()).toBe(2)
      expect(repo.get(una.id)?.status).toBe('queued')
      expect(repo.get(otra.id)?.status).toBe('queued')
      expect(repo.get(pausada.id)?.status).toBe('paused')
    })
  })

  test('una fila con un estado que no existe se denuncia al leerla', async () => {
    await conBase((db) => {
      const repo = createDownloadRepository(db)
      const fila = repo.create(ALTA)
      db.query("UPDATE download SET status = 'inventado' WHERE id = ?").run(fila.id)

      expect(() => repo.get(fila.id)).toThrow(/estado que no existe/)
    })
  })
})
