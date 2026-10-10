import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AnimeDetail,
  type Episode,
  type ProviderRef,
  type StreamRequest,
  type StreamSource,
  toPublicStreamSource,
} from '@nn-anime/core'
import { TTL_SECONDS } from '../cache-policy'
import { openDb } from '../db'
import { runMigrations } from '../migrations/runner'
import { createAnimeRepository } from './anime'
import { createEpisodesRepository } from './episodes'
import { chooseSource, createStreamRepository } from './stream'

const ANIME: ProviderRef = { providerId: 'fixture', value: 'aurora-nocturna' }
const EPISODIO: ProviderRef = { providerId: 'fixture', value: 'aurora-nocturna#1' }
const ANIME_OTRO: ProviderRef = { providerId: 'fixture', value: 'mar-de-cristal' }
const EPISODIO_OTRO: ProviderRef = { providerId: 'fixture', value: 'mar-de-cristal#1' }

const SECRETO = 'token-de-referer-que-no-debe-persistirse'

function detalle(ref: ProviderRef): AnimeDetail {
  return {
    ref,
    title: 'Un título',
    genres: ['Acción'],
    studios: ['Estudio'],
  }
}

function episodio(ref: ProviderRef, animeRef: ProviderRef): Episode {
  return { ref, animeRef, number: 1, mode: 'sub' }
}

function fuente(overrides: Partial<StreamSource> = {}): StreamSource {
  return {
    url: 'https://fixture.invalid/aurora/1/sub/master.m3u8',
    kind: 'hls',
    quality: '1080p',
    subtitles: [
      { lang: 'es', label: 'Español', url: 'https://fixture.invalid/1.es.vtt', format: 'vtt' },
    ],
    ...overrides,
  }
}

function peticion(overrides: Partial<StreamRequest> = {}): StreamRequest {
  return { episodeRef: EPISODIO, mode: 'sub', ...overrides }
}

/** Base temporal con el anime y el episodio ya escritos. */
async function withStore<T>(body: (db: Database, path: string) => Promise<T> | T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-stream-'))
  const path = join(dir, 'nn-anime.db')

  try {
    const db = openDb(path)
    runMigrations(db)

    const anime = createAnimeRepository(db)
    anime.write(ANIME, detalle(ANIME))
    anime.write(ANIME_OTRO, detalle(ANIME_OTRO))
    const episodios = createEpisodesRepository(db)
    episodios.write(ANIME, [episodio(EPISODIO, ANIME)])
    episodios.write(ANIME_OTRO, [episodio(EPISODIO_OTRO, ANIME_OTRO)])

    return await body(db, path)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('elección de la fuente que se cachea', () => {
  test('gana la calidad pedida', () => {
    const elegida = chooseSource(peticion({ preferredQuality: '720p' }), [
      fuente({ quality: '1080p' }),
      fuente({ quality: '720p' }),
    ])

    expect(elegida?.quality).toBe('720p')
  })

  test('sin coincidencia ni petición, gana la primera: es el orden del proveedor', () => {
    expect(
      chooseSource(peticion({ preferredQuality: '4k' }), [fuente({ quality: '1080p' })])?.quality,
    ).toBe('1080p')
    expect(
      chooseSource(peticion(), [fuente({ kind: 'file' }), fuente({ kind: 'hls' })])?.kind,
    ).toBe('file')
  })

  test('sin fuentes no hay nada que elegir', () => {
    expect(chooseSource(peticion(), [])).toBeUndefined()
  })
})

describe('lectura y escritura', () => {
  test('sin fila, un MISS devuelve null', async () => {
    await withStore((db) => {
      expect(createStreamRepository(db).read(EPISODIO, 'sub')).toBeNull()
    })
  })

  test('un episodio que no está devuelve null sin lanzar', async () => {
    await withStore((db) => {
      const streams = createStreamRepository(db)

      expect(streams.read({ providerId: 'fixture', value: 'no-existe#9' }, 'sub')).toBeNull()
    })
  })

  test('guarda y devuelve la fuente con sus subtítulos', async () => {
    await withStore((db) => {
      const streams = createStreamRepository(db)
      streams.write(peticion(), [fuente()])

      const leida = streams.read(EPISODIO, 'sub')

      expect(leida?.url).toBe('https://fixture.invalid/aurora/1/sub/master.m3u8')
      expect(leida?.kind).toBe('hls')
      expect(leida?.quality).toBe('1080p')
      expect(leida?.subtitles).toEqual([
        { lang: 'es', label: 'Español', url: 'https://fixture.invalid/1.es.vtt', format: 'vtt' },
      ])
    })
  })

  test('el modo forma parte de la clave: sub y dub no se pisan', async () => {
    await withStore((db) => {
      const streams = createStreamRepository(db)
      streams.write(peticion(), [fuente({ url: 'https://fixture.invalid/sub.m3u8' })])
      streams.write(peticion({ mode: 'dub' }), [
        fuente({ url: 'https://fixture.invalid/dub.m3u8' }),
      ])

      expect(streams.read(EPISODIO, 'sub')?.url).toContain('sub.m3u8')
      expect(streams.read(EPISODIO, 'dub')?.url).toContain('dub.m3u8')
    })
  })

  test('una lista vacía no escribe ninguna fila', async () => {
    await withStore((db) => {
      const streams = createStreamRepository(db)
      streams.write(peticion(), [])

      expect(streams.read(EPISODIO, 'sub')).toBeNull()
      expect(db.query('SELECT COUNT(*) AS total FROM stream_cache').get()).toEqual({ total: 0 })
    })
  })

  test('escribir otra vez la misma clave actualiza, no duplica', async () => {
    await withStore((db) => {
      const streams = createStreamRepository(db)
      streams.write(peticion(), [fuente({ url: 'https://fixture.invalid/viejo.m3u8' })])
      streams.write(peticion(), [fuente({ url: 'https://fixture.invalid/nuevo.m3u8' })])

      expect(streams.read(EPISODIO, 'sub')?.url).toContain('nuevo.m3u8')
      expect(db.query('SELECT COUNT(*) AS total FROM stream_cache').get()).toEqual({ total: 1 })
    })
  })

  test('guardar el stream de un episodio que no está se denuncia', async () => {
    await withStore((db) => {
      const streams = createStreamRepository(db)

      expect(() =>
        streams.write({ episodeRef: { providerId: 'fixture', value: 'no#1' }, mode: 'sub' }, [
          fuente(),
        ]),
      ).toThrow(/no está/)
    })
  })
})

describe('caducidad', () => {
  test('el TTL es el del spec', async () => {
    await withStore((db) => {
      const streams = createStreamRepository(db)
      const ahora = 1_000_000
      streams.write(peticion(), [fuente()], ahora)

      const fila = db.query('SELECT ttl_s FROM stream_cache').get() as { ttl_s: number }
      expect(fila.ttl_s).toBe(TTL_SECONDS.stream)
      expect(TTL_SECONDS.stream).toBe(600)
    })
  })

  test('dentro del TTL se sirve y al vencer devuelve null, con la fila intacta', async () => {
    await withStore((db) => {
      const streams = createStreamRepository(db)
      const ahora = 1_000_000
      streams.write(peticion(), [fuente()], ahora)

      const dentro = streams.read(EPISODIO, 'sub', ahora + TTL_SECONDS.stream * 1000 - 1)
      const fuera = streams.read(EPISODIO, 'sub', ahora + TTL_SECONDS.stream * 1000)

      expect(dentro).not.toBeNull()
      expect(fuera).toBeNull()
      // La fila sigue ahí: caducada no es lo mismo que borrada, y quien la
      // revalide tiene que poder sobrescribirla.
      expect(db.query('SELECT COUNT(*) AS total FROM stream_cache').get()).toEqual({ total: 1 })
    })
  })

  test('el enlace caducado no se devuelve como stale: no hay CacheHit', async () => {
    await withStore((db) => {
      const streams = createStreamRepository(db)
      const ahora = 1_000_000
      streams.write(peticion(), [fuente()], ahora)

      const leida = streams.read(EPISODIO, 'sub', ahora + TTL_SECONDS.stream * 1000 + 1)

      expect(leida).toBeNull()
    })
  })
})

describe('invalidación', () => {
  test('borra sólo la clave indicada', async () => {
    await withStore((db) => {
      const streams = createStreamRepository(db)
      streams.write(peticion(), [fuente()])
      streams.write(peticion({ mode: 'dub' }), [fuente()])
      streams.write({ episodeRef: EPISODIO_OTRO, mode: 'sub' }, [fuente()])

      const borradas = streams.invalidateStream(EPISODIO, 'sub')

      expect(borradas).toBe(1)
      expect(streams.read(EPISODIO, 'sub')).toBeNull()
      expect(streams.read(EPISODIO, 'dub')).not.toBeNull()
      expect(streams.read(EPISODIO_OTRO, 'sub')).not.toBeNull()
    })
  })

  test('invalidar algo que no está no lanza y dice cero', async () => {
    await withStore((db) => {
      const streams = createStreamRepository(db)

      expect(streams.invalidateStream(EPISODIO, 'sub')).toBe(0)
      expect(streams.invalidateStream({ providerId: 'fixture', value: 'no#1' }, 'sub')).toBe(0)
    })
  })
})

describe('los headers del upstream no se guardan', () => {
  test('la forma pública de lo leído no tiene headers', async () => {
    await withStore((db) => {
      const streams = createStreamRepository(db)
      streams.write(peticion(), [fuente({ headers: { Referer: SECRETO, Cookie: SECRETO } })])

      const leida = streams.read(EPISODIO, 'sub')

      expect(leida?.headers).toBeUndefined()
      // La forma pública no es que tenga los headers vacíos: es que no tiene la
      // clave, y eso es lo que impide que un descuido los publique.
      if (leida !== null) expect(Object.hasOwn(toPublicStreamSource(leida), 'headers')).toBe(false)
    })
  })

  test('el secreto no aparece en ninguna columna de ninguna tabla', async () => {
    await withStore((db) => {
      const streams = createStreamRepository(db)
      streams.write(peticion(), [fuente({ headers: { Referer: SECRETO } })])

      const tablas = db
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as readonly { name: string }[]

      for (const tabla of tablas) {
        const filas = db.query(`SELECT * FROM ${tabla.name}`).all()
        expect(JSON.stringify(filas), tabla.name).not.toContain(SECRETO)
      }
    })
  })

  test('tampoco aparece en el archivo de la base', async () => {
    await withStore(async (db, path) => {
      const streams = createStreamRepository(db)
      streams.write(peticion(), [fuente({ headers: { Referer: SECRETO } })])
      // El WAL puede tener lo escrito sin volcar; se cierran las dos cosas.
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')

      const bytes = await readFile(path, 'latin1')

      expect(bytes).not.toContain(SECRETO)
    })
  })

  test('la tabla no tiene ninguna columna donde ponerlos', async () => {
    await withStore((db) => {
      const columnas = db
        .query("SELECT name FROM pragma_table_info('stream_cache')")
        .all() as readonly {
        name: string
      }[]

      expect(columnas.map((columna) => columna.name)).toEqual([
        'episode_id',
        'mode',
        'url',
        'kind',
        'quality',
        'subtitles_json',
        'fetched_at',
        'ttl_s',
      ])
    })
  })
})
