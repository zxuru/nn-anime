import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnimeDetail, Episode, ProviderRef, WatchEventInput } from '@nn-anime/core'
import { openDb } from '../db'
import { runMigrations } from '../migrations/runner'
import { createAnimeRepository } from './anime'
import { createEpisodesRepository } from './episodes'
import { createFavoritesRepository } from './favorites'
import { createPlanToWatchRepository } from './plan-to-watch'
import { createSearchHistoryRepository } from './search-history'
import { createWatchRepository } from './watch'
import { createWatchedTitlesRepository } from './watched-titles'

const AURORA: ProviderRef = { providerId: 'fixture', value: 'aurora-nocturna' }
const MAR: ProviderRef = { providerId: 'fixture', value: 'mar-de-cristal' }

function anime(ref: ProviderRef, title: string, year: number): AnimeDetail {
  return {
    ref,
    title,
    year,
    kind: 'tv',
    coverUrl: `https://fixture.invalid/portada/${ref.value}.webp`,
    genres: ['Acción'],
    studios: ['Estudio Cobre'],
  }
}

function episodio(animeRef: ProviderRef, numero: number): Episode {
  return {
    ref: { providerId: animeRef.providerId, value: `${animeRef.value}#${numero}` },
    animeRef,
    number: numero,
    title: `Episodio ${numero}`,
    mode: 'sub',
  }
}

function visionado(animeRef: ProviderRef, numero: number, startedAt: Date): WatchEventInput {
  return {
    animeRef,
    episodeRef: { providerId: animeRef.providerId, value: `${animeRef.value}#${numero}` },
    mode: 'sub',
    positionS: 0,
    durationS: 1440,
    startedAt,
  }
}

/**
 * Envoltorio que cuenta las consultas preparadas.
 *
 * Se envuelve la base y no se mira el SQL: lo que el spec prohíbe es el patrón
 * «una consulta por fila», y eso se mide contando, no leyendo la sentencia. Los
 * métodos se atan al objeto original porque los de `bun:sqlite` esperan su
 * propio `this`.
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
  readonly db: Database
  readonly anime: ReturnType<typeof createAnimeRepository>
  readonly episodios: ReturnType<typeof createEpisodesRepository>
  readonly watch: ReturnType<typeof createWatchRepository>
  readonly favoritos: ReturnType<typeof createFavoritesRepository>
  readonly vistos: ReturnType<typeof createWatchedTitlesRepository>
  readonly pendientes: ReturnType<typeof createPlanToWatchRepository>
  readonly historial: ReturnType<typeof createSearchHistoryRepository>
}

/** Cierra la base sin lanzar: algún test la cierra por su cuenta. */
function cerrarBase(db: Database): void {
  try {
    db.close()
  } catch {
    // Ya estaba cerrada: no hay nada que hacer.
  }
}

/** Base temporal con dos títulos y sus episodios ya dentro. */
async function withStore<T>(body: (store: Store) => Promise<T> | T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-usuario-'))
  const path = join(dir, 'nn-anime.db')
  const db = openDb(path)

  try {
    runMigrations(db)
    const animeRepo = createAnimeRepository(db)
    const episodios = createEpisodesRepository(db)

    for (const [ref, title, year] of [
      [AURORA, 'Aurora Nocturna', 2019],
      [MAR, 'Mar de Cristal', 2023],
    ] as const) {
      animeRepo.write(ref, anime(ref, title, year))
      episodios.write(ref, [episodio(ref, 1), episodio(ref, 2)])
    }

    return await body({
      db,
      anime: animeRepo,
      episodios,
      watch: createWatchRepository(db),
      favoritos: createFavoritesRepository(db),
      vistos: createWatchedTitlesRepository(db),
      pendientes: createPlanToWatchRepository(db),
      historial: createSearchHistoryRepository(db),
    })
  } finally {
    // Windows no deja borrar un archivo abierto, y SQLite mantiene la base y sus
    // `-wal`/`-shm` hasta el cierre: cerrarla antes del `rm` es lo que permite
    // borrar el directorio sin un EBUSY que tape el resultado del test.
    cerrarBase(db)
    await rm(dir, { recursive: true, force: true })
  }
}

describe('historial de visionado', () => {
  test('registra un visionado y lo devuelve con los datos del anime', async () => {
    await withStore((store) => {
      const id = store.watch.recordWatch(visionado(AURORA, 1, new Date(1_000_000)))
      const lista = store.watch.listRecentlyWatched(10)

      expect(id).toBeGreaterThan(0)
      expect(lista).toHaveLength(1)
      expect(lista[0]?.id).toBe(id)
      expect(lista[0]?.anime.title).toBe('Aurora Nocturna')
      expect(lista[0]?.anime.year).toBe(2019)
      expect(lista[0]?.anime.kind).toBe('tv')
      expect(lista[0]?.anime.coverUrl).toContain('aurora-nocturna.webp')
      expect(lista[0]?.episodeNumber).toBe(1)
      expect(lista[0]?.mode).toBe('sub')
      expect(lista[0]?.finished).toBe(false)
      expect(lista[0]?.startedAt).toEqual(new Date(1_000_000))
    })
  })

  test('actualiza la posición en la misma fila, no crea otra', async () => {
    await withStore((store) => {
      const id = store.watch.recordWatch(visionado(AURORA, 1, new Date(1_000_000)))

      // Lo que hace el reproductor cada quince segundos.
      for (const posicion of [15, 30, 45, 60]) store.watch.updateWatchPosition(id, posicion, 1440)

      const lista = store.watch.listRecentlyWatched(10)

      expect(lista).toHaveLength(1)
      expect(lista[0]?.positionS).toBe(60)
    })
  })

  test('actualizar un visionado que no existe se denuncia', async () => {
    await withStore((store) => {
      expect(() => store.watch.updateWatchPosition(999, 10, 100)).toThrow(/999/)
    })
  })

  test('ordena por más reciente', async () => {
    await withStore((store) => {
      store.watch.recordWatch(visionado(AURORA, 1, new Date(1_000_000)))
      store.watch.recordWatch(visionado(MAR, 1, new Date(2_000_000)))
      store.watch.recordWatch(visionado(AURORA, 2, new Date(3_000_000)))

      const lista = store.watch.listRecentlyWatched(10)

      expect(lista.map((item) => item.anime.title)).toEqual([
        'Aurora Nocturna',
        'Mar de Cristal',
        'Aurora Nocturna',
      ])
      expect(lista[0]?.episodeNumber).toBe(2)
    })
  })

  test('el límite se respeta', async () => {
    await withStore((store) => {
      for (let indice = 0; indice < 5; indice++) {
        store.watch.recordWatch(visionado(AURORA, 1, new Date(1_000_000 + indice)))
      }

      const lista = store.watch.listRecentlyWatched(3)

      expect(lista).toHaveLength(3)
    })
  })

  test('los metadatos salen de la misma consulta, no una por fila', async () => {
    await withStore((store) => {
      for (let indice = 0; indice < 5; indice++) {
        store.watch.recordWatch(visionado(AURORA, 1, new Date(1_000_000 + indice)))
      }

      // Se cuentan las consultas de verdad, con un envoltorio sobre la base:
      // borrar una tabla y ver que sigue funcionando no prueba cuántas veces se
      // preguntó. El `JOIN` trae el anime en la misma consulta, así que cinco
      // filas son **una** consulta.
      const contador = contarConsultas(store.db)
      const lista = createWatchRepository(contador.db).listRecentlyWatched(5)

      expect(lista).toHaveLength(5)
      expect(lista[0]?.anime.title).toBe('Aurora Nocturna')
      expect(contador.llamadas()).toBe(1)
    })
  })

  test('los favoritos también traen los metadatos de una vez', async () => {
    await withStore((store) => {
      store.favoritos.setFavorite(AURORA, true)
      store.favoritos.setFavorite(MAR, true)

      const contador = contarConsultas(store.db)
      const favoritos = createFavoritesRepository(contador.db).listFavorites()

      expect(favoritos).toHaveLength(2)
      expect(contador.llamadas()).toBe(1)
    })
  })

  /**
   * El historial paginado del Perfil.
   *
   * Va aparte de `listRecentlyWatched` —que alimenta «continuar viendo» y es señal
   * del motor— y por eso lo que se comprueba aquí, además del troceado, es que la
   * lectura de siempre **no cambia**: son dos preguntas distintas sobre la misma
   * tabla, y la nueva no puede alterar la vieja.
   */
  describe('el historial, por páginas', () => {
    test('recorre todas las filas sin solapar ni perder ninguna', async () => {
      await withStore((store) => {
        // Cinco visionados sobre los dos episodios que siembra el envoltorio: lo
        // que se trocea son las filas del historial, no los episodios.
        const ids: number[] = []
        for (let indice = 0; indice < 5; indice++) {
          ids.push(
            store.watch.recordWatch(
              visionado(AURORA, indice % 2 === 0 ? 1 : 2, new Date(1_000_000 + indice)),
            ),
          )
        }

        const primera = store.watch.listWatchHistory(2, 0)
        const segunda = store.watch.listWatchHistory(2, 2)
        const tercera = store.watch.listWatchHistory(2, 4)

        // De la más reciente a la más antigua, y las cinco exactamente una vez: sin
        // el desplazamiento, la segunda página repetiría las dos primeras.
        expect([...primera, ...segunda, ...tercera].map((fila) => fila.id)).toEqual(
          [...ids].reverse(),
        )
      })
    })

    test('una página más allá del final es una lista vacía, no un error', async () => {
      await withStore((store) => {
        store.watch.recordWatch(visionado(AURORA, 1, new Date(1_000_000)))

        expect(store.watch.listWatchHistory(10, 50)).toEqual([])
      })
    })

    test('no descarta lo terminado ni agrupa por episodio: cuenta lo que pasó', async () => {
      await withStore((store) => {
        const primera = store.watch.recordWatch(visionado(AURORA, 1, new Date(1_000_000)))
        store.watch.updateWatchPosition(primera, 1440, 1440)
        // La misma obra y el mismo episodio, otra vez: son dos renglones.
        store.watch.recordWatch(visionado(AURORA, 1, new Date(2_000_000)))

        const historial = store.watch.listWatchHistory(10, 0)

        expect(historial).toHaveLength(2)
        expect(historial.some((fila) => fila.finished)).toBe(true)
      })
    })

    test('no cambia lo que lee «continuar viendo»', async () => {
      await withStore((store) => {
        store.watch.recordWatch(visionado(AURORA, 1, new Date(1_000_000)))
        store.watch.recordWatch(visionado(MAR, 1, new Date(2_000_000)))

        // La lectura de siempre sigue viendo las dos: el historial paginado no le
        // ha cambiado el tope, ni el orden, ni el troceado.
        expect(store.watch.listRecentlyWatched(1)).toHaveLength(1)
        expect(store.watch.listRecentlyWatched(10)).toHaveLength(2)
      })
    })

    test('los metadatos salen de una sola consulta, como en la lectura de siempre', async () => {
      await withStore((store) => {
        for (let indice = 0; indice < 5; indice++) {
          store.watch.recordWatch(visionado(AURORA, 1, new Date(1_000_000 + indice)))
        }

        const contador = contarConsultas(store.db)
        const lista = createWatchRepository(contador.db).listWatchHistory(5, 0)

        expect(lista).toHaveLength(5)
        expect(lista[0]?.anime.title).toBe('Aurora Nocturna')
        expect(contador.llamadas()).toBe(1)
      })
    })
  })

  test('un anime que no está no se puede registrar', async () => {
    await withStore((store) => {
      const otro: ProviderRef = { providerId: 'fixture', value: 'no-existe' }

      expect(() => store.watch.recordWatch(visionado(otro, 1, new Date()))).toThrow(/no está/)
    })
  })

  test('un episodio que no está no se puede registrar', async () => {
    await withStore((store) => {
      expect(() => store.watch.recordWatch(visionado(AURORA, 9, new Date()))).toThrow(/no está/)
    })
  })
})

describe('favoritos', () => {
  test('marcar y leer', async () => {
    await withStore((store) => {
      store.favoritos.setFavorite(AURORA, true)

      expect(store.favoritos.listFavorites().map((item) => item.title)).toEqual(['Aurora Nocturna'])
    })
  })

  test('marcar dos veces no duplica', async () => {
    await withStore((store) => {
      store.favoritos.setFavorite(AURORA, true)
      store.favoritos.setFavorite(AURORA, true)

      expect(store.favoritos.listFavorites()).toHaveLength(1)
      expect(store.db.query('SELECT COUNT(*) AS total FROM favorite').get()).toEqual({ total: 1 })
    })
  })

  test('desmarcar lo saca', async () => {
    await withStore((store) => {
      store.favoritos.setFavorite(AURORA, true)
      store.favoritos.setFavorite(AURORA, false)

      expect(store.favoritos.listFavorites()).toEqual([])
    })
  })

  test('desmarcar algo que no estaba no falla', async () => {
    await withStore((store) => {
      store.favoritos.setFavorite(AURORA, false)

      expect(store.favoritos.listFavorites()).toEqual([])
    })
  })

  test('marcar un anime que no está se denuncia', async () => {
    await withStore((store) => {
      expect(() =>
        store.favoritos.setFavorite({ providerId: 'fixture', value: 'no-existe' }, true),
      ).toThrow(/no está/)
    })
  })

  test('la lista sale del más reciente al más antiguo', async () => {
    await withStore((store) => {
      store.favoritos.setFavorite(AURORA, true)
      store.db.query('UPDATE favorite SET created_at = 1').run()
      store.favoritos.setFavorite(MAR, true)
      store.db
        .query(
          'UPDATE favorite SET created_at = 2 WHERE anime_id = (SELECT id FROM anime WHERE provider_ref = ?)',
        )
        .run(MAR.value)

      expect(store.favoritos.listFavorites().map((item) => item.title)).toEqual([
        'Mar de Cristal',
        'Aurora Nocturna',
      ])
    })
  })
})

/**
 * La marca de «ya visto».
 *
 * Es la hermana del favorito y se prueba con sus mismos casos, porque comparte sus
 * dos decisiones: la tabla tiene el anime como clave —marcar dos veces deja una
 * fila— y marcar un título que no está se denuncia, que es lo que la ruta convierte
 * en un 404. Lo que se añade aquí es la **fecha**, que el favorito no devuelve y el
 * motor sí necesita.
 */
describe('la marca de visto', () => {
  test('marcar y leer, con la fecha de la marca', async () => {
    await withStore((store) => {
      store.vistos.setWatchedTitle(AURORA, true)

      const lista = store.vistos.listWatchedTitles()

      expect(lista.map((item) => item.title)).toEqual(['Aurora Nocturna'])
      expect(lista[0]?.watchedAt).toBeInstanceOf(Date)
      // El resumen viaja entero: la lectura alimenta el motor y el botón de la ficha.
      expect(lista[0]?.year).toBe(2019)
      expect(lista[0]?.kind).toBe('tv')
    })
  })

  test('marcar dos veces no duplica: la clave es el anime', async () => {
    await withStore((store) => {
      store.vistos.setWatchedTitle(AURORA, true)
      store.vistos.setWatchedTitle(AURORA, true)

      expect(store.vistos.listWatchedTitles()).toHaveLength(1)
      expect(store.db.query('SELECT COUNT(*) AS total FROM watched_title').get()).toEqual({
        total: 1,
      })
    })
  })

  test('desmarcar lo saca, y desmarcar algo que no estaba no falla', async () => {
    await withStore((store) => {
      store.vistos.setWatchedTitle(AURORA, true)
      store.vistos.setWatchedTitle(AURORA, false)

      expect(store.vistos.listWatchedTitles()).toEqual([])

      store.vistos.setWatchedTitle(MAR, false)
      expect(store.vistos.listWatchedTitles()).toEqual([])
    })
  })

  test('marcar una obra que no está se denuncia', async () => {
    await withStore((store) => {
      expect(() =>
        store.vistos.setWatchedTitle({ providerId: 'fixture', value: 'no-existe' }, true),
      ).toThrow(/no está/)
    })
  })

  test('la lectura acota la marca al título, sin tocar el visionado', async () => {
    await withStore((store) => {
      store.vistos.setWatchedTitle(AURORA, true)

      // La marca es de la obra: no fabrica progreso de episodios, que es lo que
      // ensuciaría la afinidad del motor y lo que la spec prohíbe.
      expect(store.db.query('SELECT COUNT(*) AS total FROM watch_event').get()).toEqual({
        total: 0,
      })
    })
  })

  test('la lista sale de la más reciente a la más antigua', async () => {
    await withStore((store) => {
      store.vistos.setWatchedTitle(AURORA, true)
      store.db.query('UPDATE watched_title SET created_at = 1').run()
      store.vistos.setWatchedTitle(MAR, true)
      store.db
        .query(
          'UPDATE watched_title SET created_at = 2 WHERE anime_id = (SELECT id FROM anime WHERE provider_ref = ?)',
        )
        .run(MAR.value)

      expect(store.vistos.listWatchedTitles().map((item) => item.title)).toEqual([
        'Mar de Cristal',
        'Aurora Nocturna',
      ])
    })
  })
})

/**
 * La marca de «quiero ver».
 *
 * Tercera hermana del favorito y de la de visto, con sus mismos casos: la clave
 * es el anime —marcar dos veces deja una fila— y marcar algo que no está se
 * denuncia, que es lo que la ruta convierte en un 404. Lo que se añade aquí, y es
 * lo que la distingue, es que las tres listas son **independientes**: escribir en
 * una no toca las otras dos, que es la decisión de producto de este corte.
 */
describe('la marca de quiero ver', () => {
  test('marcar y leer, con la fecha de la marca', async () => {
    await withStore((store) => {
      store.pendientes.setPlanToWatch(AURORA, true)

      const lista = store.pendientes.listPlanToWatch()

      expect(lista.map((item) => item.title)).toEqual(['Aurora Nocturna'])
      expect(lista[0]?.createdAt).toBeInstanceOf(Date)
      // El resumen viaja entero: la lectura alimenta el Perfil y su tarjeta.
      expect(lista[0]?.year).toBe(2019)
      expect(lista[0]?.kind).toBe('tv')
    })
  })

  test('marcar dos veces no duplica: la clave es el anime', async () => {
    await withStore((store) => {
      store.pendientes.setPlanToWatch(AURORA, true)
      store.pendientes.setPlanToWatch(AURORA, true)

      expect(store.pendientes.listPlanToWatch()).toHaveLength(1)
      expect(store.db.query('SELECT COUNT(*) AS total FROM plan_to_watch').get()).toEqual({
        total: 1,
      })
    })
  })

  test('desmarcar lo saca, y desmarcar algo que no estaba no falla', async () => {
    await withStore((store) => {
      store.pendientes.setPlanToWatch(AURORA, true)
      store.pendientes.setPlanToWatch(AURORA, false)

      expect(store.pendientes.listPlanToWatch()).toEqual([])

      store.pendientes.setPlanToWatch(MAR, false)
      expect(store.pendientes.listPlanToWatch()).toEqual([])
    })
  })

  test('marcar una obra que no está se denuncia', async () => {
    await withStore((store) => {
      expect(() =>
        store.pendientes.setPlanToWatch({ providerId: 'fixture', value: 'no-existe' }, true),
      ).toThrow(/no está/)
    })
  })

  test('no fabrica progreso de episodios: declara una intención, no un visionado', async () => {
    await withStore((store) => {
      store.pendientes.setPlanToWatch(AURORA, true)

      expect(store.db.query('SELECT COUNT(*) AS total FROM watch_event').get()).toEqual({
        total: 0,
      })
    })
  })

  test('las tres marcas son independientes: ninguna escribe en las otras dos', async () => {
    await withStore((store) => {
      store.pendientes.setPlanToWatch(AURORA, true)

      expect(store.favoritos.listFavorites()).toEqual([])
      expect(store.vistos.listWatchedTitles()).toEqual([])

      store.vistos.setWatchedTitle(AURORA, true)

      // Marcar como vista no la saca de pendientes: son tres listas del usuario y
      // acoplarlas borraría una marca a mano sin decirlo.
      expect(store.pendientes.listPlanToWatch()).toHaveLength(1)

      store.pendientes.setPlanToWatch(AURORA, false)

      // Y al revés: quitarla de pendientes no toca la marca de visto.
      expect(store.vistos.listWatchedTitles()).toHaveLength(1)
    })
  })

  test('la lista sale de la más reciente a la más antigua', async () => {
    await withStore((store) => {
      store.pendientes.setPlanToWatch(AURORA, true)
      store.db.query('UPDATE plan_to_watch SET created_at = 1').run()
      store.pendientes.setPlanToWatch(MAR, true)
      store.db
        .query(
          'UPDATE plan_to_watch SET created_at = 2 WHERE anime_id = (SELECT id FROM anime WHERE provider_ref = ?)',
        )
        .run(MAR.value)

      expect(store.pendientes.listPlanToWatch().map((item) => item.title)).toEqual([
        'Mar de Cristal',
        'Aurora Nocturna',
      ])
    })
  })
})

describe('búsquedas recientes', () => {
  test('registra y lee, con su número de aciertos', async () => {
    await withStore((store) => {
      store.historial.recordSearch('aurora', 'fixture', 2)

      const lista = store.historial.listRecentSearches(10)

      expect(lista).toHaveLength(1)
      expect(lista[0]?.query).toBe('aurora')
      expect(lista[0]?.providerId).toBe('fixture')
      expect(lista[0]?.hits).toBe(2)
      expect(lista[0]?.searchedAt).toBeInstanceOf(Date)
    })
  })

  test('la misma búsqueda dos veces son dos filas: es historial, no caché', async () => {
    await withStore((store) => {
      store.historial.recordSearch('aurora', 'fixture', 2)
      store.historial.recordSearch('aurora', 'fixture', 2)

      expect(store.historial.listRecentSearches(10)).toHaveLength(2)
    })
  })

  test('la consulta se guarda tal como se escribió, sin normalizar', async () => {
    await withStore((store) => {
      store.historial.recordSearch('  Aurora NOCTURNA ', 'fixture', 1)

      expect(store.historial.listRecentSearches(1)[0]?.query).toBe('  Aurora NOCTURNA ')
    })
  })

  test('el límite se respeta y el orden es del más reciente', async () => {
    await withStore((store) => {
      // Reloj inyectado que **va hacia atrás**: así la fecha y el identificador
      // dicen cosas distintas y la prueba distingue ordenar por una o por otro.
      // Con inserciones seguidas en el mismo milisegundo, las dos formas dan el
      // mismo resultado y no se probaría nada.
      let reloj = 10_000
      const historial = createSearchHistoryRepository(store.db, () => {
        reloj -= 1_000
        return reloj
      })

      for (const consulta of ['uno', 'dos', 'tres', 'cuatro']) {
        historial.recordSearch(consulta, 'fixture', 1)
      }

      const lista = historial.listRecentSearches(2)

      expect(lista.map((item) => item.query)).toEqual(['uno', 'dos'])
    })
  })

  test('con la misma fecha, el desempate es el más reciente por id', async () => {
    await withStore((store) => {
      const historial = createSearchHistoryRepository(store.db, () => 5_000)
      historial.recordSearch('uno', 'fixture', 1)
      historial.recordSearch('dos', 'fixture', 1)

      expect(historial.listRecentSearches(2).map((item) => item.query)).toEqual(['dos', 'uno'])
    })
  })

  test('unos aciertos imposibles se denuncian', async () => {
    await withStore((store) => {
      expect(() => store.historial.recordSearch('aurora', 'fixture', -1)).toThrow(/aciertos/)
      expect(() => store.historial.recordSearch('aurora', 'fixture', 1.5)).toThrow(/aciertos/)
    })
  })
})

describe('todo sobrevive a cerrar y reabrir', () => {
  test('historial, favoritos, vistos y búsquedas siguen ahí después', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nn-anime-usuario-'))
    const path = join(dir, 'nn-anime.db')
    const abiertas: Database[] = []

    try {
      const primera = openDb(path)
      abiertas.push(primera)
      runMigrations(primera)
      createAnimeRepository(primera).write(AURORA, anime(AURORA, 'Aurora Nocturna', 2019))
      createEpisodesRepository(primera).write(AURORA, [episodio(AURORA, 1)])
      const id = createWatchRepository(primera).recordWatch(
        visionado(AURORA, 1, new Date(1_000_000)),
      )
      createWatchRepository(primera).updateWatchPosition(id, 300, 1440)
      createFavoritesRepository(primera).setFavorite(AURORA, true)
      createWatchedTitlesRepository(primera).setWatchedTitle(AURORA, true)
      createSearchHistoryRepository(primera).recordSearch('aurora', 'fixture', 2)
      primera.close()

      const segunda = openDb(path)
      abiertas.push(segunda)
      runMigrations(segunda)
      const visto = createWatchRepository(segunda).listRecentlyWatched(10)
      const favoritos = createFavoritesRepository(segunda).listFavorites()
      const marcadas = createWatchedTitlesRepository(segunda).listWatchedTitles()
      const busquedas = createSearchHistoryRepository(segunda).listRecentSearches(10)
      segunda.close()

      expect(visto).toHaveLength(1)
      expect(visto[0]?.positionS).toBe(300)
      expect(visto[0]?.anime.title).toBe('Aurora Nocturna')
      expect(favoritos).toHaveLength(1)
      expect(marcadas.map((item) => item.title)).toEqual(['Aurora Nocturna'])
      expect(busquedas[0]?.query).toBe('aurora')
    } finally {
      // Cerrar en el `finally` y no en el cuerpo evita que una aserción que falle
      // deje la base abierta y convierta el `rm` en un EBUSY que la tape.
      for (const abierta of abiertas) cerrarBase(abierta)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('borrar el anime se lleva su historial, sus favoritos y su marca', async () => {
    await withStore((store) => {
      store.watch.recordWatch(visionado(AURORA, 1, new Date()))
      store.favoritos.setFavorite(AURORA, true)
      store.vistos.setWatchedTitle(AURORA, true)

      store.db
        .query('DELETE FROM anime WHERE provider_id = ? AND provider_ref = ?')
        .run(AURORA.providerId, AURORA.value)

      expect(store.watch.listRecentlyWatched(10)).toEqual([])
      expect(store.favoritos.listFavorites()).toEqual([])
      expect(store.vistos.listWatchedTitles()).toEqual([])
    })
  })
})

const SERIE: ProviderRef = { providerId: 'series', value: 'serie/uno' }

/** Un episodio de una serie que numera por temporada. */
function episodioDeTemporada(temporada: number, numero: number): Episode {
  const ref = { providerId: SERIE.providerId, value: `serie/uno/temporada/${temporada}#${numero}` }

  return {
    ref,
    animeRef: { providerId: SERIE.providerId, value: `serie/uno/temporada/${temporada}` },
    number: numero,
    season: temporada,
    title: `Episodio ${numero}`,
    mode: 'sub',
  }
}

describe('la temporada y la referencia real del episodio', () => {
  test('la temporada se guarda y se lee; sin ella la fila sigue valiendo', async () => {
    await withStore((store) => {
      store.anime.write(SERIE, anime(SERIE, 'Serie Uno', 2024))
      store.episodios.write(SERIE, [
        episodioDeTemporada(1, 1),
        episodioDeTemporada(1, 2),
        episodioDeTemporada(2, 1),
        episodioDeTemporada(2, 2),
      ])

      const leidos = store.episodios.read(SERIE)
      expect(leidos?.value.map((episode) => [episode.season, episode.number])).toEqual([
        [1, 1],
        [1, 2],
        [2, 1],
        [2, 2],
      ])

      // Y el caso viejo: una fila sin temporada no se convierte en temporada 1.
      store.episodios.write(AURORA, [episodio(AURORA, 1)])
      const viejos = store.episodios.read(AURORA)
      expect(viejos?.value[0]?.season).toBeUndefined()
    })
  })

  test('dos temporadas con el mismo número no colapsan al continuar viendo', async () => {
    await withStore((store) => {
      store.anime.write(SERIE, anime(SERIE, 'Serie Uno', 2024))
      store.episodios.write(SERIE, [
        episodioDeTemporada(1, 1),
        episodioDeTemporada(2, 1),
      ])

      const primera = store.watch.recordWatch({
        ...visionado(SERIE, 1, new Date(1_000)),
        episodeRef: { providerId: 'series', value: 'serie/uno/temporada/1#1' },
      })
      const segunda = store.watch.recordWatch({
        ...visionado(SERIE, 1, new Date(2_000)),
        episodeRef: { providerId: 'series', value: 'serie/uno/temporada/2#1' },
      })
      store.watch.updateWatchPosition(primera, 100, 1440)
      store.watch.updateWatchPosition(segunda, 200, 1440)

      const filas = store.watch.listRecentlyWatched(10)
      expect(filas).toHaveLength(2)

      const porTemporada = filas
        .map((fila) => ({
          season: fila.season,
          ref: fila.episodeRef.value,
          estado: fila.positionS,
        }))
        .sort((a, b) => (a.season ?? 0) - (b.season ?? 0))

      // La referencia es la del episodio, no `animeRef#number`: con ella el
      // reproductor vuelve al episodio correcto. Mutar la proyección para
      // reconstruirla hace fallar esta comparación.
      expect(porTemporada).toEqual([
        { season: 1, ref: 'serie/uno/temporada/1#1', estado: 100 },
        { season: 2, ref: 'serie/uno/temporada/2#1', estado: 200 },
      ])
    })
  })
})
