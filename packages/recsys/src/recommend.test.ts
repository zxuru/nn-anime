import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Candidate } from '@nn-anime/core'
import { type RecommendSignals, recommend, SIGNAL_WEIGHTS, tieBreak } from './recommend'

const AHORA = new Date('2026-01-31T00:00:00Z')
const DIA = 86_400_000

function candidato(
  titulo: string,
  tags: readonly string[],
  opciones: { readonly studios?: readonly string[]; readonly popularity?: number } = {},
): Candidate {
  return {
    ref: { providerId: 'fixture', value: titulo },
    title: titulo,
    tags: [...tags],
    studios: [...(opciones.studios ?? [])],
    ...(opciones.popularity === undefined ? {} : { popularity: opciones.popularity }),
  }
}

function señales(overrides: Partial<RecommendSignals> = {}): RecommendSignals {
  return {
    events: [
      {
        tags: ['accion'],
        studios: ['Estudio Cobre'],
        at: new Date(AHORA.getTime() - 2 * DIA),
        completion: 1,
      },
    ],
    coVisits: [],
    searches: [],
    watchState: [],
    ...overrides,
  }
}

const CORPUS = [
  candidato('Mecha uno', ['accion', 'mecha'], { studios: ['Estudio Cobre'], popularity: 0.5 }),
  candidato('Mecha dos', ['accion', 'mecha'], { studios: ['Estudio Cobre'], popularity: 0.4 }),
  candidato('Mecha tres', ['accion'], { popularity: 0.3 }),
  candidato('Romance', ['romance'], { popularity: 0.9 }),
  candidato('Drama', ['drama'], { popularity: 0.1 }),
]

describe('la fachada', () => {
  test('devuelve el límite pedido y nunca más', () => {
    const salida = recommend(señales(), CORPUS, { limit: 2, now: AHORA })

    expect(salida.items).toHaveLength(2)
  })

  test('cada recomendación lleva su puntuación, sus componentes y su razón', () => {
    const salida = recommend(señales(), CORPUS, { now: AHORA })
    const primera = salida.items[0]

    expect(primera?.score).toBeGreaterThan(0)
    expect(primera?.components.affinity).toBeGreaterThan(0)
    expect(primera?.reason.text.length).toBeGreaterThan(0)
    expect(primera?.reasons.length).toBeGreaterThan(0)
  })

  test('`components` expone las señales por separado', () => {
    const salida = recommend(señales(), CORPUS, { now: AHORA })
    const componentes = salida.items[0]?.components

    expect(Object.keys(componentes ?? {}).sort()).toEqual([
      'affinity',
      'covisit',
      'diversity',
      'popularity',
      'recency',
      'search',
    ])
  })

  test('lo que encaja con el historial va por delante de lo que no', () => {
    const salida = recommend(señales(), CORPUS, { now: AHORA, limit: 5 })
    const titulos = salida.items.map((entrada) => entrada.candidate.title)

    expect(titulos.indexOf('Romance')).toBeGreaterThan(titulos.indexOf('Mecha uno'))
  })

  test('sin historial, `cold-start` por popularidad', () => {
    const salida = recommend({ events: [], coVisits: [], searches: [], watchState: [] }, CORPUS, {
      now: AHORA,
      limit: 5,
    })

    expect(salida.coldStart).toBe(true)
    expect(salida.items[0]?.candidate.title).toBe('Romance')
    expect(salida.items[0]?.reason.kind).toBe('trending')
  })

  test('con historial, `coldStart` es falso', () => {
    expect(recommend(señales(), CORPUS, { now: AHORA }).coldStart).toBe(false)
  })

  test('un título ya terminado no aparece', () => {
    const salida = recommend(
      señales({
        watchState: [{ ref: 'fixture#Mecha uno', ratio: 1, at: new Date(AHORA.getTime() - DIA) }],
      }),
      CORPUS,
      { now: AHORA, limit: 5 },
    )

    expect(salida.items.some((entrada) => entrada.candidate.title === 'Mecha uno')).toBe(false)
  })

  test('un título abandonado hace mucho vuelve con su razón de reencuentro', () => {
    const salida = recommend(
      señales({
        watchState: [
          { ref: 'fixture#Mecha dos', ratio: 0.1, at: new Date(AHORA.getTime() - 90 * DIA) },
        ],
      }),
      CORPUS,
      { now: AHORA, limit: 5 },
    )

    const reencuentro = salida.items.find((entrada) => entrada.candidate.title === 'Mecha dos')

    expect(reencuentro).toBeDefined()
    expect(reencuentro?.reasons.some((razon) => razon.kind === 'rediscovery')).toBe(true)
  })
})

describe('determinismo', () => {
  test('la misma entrada da exactamente la misma salida', () => {
    const primera = recommend(señales(), CORPUS, { now: AHORA, seed: 7 })
    const segunda = recommend(señales(), CORPUS, { now: AHORA, seed: 7 })

    expect(segunda.items.map((entrada) => entrada.candidate.title)).toEqual(
      primera.items.map((entrada) => entrada.candidate.title),
    )
    expect(segunda.items.map((entrada) => entrada.score)).toEqual(
      primera.items.map((entrada) => entrada.score),
    )
  })

  test('el orden de los candidatos de entrada no cambia la salida', () => {
    const alReves = [...CORPUS].reverse()
    const primera = recommend(señales(), CORPUS, { now: AHORA, seed: 3 })
    const segunda = recommend(señales(), alReves, { now: AHORA, seed: 3 })

    expect(segunda.items.map((entrada) => entrada.candidate.title)).toEqual(
      primera.items.map((entrada) => entrada.candidate.title),
    )
  })

  test('dos candidatos idénticos en todo se desempatan de forma estable', () => {
    const gemelos = [
      candidato('A', ['x'], { popularity: 0.5 }),
      candidato('B', ['x'], { popularity: 0.5 }),
    ]

    const primera = recommend(señales(), gemelos, { now: AHORA, seed: 1 })
    const segunda = recommend(señales(), gemelos, { now: AHORA, seed: 1 })

    expect(primera.items.map((entrada) => entrada.candidate.title)).toEqual(
      segunda.items.map((entrada) => entrada.candidate.title),
    )
    // Y con otra semilla puede cambiar el orden: el desempate depende de ella. Se
    // buscan las semillas en vez de fijarlas a mano, porque lo que se comprueba
    // es que existen, no cuáles son.
    const ordenCon = (seed: number): string =>
      recommend(señales(), gemelos, { now: AHORA, seed })
        .items.map((entrada) => entrada.candidate.title)
        .join('')

    const ordenes = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((seed) => ordenCon(seed)))

    expect(tieBreak(gemelos[0] as Candidate, 1)).not.toBe(tieBreak(gemelos[1] as Candidate, 1))
    expect(ordenes.size).toBeGreaterThan(1)
  })

  test('sin candidatos no hay nada y no revienta', () => {
    const salida = recommend(señales(), [], { now: AHORA })

    expect(salida.items).toEqual([])
    expect(salida.coldStart).toBe(false)
  })
})

describe('diversidad', () => {
  test('dos títulos del mismo tag no copan el top 3', () => {
    // Con relevancias muy distintas, la diversidad no puede imponerse —y no
    // debe—: si el historial pide `accion`, cinco de `accion` son la respuesta
    // correcta. La prueba usa puntuaciones iguales, que es donde MMR decide.
    // Los de `accion` puntúan algo más: con relevancia pura, los tres primeros
    // serían de `accion`. Es lo que hace que la prueba mida la diversidad y no el
    // azar del desempate.
    const iguales = [
      candidato('accion-1', ['accion'], { popularity: 0.5 }),
      candidato('accion-2', ['accion'], { popularity: 0.5 }),
      candidato('accion-3', ['accion'], { popularity: 0.5 }),
      candidato('romance', ['romance'], { popularity: 0.4 }),
      candidato('drama', ['drama'], { popularity: 0.3 }),
    ]

    const salida = recommend({ events: [], coVisits: [], searches: [], watchState: [] }, iguales, {
      now: AHORA,
      limit: 3,
    })
    const tags = salida.items.map((entrada) => entrada.candidate.tags[0])

    expect(tags.filter((tag) => tag === 'accion').length).toBeLessThan(3)
    expect(new Set(tags).size).toBeGreaterThan(1)
  })

  test('con lambda 1 el orden es el de la puntuación', () => {
    const conDiversidad = recommend(señales(), CORPUS, { now: AHORA, limit: 3, mmrLambda: 1 })
    const sinDiversidad = recommend(señales(), CORPUS, { now: AHORA, limit: 3, mmrLambda: 0 })

    expect(conDiversidad.items[0]?.score).toBeGreaterThanOrEqual(sinDiversidad.items[0]?.score ?? 0)
  })

  test('`diversity` refleja cuánto movió MMR al candidato', () => {
    const salida = recommend(señales(), CORPUS, { now: AHORA, limit: 5 })

    // El primero nunca se mueve; los demás pueden subir o bajar.
    expect(salida.items[0]?.components.diversity).toBe(0)
  })
})

describe('pesos de las señales', () => {
  test('los pesos son los declarados', () => {
    expect(SIGNAL_WEIGHTS).toEqual({
      affinity: 1,
      covisit: 0.5,
      search: 0.8,
      rediscovery: 0.2,
      popularity: 0.3,
    })
  })

  test('un peso a cero apaga esa señal', () => {
    const conPopularidad = recommend(señales(), CORPUS, { now: AHORA })
    const sinPopularidad = recommend(señales(), CORPUS, {
      now: AHORA,
      weights: { popularity: 0 },
    })

    const conCero = sinPopularidad.items.find((entrada) => entrada.candidate.title === 'Mecha uno')
    const conPeso = conPopularidad.items.find((entrada) => entrada.candidate.title === 'Mecha uno')

    expect(conCero?.components.popularity).toBeGreaterThan(0)
    expect(conCero?.score).toBeLessThan(conPeso?.score ?? 0)
  })

  test('la búsqueda reciente sube a quien encaja', () => {
    const salida = recommend(señales({ searches: [{ query: 'romance', at: AHORA }] }), CORPUS, {
      now: AHORA,
      limit: 5,
    })
    const romance = salida.items.find((entrada) => entrada.candidate.title === 'Romance')

    expect(romance?.components.search).toBeGreaterThan(0)
    expect(romance?.reasons.some((razon) => razon.kind === 'matches-search')).toBe(true)
  })

  test('la co-visita sube a lo que se vio junto', () => {
    const salida = recommend(
      señales({
        lastSeen: 'fixture#Mecha uno',
        coVisits: [
          { candidate: 'fixture#Romance', seen: 'fixture#Mecha uno', count: 5, weight: 1 },
        ],
      }),
      CORPUS,
      { now: AHORA, limit: 5 },
    )
    const romance = salida.items.find((entrada) => entrada.candidate.title === 'Romance')

    expect(romance?.components.covisit).toBe(1)
    expect(romance?.reasons.some((razon) => razon.kind === 'covisit')).toBe(true)
  })
})

describe('presupuesto de tiempo', () => {
  test('diez veces más candidatos no cuestan cien veces más tiempo', () => {
    // Lo que se mide es la **forma** del coste, no lo que tarda esta máquina.
    // Un umbral absoluto en milisegundos mide el runner: el 12 de octubre de
    // 2026 esta misma prueba tardó 153 ms en el runner de GitHub y 13 ms aquí, y
    // se puso roja sin que nada del motor hubiera cambiado. Una implementación
    // cuadrática tarda unas cien veces más con diez veces más datos; una lineal,
    // unas diez. El listón se pone en cuarenta, que separa las dos sin depender
    // de la velocidad del hierro.
    const eventos = Array.from({ length: 500 }, (_valor, indice) => ({
      tags: [`tag-${indice % 20}`],
      studios: [`estudio-${indice % 10}`],
      at: new Date(AHORA.getTime() - (indice % 60) * DIA),
      completion: 1,
    }))

    const candidatos = (cuantos: number) =>
      Array.from({ length: cuantos }, (_valor, indice) =>
        candidato(`t${indice}`, [`tag-${indice % 20}`, `otro-${indice % 7}`], {
          popularity: (indice % 100) / 100,
        }),
      )

    const medir = (cuantos: number): number => {
      const corpus = candidatos(cuantos)
      let mejor = Number.POSITIVE_INFINITY

      // Tres vueltas y el mínimo: el mínimo es lo que menos se deja contaminar
      // por el resto de la máquina, que en un runner es mucho decir.
      for (let vuelta = 0; vuelta < 3; vuelta++) {
        const inicio = performance.now()
        const salida = recommend(
          { events: eventos, coVisits: [], searches: [], watchState: [] },
          corpus,
          { now: AHORA, limit: 20 },
        )
        mejor = Math.min(mejor, performance.now() - inicio)

        expect(salida.items).toHaveLength(20)
      }

      return mejor
    }

    const pequeno = medir(500)
    const grande = medir(5000)

    expect(grande / pequeno).toBeLessThan(40)
  })
})

describe('el motor no toca la red ni la base', () => {
  test('el paquete no toca la base de datos ni la red', async () => {
    const glob = new Bun.Glob('**/*.ts')
    const fuentes: string[] = []
    // `fileURLToPath` y no `URL.pathname`: en Windows `pathname` devuelve
    // `/C:/…`, que no es una ruta que exista. Y las rutas se unen con `join`
    // porque el glob devuelve el separador de la plataforma.
    const raiz = fileURLToPath(new URL('.', import.meta.url))

    for await (const relativo of glob.scan({ cwd: raiz })) {
      if (relativo.includes('.test.')) continue
      fuentes.push(await Bun.file(join(raiz, relativo)).text())
    }

    const codigo = fuentes
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

    // El nombre del módulo se arma aquí para que este archivo no lo contenga:
    // hay una prueba de propiedad que recorre los paquetes buscando ese texto y
    // lo encontraría en la propia comprobación.
    const moduloDeSqlite = ['bun', 'sqlite'].join(':')

    expect(codigo).not.toContain(moduloDeSqlite)
    expect(codigo).not.toContain('fetch(')
    expect(codigo).not.toContain('Math.random')
  })
})
