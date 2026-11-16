/**
 * El servicio de saltos, con store y cliente falsos.
 *
 * Lo que se mide es la política, que es lo que no se ve en una prueba de ruta y
 * lo que de verdad importa: una sola consulta por episodio, los tres TTL según
 * haya datos, «no hay» o fallo, y que ninguna combinación de fallos lance ni
 * devuelva otra cosa que una lista vacía.
 */

import { describe, expect, test } from 'bun:test'
import { AppError, type CacheHit, type SkipInterval } from '@rona/core'
import type { AniSkipClient, AniSkipOutcome, AniSkipQuery } from './client'
import { createSkipTimesService, skipTimesCacheKey } from './service'

const TTL = {
  acierto: 2_592_000,
  sinDatos: 21_600,
  error: 900,
} as const

const INTERVALOS: readonly SkipInterval[] = [
  { type: 'op', start: 128.406, end: 218.406 },
  { type: 'ed', start: 1300.5, end: 1386.2 },
]

interface Escritura {
  readonly key: string
  readonly intervals: readonly SkipInterval[]
  readonly ttlS: number
}

interface DobleStore {
  readonly store: {
    readMalId(anilistId: number): Promise<number | undefined>
    readSkipTimes(key: string): Promise<CacheHit<readonly SkipInterval[]> | null>
    writeSkipTimes(key: string, intervals: readonly SkipInterval[], ttlS: number): Promise<void>
  }
  readonly escrituras: Escritura[]
  readonly lecturas: readonly string[]
}

function storeFalso(
  opciones: {
    readonly malId?: number | undefined
    readonly cache?: CacheHit<readonly SkipInterval[]> | null
    readonly readMalIdLanza?: boolean
    readonly readCacheLanza?: boolean
    readonly writeLanza?: boolean
  } = {},
): DobleStore {
  const escrituras: Escritura[] = []
  const lecturas: string[] = []

  return {
    store: {
      async readMalId() {
        if (opciones.readMalIdLanza === true) throw new Error('store caído')

        return opciones.malId
      },
      async readSkipTimes(key) {
        if (opciones.readCacheLanza === true) throw new Error('store caído')
        lecturas.push(key)

        return opciones.cache ?? null
      },
      async writeSkipTimes(key, intervals, ttlS) {
        if (opciones.writeLanza === true) throw new Error('store caído')
        escrituras.push({ key, intervals, ttlS })
      },
    },
    escrituras,
    lecturas,
  }
}

function cacheDe(
  value: readonly SkipInterval[],
  stale = false,
  ttlS = TTL.acierto,
): CacheHit<readonly SkipInterval[]> {
  return { value, fetchedAt: new Date(1_700_000_000_000), stale, ttlS }
}

interface DobleCliente {
  readonly client: AniSkipClient
  readonly consultas: readonly AniSkipQuery[]
}

function clienteFalso(outcome: AniSkipOutcome | (() => Promise<AniSkipOutcome>)): DobleCliente {
  const consultas: AniSkipQuery[] = []

  return {
    consultas,
    client: {
      async fetch(query) {
        consultas.push(query)

        return typeof outcome === 'function' ? await outcome() : outcome
      },
      calls() {
        return consultas.length
      },
    },
  }
}

const ENCONTRADO: AniSkipOutcome = {
  ok: true,
  payload: {
    found: true,
    results: [
      { interval: { startTime: 128.406, endTime: 218.406 }, skipType: 'op' },
      { interval: { startTime: 1300.5, endTime: 1386.2 }, skipType: 'ed' },
    ],
  },
}

describe('el acierto de caché', () => {
  test('un dato fresco se sirve sin llamar a AniSkip', async () => {
    const { store, lecturas } = storeFalso({ malId: 16498, cache: cacheDe(INTERVALOS) })
    const { client, consultas } = clienteFalso(ENCONTRADO)
    const servicio = createSkipTimesService({ store, client })

    const intervals = await servicio.skipTimes({ anilistId: 555, episode: 1, length: 1440 })

    expect(intervals).toEqual(INTERVALOS)
    expect(consultas).toEqual([])
    expect(lecturas).toEqual([skipTimesCacheKey(16498, 1, 1440)])
  })

  test('un acierto vacío también se sirve sin red: «no hay» es un dato', async () => {
    const { store } = storeFalso({ malId: 16498, cache: cacheDe([]) })
    const { client, consultas } = clienteFalso(ENCONTRADO)
    const servicio = createSkipTimesService({ store, client })

    expect(await servicio.skipTimes({ anilistId: 555, episode: 1, length: 1440 })).toEqual([])
    expect(consultas).toEqual([])
  })

  test('un dato vencido se vuelve a pedir', async () => {
    const { store, escrituras } = storeFalso({ malId: 16498, cache: cacheDe(INTERVALOS, true) })
    const { client, consultas } = clienteFalso(ENCONTRADO)
    const servicio = createSkipTimesService({ store, client })

    const intervals = await servicio.skipTimes({ anilistId: 555, episode: 1, length: 1440 })

    expect(consultas).toHaveLength(1)
    expect(intervals).toEqual(INTERVALOS)
    expect(escrituras).toEqual([
      { key: skipTimesCacheKey(16498, 1, 1440), intervals: INTERVALOS, ttlS: TTL.acierto },
    ])
  })
})

describe('la obra sin ficha de MAL', () => {
  test('no se pregunta a nadie y la lista sale vacía', async () => {
    const { store, lecturas, escrituras } = storeFalso({ malId: undefined })
    const { client, consultas } = clienteFalso(ENCONTRADO)
    const servicio = createSkipTimesService({ store, client })

    expect(await servicio.skipTimes({ anilistId: 555, episode: 1, length: 1440 })).toEqual([])
    expect(consultas).toEqual([])
    expect(lecturas).toEqual([])
    expect(escrituras).toEqual([])
  })
})

describe('la consulta a AniSkip', () => {
  test('pide el id de MAL resuelto, el episodio y la duración', async () => {
    const { store } = storeFalso({ malId: 16498 })
    const { client, consultas } = clienteFalso(ENCONTRADO)
    const servicio = createSkipTimesService({ store, client })

    await servicio.skipTimes({ anilistId: 555, episode: 3, length: 1441.94 })

    expect(consultas).toEqual([{ malId: 16498, episode: 3, length: 1441.94 }])
  })

  test('guarda la respuesta bajo la clave del contrato, con la duración redondeada', async () => {
    const { store, escrituras } = storeFalso({ malId: 16498 })
    const { client } = clienteFalso(ENCONTRADO)
    const servicio = createSkipTimesService({ store, client })

    await servicio.skipTimes({ anilistId: 555, episode: 1, length: 1441.94 })

    expect(escrituras).toEqual([{ key: '16498:1:1442', intervals: INTERVALOS, ttlS: TTL.acierto }])
  })
})

describe('la obra sin duración conocida', () => {
  test('no sale a la red ni escribe caché: AniSkip exige episodeLength y elige la entrada con él', async () => {
    const { store, escrituras, lecturas } = storeFalso({ malId: 16498 })
    const { client, consultas } = clienteFalso(ENCONTRADO)
    const servicio = createSkipTimesService({ store, client })

    // Mandar `0` no es «no sé la duración»: AniSkip devuelve con él una entrada
    // de cada tipo, de la duración que sea. Sin duración, la respuesta honesta
    // es la lista vacía; y no se cachea, porque no se preguntó nada.
    expect(await servicio.skipTimes({ anilistId: 555, episode: 1 })).toEqual([])
    expect(consultas).toEqual([])
    expect(escrituras).toEqual([])
    expect(lecturas).toEqual([])
  })

  test('una duración que no es positiva tampoco se consulta', async () => {
    const { store } = storeFalso({ malId: 16498 })
    const { client, consultas } = clienteFalso(ENCONTRADO)
    const servicio = createSkipTimesService({ store, client })

    expect(await servicio.skipTimes({ anilistId: 555, episode: 1, length: 0 })).toEqual([])
    expect(await servicio.skipTimes({ anilistId: 555, episode: 1, length: Number.NaN })).toEqual([])
    expect(consultas).toEqual([])
  })
})

describe('los TTL según lo que se encontró', () => {
  test('found:false se cachea como «sin datos», no como acierto', async () => {
    const { store, escrituras } = storeFalso({ malId: 16498 })
    const { client } = clienteFalso({ ok: true, payload: { found: false, results: [] } })
    const servicio = createSkipTimesService({ store, client })

    expect(await servicio.skipTimes({ anilistId: 555, episode: 1, length: 1440 })).toEqual([])
    expect(escrituras).toEqual([
      { key: skipTimesCacheKey(16498, 1, 1440), intervals: [], ttlS: TTL.sinDatos },
    ])
  })

  test('una respuesta malformada se cachea con el TTL de error', async () => {
    const { store, escrituras } = storeFalso({ malId: 16498 })
    const { client } = clienteFalso({ ok: true, payload: { encontrado: 'sí' } })
    const servicio = createSkipTimesService({ store, client })

    expect(await servicio.skipTimes({ anilistId: 555, episode: 1, length: 1440 })).toEqual([])
    expect(escrituras).toEqual([
      { key: skipTimesCacheKey(16498, 1, 1440), intervals: [], ttlS: TTL.error },
    ])
  })

  test('un fallo del cliente se cachea con el TTL de error', async () => {
    const { store, escrituras } = storeFalso({ malId: 16498 })
    const { client } = clienteFalso({
      ok: false,
      error: new AppError({ code: 'upstream', message: 'sin red' }),
    })
    const servicio = createSkipTimesService({ store, client })

    expect(await servicio.skipTimes({ anilistId: 555, episode: 1, length: 1440 })).toEqual([])
    expect(escrituras).toEqual([
      { key: skipTimesCacheKey(16498, 1, 1440), intervals: [], ttlS: TTL.error },
    ])
  })
})

describe('nunca se rompe', () => {
  test('un cliente que lanza se queda en lista vacía', async () => {
    const { store } = storeFalso({ malId: 16498 })
    const { client } = clienteFalso(async () => {
      throw new Error('explotó')
    })
    const servicio = createSkipTimesService({ store, client })

    expect(await servicio.skipTimes({ anilistId: 555, episode: 1, length: 1440 })).toEqual([])
  })

  test('un store que no lee la caché no impide responder', async () => {
    const { store } = storeFalso({ malId: 16498, readCacheLanza: true })
    const { client } = clienteFalso(ENCONTRADO)
    const servicio = createSkipTimesService({ store, client })

    expect(await servicio.skipTimes({ anilistId: 555, episode: 1, length: 1440 })).toEqual([])
  })

  test('un store que no resuelve el MAL se queda en lista vacía', async () => {
    const { store } = storeFalso({ readMalIdLanza: true })
    const { client, consultas } = clienteFalso(ENCONTRADO)
    const servicio = createSkipTimesService({ store, client })

    expect(await servicio.skipTimes({ anilistId: 555, episode: 1, length: 1440 })).toEqual([])
    expect(consultas).toEqual([])
  })

  test('un store que no escribe no quita los intervalos ya calculados', async () => {
    const { store } = storeFalso({ malId: 16498, writeLanza: true })
    const { client } = clienteFalso(ENCONTRADO)
    const servicio = createSkipTimesService({ store, client })

    expect(await servicio.skipTimes({ anilistId: 555, episode: 1, length: 1440 })).toEqual(
      INTERVALOS,
    )
  })
})

describe('la deduplicación', () => {
  test('dos peticiones simultáneas del mismo episodio gastan una sola consulta', async () => {
    const { store } = storeFalso({ malId: 16498 })

    let liberar: (outcome: AniSkipOutcome) => void = () => undefined
    const pendiente = new Promise<AniSkipOutcome>((resolver) => {
      liberar = resolver
    })
    const { client, consultas } = clienteFalso(async () => await pendiente)
    const servicio = createSkipTimesService({ store, client })

    const primera = servicio.skipTimes({ anilistId: 555, episode: 1, length: 1440 })
    const segunda = servicio.skipTimes({ anilistId: 555, episode: 1, length: 1440 })

    // Las dos han llegado a la consulta, y las dos están en vuelo antes de que
    // el tercero conteste. La espera es para dejar correr los `await` previos.
    await new Promise((resolver) => setTimeout(resolver, 10))
    expect(consultas).toHaveLength(1)

    liberar(ENCONTRADO)

    expect(await primera).toEqual(INTERVALOS)
    expect(await segunda).toEqual(INTERVALOS)
    expect(consultas).toHaveLength(1)
  })

  test('dos episodios distintos no comparten consulta', async () => {
    const { store } = storeFalso({ malId: 16498 })
    const { client, consultas } = clienteFalso(ENCONTRADO)
    const servicio = createSkipTimesService({ store, client })

    await servicio.skipTimes({ anilistId: 555, episode: 1, length: 1440 })
    await servicio.skipTimes({ anilistId: 555, episode: 2, length: 1440 })

    expect(consultas).toHaveLength(2)
  })
})
