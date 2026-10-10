import { describe, expect, test } from 'bun:test'
import { createRevalidator } from '@nn-anime/catalog-store'
import type { CacheHit } from '@nn-anime/core'
import { type CacheSource, readThrough, summarizeSources } from './cache-read'

interface Estado {
  stored: number | null
  fetchedAt: number
  ttlS: number
  lecturas: number
  escrituras: number
  peticiones: number
}

function estado(overrides: Partial<Estado> = {}): Estado {
  return {
    stored: null,
    fetchedAt: 0,
    ttlS: 900,
    lecturas: 0,
    escrituras: 0,
    peticiones: 0,
    ...overrides,
  }
}

function opciones(
  state: Estado,
  options: {
    now?: () => number
    value?: number
    falla?: boolean
    revalidator?: ReturnType<typeof createRevalidator>
    onError?: (key: string, message: string) => void
    onSuccess?: (key: string) => void
  } = {},
) {
  const revalidator = options.revalidator ?? createRevalidator({ concurrency: 1 })
  const leer = (): Promise<CacheHit<number> | null> => {
    state.lecturas += 1
    if (state.stored === null) return Promise.resolve(null)

    return Promise.resolve({
      value: state.stored,
      fetchedAt: new Date(state.fetchedAt),
      stale: (options.now?.() ?? Date.now()) >= state.fetchedAt + state.ttlS * 1000,
      ttlS: state.ttlS,
    })
  }

  return {
    revalidator,
    options: {
      key: 'clave',
      resource: 'search' as const,
      revalidator,
      read: leer,
      fetch: async (): Promise<number> => {
        state.peticiones += 1
        if (options.falla === true) throw new Error('el proveedor no responde')

        return options.value ?? 42
      },
      write: async (value: number): Promise<void> => {
        state.escrituras += 1
        state.stored = value
        state.fetchedAt = options.now?.() ?? Date.now()
      },
      ...(options.onError === undefined ? {} : { onError: options.onError }),
      ...(options.onSuccess === undefined ? {} : { onSuccess: options.onSuccess }),
    },
  }
}

describe('lectura con caché', () => {
  test('sin fila: MISS, pide al proveedor y escribe', async () => {
    const state = estado()
    const { options, revalidator } = opciones(state)

    const salida = await readThrough(options)

    expect(salida.source).toBe('miss')
    expect(salida.value).toBe(42)
    expect(state.peticiones).toBe(1)
    expect(state.escrituras).toBe(1)
    await revalidator.close()
  })

  test('dentro del TTL: HIT y no se llama al proveedor', async () => {
    const state = estado()
    const ahora = 1_000_000
    const { options, revalidator } = opciones(state, { now: () => ahora })
    await readThrough(options)

    const segunda = await readThrough(options)

    expect(segunda.source).toBe('hit')
    expect(segunda.value).toBe(42)
    expect(state.peticiones).toBe(1)
    await revalidator.close()
  })

  test('fuera del TTL: STALE, se sirve ya y se refresca por detrás', async () => {
    const state = estado()
    let ahora = 1_000_000
    const { options, revalidator } = opciones(state, { now: () => ahora, value: 42 })
    await readThrough(options)

    // Pasa el TTL y el proveedor empieza a devolver otra cosa.
    ahora += 901 * 1000
    const segundaVuelta = opciones(state, { now: () => ahora, value: 99, revalidator })
    const salida = await readThrough(segundaVuelta.options)

    expect(salida.source).toBe('stale')
    expect(salida.value).toBe(42)

    // El refresco ocurre por detrás: la respuesta no esperó a que terminara.
    while (revalidator.running() > 0 || revalidator.queued().length > 0) await Bun.sleep(1)

    expect(state.peticiones).toBe(2)
    expect(state.stored).toBe(99)
    await revalidator.close()
  })

  test('dos lecturas vencidas de la misma clave encolan un solo refresco', async () => {
    const state = estado()
    const ahora = 1_000_000
    const revalidator = createRevalidator({ concurrency: 1 })
    const { options } = opciones(state, { now: () => ahora })
    await readThrough({ ...options, revalidator })

    const vencidas = opciones(state, { now: () => ahora + 901 * 1000, value: 7, revalidator })
    await readThrough(vencidas.options)
    await readThrough(vencidas.options)

    while (revalidator.running() > 0 || revalidator.queued().length > 0) await Bun.sleep(1)

    expect(state.peticiones).toBe(2)
    expect(state.stored).toBe(7)
    await revalidator.close()
  })

  test('un refresco que falla no borra el dato viejo y se anota', async () => {
    const state = estado()
    const ahora = 1_000_000
    const anotados: string[] = []
    const revalidator = createRevalidator({ concurrency: 1 })
    const { options } = opciones(state, { now: () => ahora })
    await readThrough({ ...options, revalidator })

    const vencidas = opciones(state, {
      now: () => ahora + 901 * 1000,
      falla: true,
      revalidator,
      onError: (clave, message) => {
        anotados.push(`${clave}:${message}`)
      },
    })
    const salida = await readThrough(vencidas.options)

    while (revalidator.running() > 0 || revalidator.queued().length > 0) await Bun.sleep(1)

    expect(salida.source).toBe('stale')
    expect(state.stored).toBe(42)
    expect(anotados).toEqual(['clave:el proveedor no responde'])
    await revalidator.close()
  })

  test('cuando el refresco funciona, se avisa para poder limpiar el error', async () => {
    const state = estado()
    const ahora = 1_000_000
    const limpiados: string[] = []
    const revalidator = createRevalidator({ concurrency: 1 })
    const { options } = opciones(state, { now: () => ahora })
    await readThrough({ ...options, revalidator })

    const vencidas = opciones(state, {
      now: () => ahora + 901 * 1000,
      value: 5,
      revalidator,
      onSuccess: (clave) => {
        limpiados.push(clave)
      },
    })
    await readThrough(vencidas.options)

    while (revalidator.running() > 0 || revalidator.queued().length > 0) await Bun.sleep(1)

    expect(limpiados).toEqual(['clave'])
    expect(state.stored).toBe(5)
    await revalidator.close()
  })

  test('un fallo al pedir en un MISS sí se propaga: no hay nada que servir', async () => {
    const state = estado()
    const { options, revalidator } = opciones(state, { falla: true })

    await expect(readThrough(options)).rejects.toThrow('el proveedor no responde')
    await revalidator.close()
  })
})

describe('resumen de orígenes', () => {
  test('el peor de todos manda', () => {
    const casos: readonly [readonly CacheSource[], CacheSource][] = [
      [['hit', 'hit'], 'hit'],
      [['hit', 'stale'], 'stale'],
      [['hit', 'stale', 'miss'], 'miss'],
      [['miss'], 'miss'],
    ]

    for (const [entrada, esperado] of casos) {
      expect(summarizeSources(entrada), entrada.join(',')).toBe(esperado)
    }
  })

  test('sin orígenes, se considera todo servido de caché', () => {
    expect(summarizeSources([])).toBe('hit')
  })
})

describe('la caché no se inventa datos', () => {
  test('lo que se escribe es lo que se sirve después', async () => {
    const state = estado()
    const ahora = 1_000_000
    const { options, revalidator } = opciones(state, { now: () => ahora, value: 123 })

    expect((await readThrough(options)).value).toBe(123)
    expect((await readThrough(options)).value).toBe(123)
    expect(state.escrituras).toBe(1)
    await revalidator.close()
  })
})
