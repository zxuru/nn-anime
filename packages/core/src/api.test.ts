import { describe, expect, test } from 'bun:test'
import {
  anilistRelatedResponseSchema,
  episodeResponseSchema,
  episodesResponseSchema,
  feedItemSchema,
  providerRepoRecordSchema,
  providerRepoSelectionSchema,
  providerReposResponseSchema,
  providerRepoUrlSchema,
  providerRepoViewSchema,
  relatedResponseSchema,
  watchedResponseSchema,
} from './api'
import { MAX_ENABLED_REPO_FILES, MAX_REPO_PATH_LENGTH, MAX_REPO_URL_LENGTH } from './repos'

const fila = {
  number: 3,
  mode: 'sub',
  positionS: 600,
  durationS: 1440,
  ratio: 0.4166,
  finished: false,
  watchedAt: '2026-10-12T10:00:00.000Z',
}

/**
 * La marca de adultos de una novedad del feed.
 *
 * Opcional y **sólo verdadera**: la entrada la publica un plugin que no dice la
 * edad, así que lo único que se puede afirmar de ella es que se comprobó que lo es.
 * Un `false` diría que se miró, y no consta.
 */
describe('feedItemSchema: la marca de adultos', () => {
  const item = { ref: { providerId: 'fuente-ejemplo', value: 'titulo-1' }, title: 'Un título' }

  test('sin marca vale: de una novedad del feed no consta la edad', () => {
    expect(feedItemSchema.safeParse(item).success).toBe(true)
  })

  test('con la marca puesta vale', () => {
    expect(feedItemSchema.safeParse({ ...item, adult: true }).success).toBe(true)
  })

  test('`adult: false` se rechaza', () => {
    expect(feedItemSchema.safeParse({ ...item, adult: false }).success).toBe(false)
  })
})

describe('watchedResponseSchema', () => {
  test('acepta una fila completa', () => {
    const parsed = watchedResponseSchema.safeParse({ episodes: [fila] })

    expect(parsed.success).toBe(true)
  })

  test('acepta el episodio decimal: el visionado de un 12.5 también se guarda', () => {
    expect(watchedResponseSchema.safeParse({ episodes: [{ ...fila, number: 12.5 }] }).success).toBe(
      true,
    )
  })

  test('rechaza una proporción fuera de [0, 1]', () => {
    // Sin el tope, un `durationS` mal calculado pintaría una barra que se sale
    // de su carril sin que nadie se entere hasta verla.
    expect(watchedResponseSchema.safeParse({ episodes: [{ ...fila, ratio: 1.2 }] }).success).toBe(
      false,
    )
    expect(watchedResponseSchema.safeParse({ episodes: [{ ...fila, ratio: -0.1 }] }).success).toBe(
      false,
    )
  })

  test('rechaza un modo que no existe', () => {
    expect(
      watchedResponseSchema.safeParse({ episodes: [{ ...fila, mode: 'latino' }] }).success,
    ).toBe(false)
  })
})

describe('relatedResponseSchema', () => {
  test('una lista vacía es válida: «no hay hermanos» no es un error', () => {
    expect(relatedResponseSchema.safeParse({ items: [] }).success).toBe(true)
  })

  test('rechaza una clave de más: el contrato es estricto', () => {
    expect(
      relatedResponseSchema.safeParse({
        items: [{ ref: { providerId: 'fixture', value: 'x' }, title: 'X', score: 1 }],
      }).success,
    ).toBe(false)
  })
})

const EPISODIO = {
  ref: { providerId: 'fixture', value: 'aurora-nocturna/12.5' },
  animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
  number: 12.5,
  mode: 'sub',
}

describe('episodesResponseSchema: la página', () => {
  test('una respuesta sin página sigue valiendo, y la página por defecto es la primera', () => {
    // El servidor aprendió a paginar después que el cliente a leer `episodes`:
    // un campo requerido nuevo habría roto a quien ya lo leía.
    const parsed = episodesResponseSchema.safeParse({ episodes: [EPISODIO] })

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.page).toBe(1)
      expect(parsed.data.hasMore).toBe(false)
    }
  })

  test('acepta la página con su total y el episodio decimal', () => {
    const parsed = episodesResponseSchema.safeParse({
      episodes: [EPISODIO],
      page: 2,
      hasMore: true,
      total: 26,
    })

    expect(parsed.success).toBe(true)
  })

  test('rechaza la página 0: las páginas se numeran desde la uno', () => {
    expect(episodesResponseSchema.safeParse({ episodes: [], page: 0 }).success).toBe(false)
  })

  test('rechaza un hasMore que no es booleano', () => {
    expect(episodesResponseSchema.safeParse({ episodes: [], hasMore: 'sí' }).success).toBe(false)
  })
})

describe('episodeResponseSchema: el episodio suelto', () => {
  test('acepta el episodio que se pidió por número', () => {
    expect(episodeResponseSchema.safeParse({ episode: EPISODIO }).success).toBe(true)
  })

  test('rechaza un cuerpo sin episodio', () => {
    expect(episodeResponseSchema.safeParse({}).success).toBe(false)
  })
})

const REPO = {
  url: 'https://github.com/zxuru/nn-anime-plugins',
  owner: 'zxuru',
  repo: 'nn-anime-plugins',
  ref: 'main',
  fetchedAt: '2026-10-13T10:00:00.000Z',
  enabled: ['jkanime.ts'],
  files: 7,
}

describe('providerRepoUrlSchema: la dirección del formulario', () => {
  test('acepta lo que se copia del navegador y lo que se teclea', () => {
    const formas = [
      'https://github.com/zxuru/nn-anime-plugins',
      'github.com/zxuru/nn-anime-plugins/tree/dev/src',
      'zxuru/nn-anime-plugins',
    ]

    for (const forma of formas) {
      expect(providerRepoUrlSchema.safeParse(forma).success).toBe(true)
    }
  })

  test('recorta el espacio de alrededor antes de juzgar', () => {
    const parsed = providerRepoUrlSchema.safeParse('  zxuru/nn-anime-plugins  ')

    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data).toBe('zxuru/nn-anime-plugins')
  })

  test('rechaza lo que no es un repositorio de GitHub, y lo dice', () => {
    const parsed = providerRepoUrlSchema.safeParse('https://gitlab.com/o/r')

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe('no es una dirección de repositorio de GitHub')
    }
  })

  test('una ruta de más de lo que cabe en un repositorio se rechaza', () => {
    const larga = 'x'.repeat(MAX_REPO_PATH_LENGTH + 1)

    expect(
      providerReposResponseSchema.safeParse({
        repos: [
          {
            ...REPO,
            present: true,
            candidates: [{ path: larga }],
          },
        ],
      }).success,
    ).toBe(false)
    expect(providerRepoSelectionSchema.safeParse({ url: 'o/r', enabled: [larga] }).success).toBe(
      false,
    )
  })

  test('una ficha con una dirección imposible no se lee del store', () => {
    // Nada que salga del analizador mide esto, así que la única forma de que
    // llegue es que alguien la haya escrito: se rechaza en vez de circular.
    expect(
      providerRepoRecordSchema.safeParse({
        ...REPO,
        url: `https://github.com/${'u'.repeat(MAX_REPO_URL_LENGTH)}`,
      }).success,
    ).toBe(false)
  })
})

describe('providerRepoRecordSchema: lo que se guarda', () => {
  test('acepta una ficha completa', () => {
    expect(providerRepoRecordSchema.safeParse(REPO).success).toBe(true)
  })

  test('la fecha va en ISO: una fecha suelta no es una fecha', () => {
    expect(providerRepoRecordSchema.safeParse({ ...REPO, fetchedAt: 'ayer' }).success).toBe(false)
  })

  test('una clave de más es un error, no algo que se ignora', () => {
    expect(providerRepoRecordSchema.safeParse({ ...REPO, extra: 1 }).success).toBe(false)
  })

  test('una lista de habilitados vacía es un estado legítimo', () => {
    expect(providerRepoRecordSchema.safeParse({ ...REPO, enabled: [] }).success).toBe(true)
  })
})

describe('providerRepoViewSchema: lo guardado más lo que hay ahora', () => {
  test('acepta la vista con sus candidatos', () => {
    const parsed = providerRepoViewSchema.safeParse({
      ...REPO,
      present: true,
      candidates: [{ path: 'jkanime.ts', id: 'jkanime', name: 'JKanime' }, { path: 'src/otro.ts' }],
    })

    expect(parsed.success).toBe(true)
  })

  test('sin `present` no es una vista: la interfaz tiene que poder decir si falta', () => {
    expect(providerRepoViewSchema.safeParse({ ...REPO, candidates: [] }).success).toBe(false)
  })
})

describe('providerRepoSelectionSchema: qué se activa', () => {
  test('acepta la selección con sus rutas', () => {
    expect(
      providerRepoSelectionSchema.safeParse({
        url: 'zxuru/nn-anime-plugins',
        enabled: ['a.ts', 'src/b.ts'],
      }).success,
    ).toBe(true)
  })

  test('una ruta vacía no es un archivo', () => {
    expect(providerRepoSelectionSchema.safeParse({ url: 'o/r', enabled: [''] }).success).toBe(false)
  })

  test('la lista tiene tope: una selección sin límite es una fila que crece sin fin', () => {
    const demasiadas = Array.from({ length: MAX_ENABLED_REPO_FILES + 1 }, (_, i) => `p${i}.ts`)

    expect(providerRepoSelectionSchema.safeParse({ url: 'o/r', enabled: demasiadas }).success).toBe(
      false,
    )
  })
})

/** Una pieza de los relacionados de AniList, sin `ref`: la obra no está en la base. */
const RELACIONADA = {
  anilistId: 112151,
  title: 'Kimetsu no Yaiba: Mugen Ressha-hen',
  cover: '/api/anilist/image/cover/112151',
  year: 2020,
  adult: false,
  kind: 'movie',
  relation: 'sequel',
}

describe('anilistRelatedResponseSchema: la pieza con su motivo', () => {
  test('acepta la pieza con su relación y con la referencia local cuando la hay', () => {
    expect(anilistRelatedResponseSchema.safeParse({ items: [RELACIONADA] }).success).toBe(true)
    expect(
      anilistRelatedResponseSchema.safeParse({
        items: [{ ...RELACIONADA, ref: { providerId: 'jkanime', value: 'kimetsu' } }],
      }).success,
    ).toBe(true)
  })

  test('un motivo que no es de la lista cerrada no vale', () => {
    // El nombre de AniList —`SEQUEL`— no es el del contrato: si viaja tal cual,
    // la interfaz traduce una clave que no existe y la pieza sale sin motivo.
    expect(
      anilistRelatedResponseSchema.safeParse({ items: [{ ...RELACIONADA, relation: 'SEQUEL' }] })
        .success,
    ).toBe(false)
    expect(
      anilistRelatedResponseSchema.safeParse({ items: [{ ...RELACIONADA, relation: 'crossover' }] })
        .success,
    ).toBe(false)
  })

  test('sin motivo no es una pieza relacionada', () => {
    const { relation: _sinMotivo, ...sinRelacion } = RELACIONADA

    expect(anilistRelatedResponseSchema.safeParse({ items: [sinRelacion] }).success).toBe(false)
  })
})
