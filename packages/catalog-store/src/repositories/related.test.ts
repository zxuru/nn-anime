import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnimeDetail, ProviderRef, SearchResult } from '@nn-anime/core'
import { openDb } from '../db'
import { runMigrations } from '../migrations/runner'
import { createAnimeRepository } from './anime'
import { createRelatedRepository, type RelatedStore } from './related'
import { createSearchRepository } from './search'

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

function resultado(providerId: string, ref: string, title: string, year?: number): SearchResult {
  return { ref: { providerId, value: ref }, title, ...(year === undefined ? {} : { year }) }
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

/** Lo que la caché de una búsqueda dejó escrito, sin abrir ninguna ficha. */
interface Listado {
  readonly providerId: string
  readonly query: string
  readonly results: readonly SearchResult[]
}

/** Cierra la base sin lanzar: algún test la cierra por su cuenta. */
function cerrarBase(db: Database): void {
  try {
    db.close()
  } catch {
    // Ya estaba cerrada: no hay nada que hacer.
  }
}

/** Base temporal con la saga dentro, en fichas abiertas y en listados cacheados. */
async function withStore<T>(
  titulos: readonly (readonly [ProviderRef, string, number])[],
  body: (store: Store) => T,
  listados: readonly Listado[] = [],
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-relacionados-'))
  const db = openDb(join(dir, 'nn-anime.db'))

  try {
    runMigrations(db)
    const animeRepo = createAnimeRepository(db)
    for (const [ref, title, year] of titulos) animeRepo.write(ref, anime(ref, title, year))

    const cache = createSearchRepository(db)
    for (const listado of listados) {
      cache.write(listado.providerId, listado.query, listado.results)
    }

    const contador = contarConsultas(db)
    const related = createRelatedRepository(contador.db)

    return body({ related, llamadas: contador.llamadas })
  } finally {
    // Windows no deja borrar un archivo abierto, y SQLite mantiene la base y sus
    // `-wal`/`-shm` hasta el cierre: cerrarla antes del `rm` es lo que permite
    // borrar el directorio sin un EBUSY que tape el resultado del test.
    cerrarBase(db)
    await rm(dir, { recursive: true, force: true })
  }
}

const FRIEREN: ProviderRef = { providerId: 'fixture', value: 'frieren' }
const FRIEREN_2: ProviderRef = { providerId: 'fixture', value: 'frieren-2' }
const MAR: ProviderRef = { providerId: 'fixture', value: 'mar-de-cristal' }
const KIMETSU: ProviderRef = { providerId: 'jkanime', value: 'kimetsu-no-yaiba' }
const NARUTO: ProviderRef = { providerId: 'jkanime', value: 'naruto' }
const SHIPPUDEN: ProviderRef = { providerId: 'jkanime', value: 'naruto-shippuden' }
const DRAGON_BALL: ProviderRef = { providerId: 'jkanime', value: 'dragon-ball' }
const DRAGON_BALL_Z: ProviderRef = { providerId: 'jkanime', value: 'dragon-ball-z' }

describe('listRelated', () => {
  /**
   * El alcance elige la clave, y nada más.
   *
   * Sin alcance —el de siempre— «Naruto» y «Naruto Shippuden» son dos sagas
   * distintas y no se relacionan. Con `'franchise'` sí, que es lo que la fuente
   * no puede decir porque las nombra como dos obras.
   */
  test('el alcance de franquicia junta la secuela que la saga separa', async () => {
    await withStore(
      [
        [NARUTO, 'Naruto', 2002],
        [SHIPPUDEN, 'Naruto Shippuden', 2007],
        [DRAGON_BALL, 'Dragon Ball', 1986],
        [DRAGON_BALL_Z, 'Dragon Ball Z', 1989],
      ],
      (store) => {
        expect(store.related.list(NARUTO, 10).map((item) => item.ref.value)).toEqual([])

        // La mutación que ignore el alcance deja en rojo esta línea.
        expect(store.related.list(NARUTO, 10, 'franchise').map((item) => item.ref.value)).toEqual([
          'naruto-shippuden',
        ])
        // Y no se lleva por delante la otra franquicia: el prefiltro por la
        // primera palabra ya las separa.
        expect(
          store.related.list(DRAGON_BALL, 10, 'franchise').map((item) => item.ref.value),
        ).toEqual(['dragon-ball-z'])
      },
    )
  })

  test('la franquicia sigue siendo una sola consulta preparada', async () => {
    await withStore(
      [
        [NARUTO, 'Naruto', 2002],
        [SHIPPUDEN, 'Naruto Shippuden', 2007],
      ],
      (store) => {
        store.related.list(NARUTO, 10, 'franchise')

        expect(store.llamadas()).toBe(2)
      },
    )
  })

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

  test('la entrega con subtítulo propio es un hermano de la saga', async () => {
    await withStore(
      [
        [KIMETSU, 'Kimetsu no Yaiba', 2019],
        [
          { providerId: 'jkanime', value: 'mugen-ressha' },
          'Kimetsu no Yaiba: Mugen Ressha-hen',
          2020,
        ],
        [
          { providerId: 'jkanime', value: 'mugenjou' },
          'Kimetsu no Yaiba Movie 1: Mugenjou-hen',
          2025,
        ],
      ],
      (store) => {
        const lista = store.related.list(KIMETSU, 10)

        // La mutación que empareje por `baseTitle` en lugar de por `sagaTitle`
        // deja esta prueba en rojo con la lista vacía: es el síntoma reportado.
        expect(lista.map((item) => item.ref.value).sort()).toEqual(['mugen-ressha', 'mugenjou'])
      },
    )
  })

  test('cruza proveedores: la misma saga en otra fuente también se relaciona', async () => {
    await withStore(
      [
        [KIMETSU, 'Kimetsu no Yaiba', 2019],
        [{ providerId: 'animeav1', value: 'yuukaku' }, 'Kimetsu no Yaiba: Yuukaku-hen', 2021],
      ],
      (store) => {
        const lista = store.related.list(KIMETSU, 10)

        // La mutación que vuelva a filtrar por `provider_id` deja esto en rojo.
        expect(lista.map((item) => item.ref.providerId)).toEqual(['animeav1'])
      },
    )
  })

  test('lee la saga de la caché: un hermano que sólo salió en una búsqueda cuenta', async () => {
    await withStore(
      [[KIMETSU, 'Kimetsu no Yaiba', 2019]],
      (store) => {
        const lista = store.related.list(KIMETSU, 10)

        // La mutación que lea sólo la tabla `anime` deja esta prueba en rojo con
        // la lista vacía: es el caso de la captura —saga cacheada, una ficha
        // abierta—.
        expect(lista.map((item) => item.ref.value)).toEqual(['yuukaku', 'katanakaji'])
      },
      [
        {
          providerId: 'animeav1',
          query: 'kimetsu no yaiba',
          results: [
            resultado('animeav1', 'yuukaku', 'Kimetsu no Yaiba: Yuukaku-hen', 2021),
            resultado('animeav1', 'katanakaji', 'Kimetsu no Yaiba: Katanakaji no Sato-hen', 2023),
          ],
        },
      ],
    )
  })

  test('la misma entrega en dos proveedores es una fila, y gana el de la ficha', async () => {
    await withStore(
      [
        [KIMETSU, 'Kimetsu no Yaiba', 2019],
        [{ providerId: 'jkanime', value: 'yuukaku-j' }, 'Kimetsu no Yaiba: Yuukaku-hen', 2021],
      ],
      (store) => {
        const lista = store.related.list(KIMETSU, 10)

        // Dos filas para la misma obra es el «contenido repetido» que se
        // reportó; la mutación que quite el mapa por obra lo deja en rojo.
        expect(lista).toHaveLength(1)
        expect(lista[0]?.ref).toEqual({ providerId: 'jkanime', value: 'yuukaku-j' })
      },
      [
        {
          providerId: 'animeav1',
          query: 'kimetsu',
          results: [resultado('animeav1', 'yuukaku-a', 'Kimetsu no Yaiba: Yuukaku-hen', 2021)],
        },
      ],
    )
  })

  test('la misma obra en otro proveedor no es un hermano de saga', async () => {
    await withStore(
      [
        [KIMETSU, 'Kimetsu no Yaiba', 2019],
        [{ providerId: 'animeav1', value: 'kimetsu' }, 'Kimetsu no Yaiba', 2019],
        [{ providerId: 'animeav1', value: 'yuukaku' }, 'Kimetsu no Yaiba: Yuukaku-hen', 2021],
      ],
      (store) => {
        const lista = store.related.list(KIMETSU, 10)

        // Repetir la propia ficha desde otra fuente es el «contenido repetido»
        // reportado; la mutación que quite esta exclusión la deja en rojo con
        // dos filas.
        expect(lista.map((item) => item.title)).toEqual(['Kimetsu no Yaiba: Yuukaku-hen'])
      },
    )
  })

  /**
   * Las dos fichas reales de la base de desarrollo: la misma obra, un nombre en
   * cada fuente, y la referencia de cada una apuntando al nombre de la otra.
   */
  const DANMACHI_JK: ProviderRef = {
    providerId: 'jkanime',
    value: 'dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka',
  }
  const DANMACHI_AV1: ProviderRef = { providerId: 'animeav1', value: 'danmachi' }
  const DANMACHI_III: ProviderRef = { providerId: 'animeav1', value: 'danmachi-iii' }

  test('la temporada que la otra fuente nombra con el título original entra', async () => {
    await withStore(
      [
        [DANMACHI_JK, 'Danmachi', 2015],
        [DANMACHI_AV1, 'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka', 2015],
        [DANMACHI_III, 'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka III', 2020],
      ],
      (store) => {
        // Las dos fichas ven lo mismo: la tercera temporada, que la otra fuente
        // publica con el título original. La mutación que compare sólo contra la
        // saga del título de la ficha deja las dos listas vacías.
        expect(store.related.list(DANMACHI_JK, 10).map((item) => item.ref.value)).toEqual([
          'danmachi-iii',
        ])
        expect(store.related.list(DANMACHI_AV1, 10).map((item) => item.ref.value)).toEqual([
          'danmachi-iii',
        ])
      },
    )
  })

  test('la misma obra con otro nombre no se lista como hermana', async () => {
    await withStore(
      [
        [DANMACHI_JK, 'Danmachi', 2015],
        [DANMACHI_AV1, 'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka', 2015],
      ],
      (store) => {
        // Es la misma ficha en otra fuente: sale una vez, y no sale aquí.
        expect(store.related.list(DANMACHI_JK, 10)).toEqual([])
        expect(store.related.list(DANMACHI_AV1, 10)).toEqual([])
      },
    )
  })

  test('el spin-off de la misma saga sigue siendo un hermano, no la misma obra', async () => {
    await withStore(
      [
        [DANMACHI_JK, 'Danmachi', 2015],
        [
          {
            providerId: 'jkanime',
            value: 'dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka-gaiden-sword-oratoria',
          },
          'Danmachi: Sword Oratoria',
          2017,
        ],
      ],
      (store) => {
        expect(store.related.list(DANMACHI_JK, 10).map((item) => item.title)).toEqual([
          'Danmachi: Sword Oratoria',
        ])
      },
    )
  })

  test('la misma obra con dos nombres en dos fuentes sale una vez', async () => {
    const ORATORIA_AV1: ProviderRef = { providerId: 'animeav1', value: 'danmachi-sword-oratoria' }
    const ORATORIA_JK: ProviderRef = {
      providerId: 'jkanime',
      value: 'dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka-gaiden-sword-oratoria',
    }

    await withStore(
      [
        [DANMACHI_JK, 'Danmachi', 2015],
        [
          ORATORIA_AV1,
          'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka Gaiden: Sword Oratoria',
          2017,
        ],
        [ORATORIA_JK, 'Danmachi: Sword Oratoria', 2017],
      ],
      (store) => {
        const lista = store.related.list(DANMACHI_JK, 10)

        // Es la misma obra: el nombre largo de una es la referencia de la otra, y
        // `sameWork` las junta. Con la clave por título salían las dos —es el caso
        // real que se vio en la ficha de «Danmachi»—, que es el contenido repetido
        // que el spec prohíbe. Gana la del proveedor de la ficha.
        expect(lista).toHaveLength(1)
        expect(lista[0]?.ref).toEqual(ORATORIA_JK)
        expect(lista[0]?.title).toBe('Danmachi: Sword Oratoria')
      },
    )
  })

  test('la saga vecina que sólo comparte la primera palabra no entra', async () => {
    await withStore(
      [
        [KIMETSU, 'Kimetsu no Yaiba', 2019],
        [{ providerId: 'jkanime', value: 'gakuen' }, 'Kimetsu Gakuen: Valentine-hen', 2020],
      ],
      (store) => {
        // El prefiltro de SQL es por la primera palabra —«kimetsu»—, así que
        // esta fila llega a memoria; la comparación de saga es la que la deja
        // fuera. Sin ella, «Kimetsu Gakuen» aparecería como hermano.
        expect(store.related.list(KIMETSU, 10)).toEqual([])
      },
    )
  })

  test('la consulta no crece con los candidatos', async () => {
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
})

describe('listSources', () => {
  const YANI_JKANIME: ProviderRef = { providerId: 'jkanime', value: 'yani-neko' }

  test('la misma obra en otra fuente sale, y la de la ficha no', async () => {
    await withStore(
      [
        [YANI_JKANIME, 'Yani Neko', 2026],
        [{ providerId: 'animeav1', value: 'yani-neko' }, 'yani  neko!', 2026],
      ],
      (store) => {
        const lista = store.related.listSources(YANI_JKANIME, 10)

        // Sin el plegado de acentos, mayúsculas y signos, la lista sale vacía; sin
        // la exclusión de la fuente propia, sale también la que se está viendo.
        expect(lista.map((item) => `${item.ref.providerId}:${item.ref.value}`)).toEqual([
          'animeav1:yani-neko',
        ])
        expect(lista[0]?.title).toBe('yani  neko!')
        expect(lista[0]?.year).toBe(2026)
      },
    )
  })

  test('la misma obra con otro nombre en la otra fuente también sale', async () => {
    // Las dos fichas reales de la base: la misma obra, un nombre en cada fuente,
    // y la referencia de cada una apuntando al nombre de la otra. La mutación que
    // vuelva a comparar por título normalizado deja la ficha sin «también en».
    await withStore(
      [
        [
          {
            providerId: 'jkanime',
            value: 'dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka',
          },
          'Danmachi',
          2015,
        ],
        [
          { providerId: 'animeav1', value: 'danmachi' },
          'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka',
          2015,
        ],
      ],
      (store) => {
        expect(
          store.related
            .listSources(
              {
                providerId: 'jkanime',
                value: 'dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka',
              },
              10,
            )
            .map((item) => `${item.ref.providerId}:${item.ref.value}`),
        ).toEqual(['animeav1:danmachi'])
      },
    )
  })

  test('el mismo título en años distintos no es la misma obra', async () => {
    await withStore(
      [
        [YANI_JKANIME, 'One Piece', 1999],
        [{ providerId: 'animeav1', value: 'one-piece' }, 'One Piece', 2026],
      ],
      (store) => {
        // Juntar dos obras homónimas de años distintos escondería una de las dos
        // de la ficha; la mutación que quite el año de la clave la deja en rojo.
        expect(store.related.listSources(YANI_JKANIME, 10)).toEqual([])
      },
    )
  })

  test('la temporada de la misma saga no es la misma obra', async () => {
    await withStore(
      [
        [FRIEREN, 'Sousou no Frieren', 2023],
        // El mismo año a propósito: así la única regla que puede dejar la lista
        // vacía es la clave de título. Con `sagaTitle` en su lugar, las dos
        // entregas serían la misma obra y la ficha ofrecería cambiar de fuente a
        // otra temporada.
        [{ providerId: 'animeav1', value: 'frieren-2' }, 'Sousou no Frieren 2nd Season', 2023],
      ],
      (store) => {
        expect(store.related.listSources(FRIEREN, 10)).toEqual([])
      },
    )
  })

  test('una entrada por fuente, la de referencia alfabéticamente menor', async () => {
    await withStore(
      [
        // La menor primero y la mayor después: sin la comparación de referencias,
        // la lectura se quedaría con la última fila y esta prueba lo vería.
        [YANI_JKANIME, 'Yani Neko', 2026],
        [{ providerId: 'jkanime', value: 'yani-neko-tv' }, 'Yani Neko', 2026],
        [{ providerId: 'animeav1', value: 'yani' }, 'Yani Neko', 2026],
      ],
      (store) => {
        const lista = store.related.listSources({ providerId: 'animeav1', value: 'yani' }, 10)

        // Dos referencias de la misma fuente para la misma obra no son dos sitios
        // donde elegir; la mutación que quite el mapa por proveedor deja dos filas.
        expect(lista.map((item) => `${item.ref.providerId}:${item.ref.value}`)).toEqual([
          'jkanime:yani-neko',
        ])
      },
    )
  })

  test('lee la obra de un listado cacheado, no sólo de las fichas abiertas', async () => {
    await withStore(
      [[YANI_JKANIME, 'Yani Neko', 2026]],
      (store) => {
        // La misma fuente de candidatos que los relacionados: sin ella, una ficha
        // cuya otra fuente sólo salió en una búsqueda no ofrecería el cambio.
        expect(store.related.listSources(YANI_JKANIME, 10).map((item) => item.ref.value)).toEqual([
          'yani-neko',
        ])
      },
      [
        {
          providerId: 'animeav1',
          query: 'yani neko',
          results: [resultado('animeav1', 'yani-neko', 'Yani Neko', 2026)],
        },
      ],
    )
  })

  test('sin otra fuente devuelve lista vacía, no un error', async () => {
    await withStore([[YANI_JKANIME, 'Yani Neko', 2026]], (store) => {
      expect(store.related.listSources(YANI_JKANIME, 10)).toEqual([])
    })
  })

  test('una referencia que no está en la base tampoco es un error', async () => {
    await withStore([[YANI_JKANIME, 'Yani Neko', 2026]], (store) => {
      expect(store.related.listSources({ providerId: 'jkanime', value: 'no-existe' }, 10)).toEqual(
        [],
      )
    })
  })

  test('el límite se respeta', async () => {
    await withStore(
      [
        [YANI_JKANIME, 'Yani Neko', 2026],
        [{ providerId: 'animeav1', value: 'yani-neko' }, 'Yani Neko', 2026],
        [{ providerId: 'otra', value: 'yani-neko' }, 'Yani Neko', 2026],
      ],
      (store) => {
        expect(store.related.listSources(YANI_JKANIME, 1)).toHaveLength(1)
      },
    )
  })

  test('la consulta no crece con los candidatos', async () => {
    await withStore(
      [
        [YANI_JKANIME, 'Yani Neko', 2026],
        [{ providerId: 'animeav1', value: 'yani-neko' }, 'Yani Neko', 2026],
        [{ providerId: 'otra', value: 'yani-neko' }, 'Yani Neko', 2026],
      ],
      (store) => {
        const antes = store.llamadas()
        store.related.listSources(YANI_JKANIME, 10)

        expect(store.llamadas()).toBe(antes)
      },
    )
  })
})
