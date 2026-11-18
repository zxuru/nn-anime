import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { emptyTasteProfile, type TasteProfile } from '@rona/core'
import { runMigrations } from '../migrations/runner'
import { createTasteRepository } from './taste'

function db(): Database {
  const base = new Database(':memory:')
  runMigrations(base)

  return base
}

function perfil(extra: Partial<TasteProfile> = {}): TasteProfile {
  return {
    ...emptyTasteProfile('local', new Date('2026-11-18T10:00:00Z')),
    genres: [
      {
        name: 'Acción',
        weight: 1,
        source: 'survey',
        updatedAt: '2026-11-18T10:00:00.000Z',
      },
    ],
    survey: { status: 'completed', skips: 0, updatedAt: '2026-11-18T10:00:00.000Z' },
    ...extra,
  }
}

describe('el perfil de gustos, en la base', () => {
  test('sin fila no hay perfil: la encuesta no ha empezado', () => {
    const store = createTasteRepository(db())

    expect(store.read()).toBeUndefined()
  })

  test('lo que se escribe se lee entero, con su origen y su fecha', () => {
    const store = createTasteRepository(db())
    const escrito = perfil()

    store.write(escrito)

    expect(store.read()).toEqual(escrito)
    expect(store.read()?.genres[0]?.source).toBe('survey')
    expect(store.read()?.survey.status).toBe('completed')
  })

  test('escribir otra vez sustituye: la encuesta reabierta manda', () => {
    const store = createTasteRepository(db())
    store.write(perfil())

    store.write(
      perfil({
        genres: [],
        excludedGenres: [
          {
            name: 'Terror',
            source: 'survey',
            updatedAt: '2026-11-18T11:00:00.000Z',
          },
        ],
        survey: { status: 'skipped', skips: 1, updatedAt: '2026-11-18T11:00:00.000Z' },
      }),
    )

    expect(store.read()?.genres).toEqual([])
    expect(store.read()?.excludedGenres[0]?.name).toBe('Terror')
    expect(store.read()?.survey.skips).toBe(1)
  })

  test('un JSON corrupto se trata como ausente, no tumba la lectura', () => {
    const base = db()
    base
      .query('INSERT INTO taste_profile (user_id, profile_json, updated_at) VALUES (?, ?, ?)')
      .run('local', '{esto no es json', 0)
    const store = createTasteRepository(base)

    expect(store.read()).toBeUndefined()
  })

  test('un perfil con otra forma tampoco se cuela', () => {
    const base = db()
    base
      .query('INSERT INTO taste_profile (user_id, profile_json, updated_at) VALUES (?, ?, ?)')
      .run('local', JSON.stringify({ userId: 'local', genres: 'acción' }), 0)
    const store = createTasteRepository(base)

    expect(store.read()).toBeUndefined()
  })

  test('cada usuario tiene su fila', () => {
    const store = createTasteRepository(db())
    store.write(perfil({ userId: 'local' }))
    store.write(perfil({ userId: 'otra', genres: [] }))

    expect(store.read('local')?.genres).toHaveLength(1)
    expect(store.read('otra')?.genres).toHaveLength(0)
  })
})
