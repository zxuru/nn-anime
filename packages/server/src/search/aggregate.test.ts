import { describe, expect, test } from 'bun:test'
import { createRegistry, type Provider } from '@nn-anime/provider-sdk'
import { createFixtureProvider, fixtureProvider } from '@nn-anime/providers-fixture'
import {
  mergeEvents,
  normalizeQuery,
  SEARCH_TIMEOUT_MS,
  type SearchEvent,
  searchAll,
} from './aggregate'

const REF = { providerId: 'prueba', value: 'uno' }

/** Un proveedor ya registrado a partir de una forma cruda. */
function providerFrom(raw: Record<string, unknown>): Provider {
  const registry = createRegistry([
    {
      id: 'prueba',
      name: 'Prueba',
      apiVersion: '1',
      capabilities: { search: true, sub: true, dub: false, trending: false },
      search: async () => [],
      getAnime: async () => ({ ref: REF, title: 'Uno', genres: [], studios: [] }),
      getEpisodes: async () => [],
      resolveStream: async () => [],
      ...raw,
    },
  ])

  const registered = registry.get(String(raw.id ?? 'prueba'))
  if (registered === undefined) throw new Error('el proveedor de prueba no se registró')

  return registered
}

function resultado(providerId: string, title: string) {
  return { ref: { providerId, value: title }, title }
}

async function events(
  providers: readonly Provider[],
  query = 'aurora',
  options: Parameters<typeof searchAll>[2] = {},
): Promise<readonly SearchEvent[]> {
  const collected: SearchEvent[] = []
  for await (const event of searchAll(providers, query, options)) collected.push(event)

  return collected
}

describe('normalizeQuery', () => {
  test('quita espacios, baja a minúsculas y compone en NFC', () => {
    expect(normalizeQuery('  Aurora Nocturna  ')).toBe('aurora nocturna')
    expect(normalizeQuery('AURORA')).toBe('aurora')
    // La misma palabra escrita de las dos formas posibles en Unicode.
    expect(normalizeQuery('e\u0301xito')).toBe(normalizeQuery('éxito'))
  })

  test('la consulta llega normalizada al proveedor', async () => {
    const vistas: string[] = []
    const proveedor = providerFrom({
      id: 'espia',
      search: async (query: string) => {
        vistas.push(query)
        return []
      },
    })

    await events([proveedor], '  Aurora  ')

    expect(vistas).toEqual(['aurora'])
  })
})

describe('búsqueda agregada', () => {
  test('emite los resultados por proveedor y cierra con el evento final', async () => {
    const uno = providerFrom({ id: 'uno', search: async () => [resultado('uno', 'A')] })
    const dos = providerFrom({ id: 'dos', search: async () => [resultado('dos', 'B')] })

    const lista = await events([uno, dos])
    const cierre = lista.at(-1)

    expect(lista.filter((event) => event.type === 'results')).toHaveLength(2)
    expect(cierre).toEqual({ type: 'done', providers: 2 })
  })

  test('emite en cuanto llega cada uno, no al final', async () => {
    const rapido = providerFrom({
      id: 'rapido',
      search: async () => [resultado('rapido', 'Rápido')],
    })
    const lento = providerFrom({
      id: 'lento',
      search: async () => {
        await Bun.sleep(40)
        return [resultado('lento', 'Lento')]
      },
    })

    const orden: string[] = []
    for await (const event of searchAll([lento, rapido], 'aurora', { timeoutMs: 500 })) {
      if (event.type === 'results') orden.push(event.providerId)
    }

    expect(orden).toEqual(['rapido', 'lento'])
  })

  test('sin proveedores cierra igual, sin quedarse esperando', async () => {
    expect(await events([])).toEqual([{ type: 'done', providers: 0 }])
  })

  test('un proveedor que no tiene la capacidad de buscar da error, no excepción', async () => {
    const sinBusqueda = providerFrom({
      id: 'sin-busqueda',
      capabilities: { search: false, sub: true, dub: false, trending: false },
    })

    const lista = await events([sinBusqueda])

    expect(lista[0]?.type).toBe('error')
    if (lista[0]?.type === 'error') {
      expect(lista[0].providerId).toBe('sin-busqueda')
      expect(lista[0].kind).toBe('unsupported')
    }
    expect(lista.at(-1)).toEqual({ type: 'done', providers: 1 })
  })

  test('un proveedor que lanza produce un evento de error con su id', async () => {
    const roto = providerFrom({
      id: 'roto',
      search: async () => {
        throw new Error('el sitio cambió')
      },
    })

    const lista = await events([roto])
    const error = lista[0]

    expect(error?.type).toBe('error')
    if (error?.type === 'error') {
      expect(error.providerId).toBe('roto')
      expect(error.message).toContain('el sitio cambió')
      expect(error.kind).toBe('threw')
    }
  })

  test('un proveedor que lanza no impide ver los resultados de los demás', async () => {
    const bueno = providerFrom({ id: 'bueno', search: async () => [resultado('bueno', 'B')] })
    const roto = providerFrom({
      id: 'roto',
      search: async () => {
        throw new Error('se cayó')
      },
    })

    const lista = await events([roto, bueno])

    expect(lista.some((event) => event.type === 'results')).toBe(true)
    expect(lista.some((event) => event.type === 'error')).toBe(true)
    expect(lista.at(-1)?.type).toBe('done')
  })

  test('una respuesta con la forma equivocada es un error, no un resultado a medias', async () => {
    const mentiroso = providerFrom({ id: 'mentiroso', search: async () => [{ ref: REF }] })

    const lista = await events([mentiroso])
    const error = lista[0]

    expect(error?.type).toBe('error')
    if (error?.type === 'error') expect(error.kind).toBe('invalid-shape')
  })
})

describe('tiempo límite por proveedor', () => {
  test('un proveedor que nunca responde se aborta y el flujo cierra igual', async () => {
    const colgado = createFixtureProvider({ failures: { search: 'timeout' } })
    const bueno = providerFrom({ id: 'bueno', search: async () => [resultado('bueno', 'B')] })

    const inicio = Date.now()
    const lista = await events([colgado, bueno], 'aurora', { timeoutMs: 40 })
    const transcurrido = Date.now() - inicio

    const error = lista.find((event) => event.type === 'error')
    expect(error?.type).toBe('error')
    if (error?.type === 'error') {
      expect(error.providerId).toBe('fixture')
      expect(error.kind).toBe('timeout')
    }
    expect(lista.at(-1)).toEqual({ type: 'done', providers: 2 })
    expect(transcurrido).toBeLessThan(1000)
  })

  test('cada proveedor tiene su propio plazo: el lento no alarga al rápido', async () => {
    const rapido = providerFrom({ id: 'rapido', search: async () => [resultado('rapido', 'R')] })
    const lento = providerFrom({
      id: 'lento',
      search: async () => {
        await Bun.sleep(200)
        return [resultado('lento', 'L')]
      },
    })

    const inicio = Date.now()
    const lista = await events([lento, rapido], 'aurora', { timeoutMs: 50 })
    const transcurrido = Date.now() - inicio

    // El rápido responde; el lento se aborta por su cuenta.
    expect(lista.some((event) => event.type === 'results' && event.providerId === 'rapido')).toBe(
      true,
    )
    const error = lista.find((event) => event.type === 'error')
    expect(error?.type === 'error' && error.providerId).toBe('lento')

    // Y lo que de verdad se prueba aquí: el proveedor lento **ignora la señal**
    // —duerme 200 ms sin mirarla— y la búsqueda cierra igual a los 50 ms. El
    // plazo lo garantiza este módulo, no la buena voluntad del plugin.
    expect(transcurrido).toBeLessThan(150)
    expect(lista.at(-1)).toEqual({ type: 'done', providers: 2 })
  })

  test('el plazo por defecto es el del spec', () => {
    expect(SEARCH_TIMEOUT_MS).toBe(8000)
  })
})

describe('con el proveedor de prueba', () => {
  test('encuentra los títulos del catálogo', async () => {
    const lista = await events([fixtureProvider], 'aurora')
    const resultados = lista.find((event) => event.type === 'results')

    expect(resultados?.type).toBe('results')
    if (resultados?.type === 'results') expect(resultados.results[0]?.title).toBe('Aurora Nocturna')
  })

  test('varios proveedores de prueba a la vez, cada uno con su id', async () => {
    const uno = createFixtureProvider({ id: 'fixture-a' })
    const dos = createFixtureProvider({ id: 'fixture-b' })

    const lista = await events([uno, dos], 'aurora')
    const ids = lista
      .filter((event) => event.type === 'results')
      .map((event) => (event.type === 'results' ? event.providerId : ''))

    expect([...ids].sort()).toEqual(['fixture-a', 'fixture-b'])
  })
})

/**
 * El evento extra —el de la búsqueda cruzada— mezclado con los proveedores.
 *
 * La regla que se mide es la de siempre, ahora con una fuente más: ninguna espera
 * a la otra. El extra sale cuando llega aunque los proveedores sigan trabajando, y
 * los proveedores salen aunque el extra no haya llegado; el flujo cierra cuando
 * cierran los dos.
 */
describe('mezcla de fuentes', () => {
  const CRUZADA: SearchEvent = {
    type: 'anilist',
    items: [
      {
        anilistId: 101922,
        title: 'Kimetsu no Yaiba',
        cover: '/api/anilist/image/cover/101922',
        adult: false,
      },
    ],
  }

  async function mezclados(
    fuente: AsyncGenerator<SearchEvent>,
    extra: Promise<SearchEvent | undefined>,
  ): Promise<readonly SearchEvent[]> {
    const collected: SearchEvent[] = []
    for await (const event of mergeEvents(fuente, extra, (evento) => evento.type === 'done')) {
      collected.push(event)
    }

    return collected
  }

  test('el extra sale en cuanto llega, sin esperar a los proveedores', async () => {
    // El proveedor tarda 60 ms y el extra está listo ya: si la mezcla esperara a
    // la fuente, el evento de AniList saldría el último.
    const lento = providerFrom({
      id: 'lento',
      search: async () => {
        await Bun.sleep(60)
        return [resultado('lento', 'L')]
      },
    })
    const lista = await mezclados(searchAll([lento], 'aurora'), Promise.resolve(CRUZADA))

    expect(lista[0]).toEqual(CRUZADA)
    expect(lista.at(-1)).toEqual({ type: 'done', providers: 1 })
  })

  test('un extra que no llega a nada no emite evento, pero no corta la fuente', async () => {
    const lista = await mezclados(
      searchAll([fixtureProvider], 'aurora'),
      Promise.resolve(undefined),
    )

    expect(lista.some((event) => event.type === 'results')).toBe(true)
    expect(lista.at(-1)).toEqual({ type: 'done', providers: 1 })
  })

  test('el cierre espera al extra: no se da la búsqueda por terminada antes', async () => {
    // El caso que importa: los proveedores ya cerraron y el extra está en camino.
    // Dar el `done` antes dejaría la pantalla diciendo «nada coincide» mientras la
    // lista de AniList todavía no ha llegado.
    let resolver: ((evento: SearchEvent | undefined) => void) | undefined
    const extra = new Promise<SearchEvent | undefined>((resolve) => {
      resolver = resolve
    })
    const lista: SearchEvent[] = []

    const recorrido = (async () => {
      for await (const event of mergeEvents(
        searchAll([fixtureProvider], 'aurora'),
        extra,
        (evento) => evento.type === 'done',
      )) {
        lista.push(event)
      }
    })()

    // Se le da tiempo al proveedor a responder y a su `done` a llegar al bucle.
    await Bun.sleep(30)
    expect(lista.some((event) => event.type === 'done')).toBe(false)

    resolver?.(CRUZADA)
    await recorrido

    expect(lista.at(-2)).toEqual(CRUZADA)
    expect(lista.at(-1)?.type).toBe('done')
  })
})
