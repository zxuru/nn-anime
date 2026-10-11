import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnimeDetail, Episode, ProviderRef } from '@nn-anime/core'
import { openDb } from '../db'
import { runMigrations } from '../migrations/runner'
import { createAnimeRepository } from './anime'
import { createEpisodesRepository } from './episodes'
import { createWatchRepository } from './watch'
import { createWatchedEpisodesRepository } from './watched-episodes'

const AURORA: ProviderRef = { providerId: 'fixture', value: 'aurora-nocturna' }

function anime(ref: ProviderRef): AnimeDetail {
  return {
    ref,
    title: 'Aurora Nocturna',
    year: 2019,
    kind: 'tv',
    genres: ['Acción'],
    studios: ['Estudio Cobre'],
  }
}

function episodio(numero: number): Episode {
  return {
    ref: { providerId: AURORA.providerId, value: `${AURORA.value}#${numero}` },
    animeRef: AURORA,
    number: numero,
    title: `Episodio ${numero}`,
    mode: 'sub',
  }
}

interface Store {
  readonly watch: ReturnType<typeof createWatchRepository>
  readonly vistos: ReturnType<typeof createWatchedEpisodesRepository>
}

async function withStore<T>(body: (store: Store) => T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-vistos-'))
  const db = openDb(join(dir, 'nn-anime.db'))

  try {
    runMigrations(db)
    createAnimeRepository(db).write(AURORA, anime(AURORA))
    createEpisodesRepository(db).write(AURORA, [episodio(1), episodio(2), episodio(3)])

    return body({
      watch: createWatchRepository(db),
      vistos: createWatchedEpisodesRepository(db),
    })
  } finally {
    db.close()
    await rm(dir, { recursive: true, force: true })
  }
}

function abrirVisionado(
  watch: ReturnType<typeof createWatchRepository>,
  numero: number,
  startedAt: Date,
): number {
  return watch.recordWatch({
    animeRef: AURORA,
    episodeRef: { providerId: AURORA.providerId, value: `${AURORA.value}#${numero}` },
    mode: 'sub',
    positionS: 0,
    durationS: 1440,
    startedAt,
  })
}

describe('listWatchedEpisodes', () => {
  test('una fila por episodio: la del visionado más avanzado', async () => {
    await withStore((store) => {
      const primero = abrirVisionado(store.watch, 1, new Date(1_000_000))
      const segundo = abrirVisionado(store.watch, 1, new Date(2_000_000))
      store.watch.updateWatchPosition(primero, 144, 1440)
      store.watch.updateWatchPosition(segundo, 720, 1440)

      const lista = store.vistos.list(AURORA)

      // Sin quedarse con la mejor, la mutación devolvería dos filas del 1.
      expect(lista).toHaveLength(1)
      expect(lista[0]?.number).toBe(1)
      expect(lista[0]?.ratio).toBeCloseTo(0.5, 5)
      expect(lista[0]?.positionS).toBe(720)
    })
  })

  test('el episodio terminado se marca, y el de en medio no', async () => {
    await withStore((store) => {
      const uno = abrirVisionado(store.watch, 1, new Date(1_000_000))
      const dos = abrirVisionado(store.watch, 2, new Date(2_000_000))
      store.watch.updateWatchPosition(uno, 1440, 1440)
      store.watch.updateWatchPosition(dos, 720, 1440)

      const porNumero = new Map(store.vistos.list(AURORA).map((fila) => [fila.number, fila]))

      expect(porNumero.get(1)?.finished).toBe(true)
      expect(porNumero.get(2)?.finished).toBe(false)
      expect(porNumero.get(2)?.ratio).toBe(0.5)
    })
  })

  test('sin duración no hay proporción ni marca de terminado', async () => {
    await withStore((store) => {
      const uno = abrirVisionado(store.watch, 1, new Date(1_000_000))
      store.watch.updateWatchPosition(uno, 900, 0)

      const fila = store.vistos.list(AURORA)[0]

      expect(fila?.ratio).toBe(0)
      expect(fila?.finished).toBe(false)
    })
  })

  test('un título sin visionados devuelve lista vacía', async () => {
    await withStore((store) => {
      expect(store.vistos.list({ providerId: 'fixture', value: 'otro' })).toEqual([])
    })
  })

  test('el modo se conserva para poder reanudar en el que se estaba viendo', async () => {
    await withStore((store) => {
      const uno = abrirVisionado(store.watch, 1, new Date(1_000_000))
      store.watch.updateWatchPosition(uno, 300, 1440)

      expect(store.vistos.list(AURORA)[0]?.mode).toBe('sub')
    })
  })
})

describe('updateWatchPosition y el umbral', () => {
  test('al 90 % queda terminado', async () => {
    await withStore((store) => {
      const uno = abrirVisionado(store.watch, 1, new Date(1_000_000))
      store.watch.updateWatchPosition(uno, 1296, 1440)

      expect(store.vistos.list(AURORA)[0]?.finished).toBe(true)
    })
  })

  test('al 89 % no', async () => {
    await withStore((store) => {
      const uno = abrirVisionado(store.watch, 1, new Date(1_000_000))
      store.watch.updateWatchPosition(uno, 1281, 1440)

      // Mutar el umbral a 0.89 o quitar la escritura de `finished` deja esta
      // prueba en rojo.
      expect(store.vistos.list(AURORA)[0]?.finished).toBe(false)
    })
  })
})
