import { describe, expect, test } from 'bun:test'
import type { ProviderSummary, SearchEventPayload } from '@nn-anime/core/api'
import type { SearchResult } from '@nn-anime/core/models'
import { ApiError } from '../../api/client'
import {
  activeProviderIds,
  alternativas,
  createPrefetcher,
  createSearchHub,
  fetchProviderPriority,
  groupResults,
  initialState,
  normalizeTitle,
  proveedoresSeleccionados,
  reduce,
} from './useSearchStream'

function resultado(providerId: string, ref: string, title: string, year?: number): SearchResult {
  return { ref: { providerId, value: ref }, title, ...(year === undefined ? {} : { year }) }
}

function resumen(id: string, status: 'active' | 'rejected'): ProviderSummary {
  return {
    id,
    name: id,
    capabilities: { search: true, sub: true, dub: false, trending: false, feed: false },
    status,
    ...(status === 'rejected' ? { reason: 'no cargó' } : {}),
  }
}

function fuente(id: string, media: 'anime' | 'movies' | 'both'): ProviderSummary {
  return {
    id,
    name: id,
    capabilities: { search: true, sub: true, dub: false, trending: false, feed: false, media },
    status: 'active',
  }
}

describe('estado', () => {
  test('al empezar, todos los proveedores están pendientes', () => {
    const estado = initialState(['uno', 'dos'])

    expect(estado.pending).toEqual(['uno', 'dos'])
    expect(estado.results).toEqual([])
    expect(estado.done).toBe(false)
  })

  test('los resultados llegan y su proveedor deja de estar pendiente', () => {
    const estado = reduce(initialState(['uno', 'dos']), {
      type: 'results',
      providerId: 'uno',
      results: [resultado('uno', 'a', 'A')],
    })

    expect(estado.results).toHaveLength(1)
    expect(estado.pending).toEqual(['dos'])
  })

  test('un error quita el esqueleto y se cuenta aparte', () => {
    const estado = reduce(initialState(['uno', 'dos']), {
      type: 'error',
      providerId: 'uno',
      kind: 'threw',
      message: 'se cayó',
    })

    expect(estado.pending).toEqual(['dos'])
    expect(estado.errors).toEqual([{ providerId: 'uno', message: 'se cayó' }])
    expect(estado.results).toEqual([])
  })

  test('el cierre limpia lo que quedara pendiente', () => {
    const estado = reduce(initialState(['uno', 'dos']), { type: 'done', providers: 2 })

    expect(estado.pending).toEqual([])
    expect(estado.done).toBe(true)
  })

  /**
   * El catálogo cacheado emite antes que los proveedores, así que un título
   * cacheado puede volver a llegar después desde su proveedor. Dos tarjetas con
   * la misma clave rompen la rejilla de React y cuentan doble en el anuncio.
   */
  test('la misma referencia no se pinta dos veces, aunque llegue del catálogo y del proveedor', () => {
    const conCatalogo = reduce(initialState(['uno']), {
      type: 'results',
      providerId: 'catalog',
      results: [resultado('uno', 'a', 'A')],
    })
    const conProveedor = reduce(conCatalogo, {
      type: 'results',
      providerId: 'uno',
      results: [resultado('uno', 'a', 'A')],
    })

    expect(conProveedor.results).toHaveLength(1)
    expect(conProveedor.pending).toEqual([])
  })

  test('dos referencias distintas del mismo proveedor se conservan', () => {
    const estado = reduce(initialState(['uno']), {
      type: 'results',
      providerId: 'uno',
      results: [resultado('uno', 'a', 'A'), resultado('uno', 'b', 'B'), resultado('uno', 'a', 'A')],
    })

    expect(estado.results.map((hit) => hit.ref.value)).toEqual(['a', 'b'])
  })
})

describe('agrupación de duplicados', () => {
  test('el mismo título y año en dos proveedores van al mismo grupo', () => {
    const grupos = groupResults([
      resultado('uno', 'a', 'Aurora Nocturna', 2019),
      resultado('dos', 'b', 'aurora nocturna', 2019),
    ])

    expect(grupos).toHaveLength(1)
    expect(grupos[0]?.results.map((item) => item.ref.providerId)).toEqual(['uno', 'dos'])
  })

  test('el mismo título en años distintos no se agrupa', () => {
    const grupos = groupResults([
      resultado('uno', 'a', 'Aurora', 2019),
      resultado('dos', 'b', 'Aurora', 2021),
    ])

    expect(grupos).toHaveLength(2)
  })

  test('sin año, dos proveedores con el mismo título se agrupan igual', () => {
    const grupos = groupResults([resultado('uno', 'a', 'Aurora'), resultado('dos', 'b', 'Aurora')])

    expect(grupos).toHaveLength(1)
    expect(grupos[0]?.results).toHaveLength(2)
  })

  /**
   * El caso de la captura: la misma obra con el nombre corto en una fuente y el
   * título original en la otra, sin año en ninguna de las dos —los proveedores no
   * lo devuelven en los resultados— y con la referencia de cada una apuntando al
   * nombre de la otra.
   */
  test('la misma obra con dos nombres distintos va al mismo grupo', () => {
    const grupos = groupResults([
      resultado('jkanime', 'dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka', 'Danmachi'),
      resultado('animeav1', 'danmachi', 'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka'),
    ])

    expect(grupos).toHaveLength(1)
    expect(grupos[0]?.results.map((item) => item.ref.providerId)).toEqual(['animeav1', 'jkanime'])
  })

  test('la tarjeta se queda con el nombre más largo de la obra', () => {
    // El orden del grupo es el de la tarjeta: el primero da el nombre y el
    // enlace. Mutar `porNombre` deja el nombre corto delante y esta prueba cae.
    const grupos = groupResults([
      resultado('jkanime', 'dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka', 'Danmachi'),
      resultado('animeav1', 'danmachi', 'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka'),
    ])

    expect(grupos[0]?.results[0]?.title).toBe(
      'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka',
    )
  })

  test('el spin-off no se junta con la serie: le sobra un nombre', () => {
    // «Danmachi: Sword Oratoria» comparte saga con «Danmachi», y sin embargo es
    // otra obra. Es el falso positivo que la identidad tiene que dejar fuera.
    const grupos = groupResults([
      resultado('animeav1', 'danmachi', 'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka'),
      resultado(
        'jkanime',
        'dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka-gaiden-sword-oratoria',
        'Danmachi: Sword Oratoria',
      ),
    ])

    expect(grupos).toHaveLength(2)
  })

  test('la película no se junta con la serie del mismo nombre', () => {
    const grupos = groupResults([
      resultado('uno', 'a', 'Kimetsu no Yaiba', 2019),
      resultado('dos', 'b', 'Kimetsu no Yaiba Movie 1: Mugenjou-hen', 2019),
    ])

    expect(grupos).toHaveLength(2)
  })

  test('las referencias no se fusionan: cada resultado conserva su proveedor', () => {
    const resultados = [resultado('uno', 'a', 'Aurora'), resultado('dos', 'b', 'Aurora')]
    const grupos = groupResults(resultados)

    expect(grupos[0]?.results.map((item) => item.ref.providerId)).toEqual(['uno', 'dos'])
    expect(grupos[0]?.results.map((item) => item.ref.value)).toEqual(['a', 'b'])
  })

  test('la normalización agrupa lo que el usuario ve igual', () => {
    expect(normalizeTitle('  Aurora   NOCTURNA ')).toBe('aurora nocturna')
    // La misma palabra escrita de las dos formas posibles en Unicode.
    expect(normalizeTitle('e\u0301xito')).toBe(normalizeTitle('éxito'))

    expect(
      groupResults([resultado('uno', 'a', 'Éxito'), resultado('dos', 'b', 'e\u0301xito')]),
    ).toHaveLength(1)
  })

  test('las alternativas de una obra son los demás proveedores, no ella misma', () => {
    const [grupo] = groupResults([
      resultado('uno', 'a', 'Aurora'),
      resultado('dos', 'b', 'Aurora'),
      resultado('tres', 'c', 'Aurora'),
    ])
    // Sin el grupo no hay nada que comprobar; el `if` evita un `as` que
    // silenciaría el tipo.
    if (grupo === undefined) throw new Error('la agrupación no devolvió ningún grupo')

    expect(alternativas(grupo, 'dos').map((item) => item.ref.providerId)).toEqual(['uno', 'tres'])
  })
})

describe('la preferencia de proveedor', () => {
  /**
   * La misma obra con el nombre corto en una fuente y el título original en la
   * otra —el caso medido en una captura—, con la referencia de cada una apuntando
   * al nombre de la otra. Es lo que hace que las dos entren en el mismo grupo:
   * con títulos distintos sueltos no se agrupan.
   */
  const DANMACHI = [
    resultado('uno', 'dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka', 'Danmachi'),
    resultado('dos', 'danmachi', 'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka'),
  ]

  test('la tarjeta se queda con el proveedor preferido, no con el nombre más largo', () => {
    // Mutar `porPreferencia` para devolver sólo `porNombre` deja esta prueba en
    // rojo: la tarjeta volvería a `dos`, que es el título largo.
    const grupos = groupResults(DANMACHI, ['uno'])

    expect(grupos[0]?.results.map((item) => item.ref.providerId)).toEqual(['uno', 'dos'])
  })

  test('el preferido manda aunque no sea el primero que respondió', () => {
    const grupos = groupResults(
      [resultado('uno', 'a', 'Aurora'), resultado('dos', 'b', 'Aurora')],
      ['dos'],
    )

    expect(grupos[0]?.results[0]?.ref.providerId).toBe('dos')
  })

  test('sin preferencia guardada todo queda como estaba', () => {
    const grupos = groupResults(DANMACHI)

    expect(grupos[0]?.results.map((item) => item.ref.providerId)).toEqual(['dos', 'uno'])
  })

  test('un id que ya no existe no cambia la tarjeta', () => {
    const grupos = groupResults(DANMACHI, ['fantasma'])

    expect(grupos[0]?.results.map((item) => item.ref.providerId)).toEqual(['dos', 'uno'])
  })

  test('entre los no preferidos sigue ganando el nombre más largo', () => {
    const grupos = groupResults(DANMACHI, ['otro'])

    expect(grupos[0]?.results[0]?.ref.providerId).toBe('dos')
  })

  test('equivale a `groupResults` sin prioridad cuando la lista está vacía', () => {
    expect(groupResults(DANMACHI, [])).toEqual(groupResults(DANMACHI))
  })
})

describe('la lectura de la preferencia', () => {
  /** Unos ajustes completos: el schema es estricto y no admite un cuerpo a medias. */
  function ajustes(providerPriority: readonly string[]): Record<string, unknown> {
    return {
      theme: 'system',
      providerPriority,
      paths: { data: '/d', config: '/c', cache: '/k' },
      mpv: { available: false },
      providers: [],
    }
  }

  test('se lee de `/api/settings` y se devuelve tal cual', async () => {
    let pedida = ''
    const orden = await fetchProviderPriority(new AbortController().signal, async (url) => {
      pedida = url

      return Response.json(ajustes(['jkanime', 'animeav1']))
    })

    expect(pedida).toBe('/api/settings')
    expect(orden).toEqual(['jkanime', 'animeav1'])
  })

  test('unos ajustes que no contestan son un fallo, no una lista inventada', async () => {
    await expect(
      fetchProviderPriority(
        new AbortController().signal,
        async () => new Response('no', { status: 500 }),
      ),
    ).rejects.toBeInstanceOf(ApiError)
  })
})

describe('proveedores activos', () => {
  test('sólo los activos entran en la búsqueda', () => {
    expect(activeProviderIds([resumen('uno', 'active'), resumen('roto', 'rejected')])).toEqual([
      'uno',
    ])
  })

  test('el tipo deja fuera a quien no puede tenerlo, y deja entrar a la fuente mixta', () => {
    const fuentes = [
      fuente('anime', 'anime'),
      fuente('pelis', 'movies'),
      fuente('mixta', 'both'),
      resumen('roto', 'rejected'),
    ]

    // Es lo que decide cuántos esqueletos salen y a quién se le pregunta: la mixta
    // entra en las dos mitades porque sus resultados se reparten después.
    expect(proveedoresSeleccionados(fuentes, [], 'anime')).toEqual(['anime', 'mixta'])
    expect(proveedoresSeleccionados(fuentes, [], 'movies')).toEqual(['pelis', 'mixta'])
  })

  test('sin declarar el tipo, la fuente cuenta como anime', () => {
    expect(proveedoresSeleccionados([resumen('uno', 'active')], [], 'anime')).toEqual(['uno'])
    expect(proveedoresSeleccionados([resumen('uno', 'active')], [], 'movies')).toEqual([])
  })

  test('el filtro de la dirección se cruza con el tipo', () => {
    const fuentes = [fuente('anime', 'anime'), fuente('pelis', 'movies'), fuente('mixta', 'both')]

    expect(proveedoresSeleccionados(fuentes, ['pelis', 'mixta'], 'movies')).toEqual([
      'pelis',
      'mixta',
    ])
    // El filtro pide una fuente de anime con la pestaña de películas: no hay
    // intersección, y por eso la búsqueda no se le pregunta a nadie.
    expect(proveedoresSeleccionados(fuentes, ['anime'], 'movies')).toEqual([])
  })
})

describe('distribuidor de búsquedas', () => {
  test('dos suscripciones a la misma ruta abren una sola petición', async () => {
    let abiertas = 0
    const hub = createSearchHub({
      open: () => {
        abiertas += 1
        return (async function* () {
          yield {
            type: 'results',
            providerId: 'uno',
            results: [resultado('uno', 'a', 'A')],
          } as SearchEventPayload
          yield { type: 'done', providers: 1 } as SearchEventPayload
        })()
      },
    })

    const avisos: number[] = []
    const uno = hub.subscribe('/api/search?q=a', ['uno'], () => avisos.push(1))
    const dos = hub.subscribe('/api/search?q=a', ['uno'], () => avisos.push(2))

    await Bun.sleep(10)

    expect(abiertas).toBe(1)
    expect(avisos.length).toBeGreaterThanOrEqual(2)
    expect(hub.read('/api/search?q=a').results).toHaveLength(1)
    expect(hub.read('/api/search?q=a').done).toBe(true)

    uno()
    dos()
  })

  test('rutas distintas abren peticiones distintas', async () => {
    let abiertas = 0
    const hub = createSearchHub({
      open: () => {
        abiertas += 1
        return (async function* () {
          yield { type: 'done', providers: 0 } as SearchEventPayload
        })()
      },
    })

    const uno = hub.subscribe('/api/search?q=a', [], () => {})
    const dos = hub.subscribe('/api/search?q=b', [], () => {})

    await Bun.sleep(5)

    expect(abiertas).toBe(2)

    uno()
    dos()
  })

  test('al irse el último suscriptor se cancela el stream abierto', async () => {
    let cancelado = false
    const hub = createSearchHub({
      open: (_path, signal) => {
        signal.addEventListener('abort', () => {
          cancelado = true
        })
        return (async function* () {
          await Bun.sleep(50)
          yield { type: 'done', providers: 0 } as SearchEventPayload
        })()
      },
    })

    const unsubscribe = hub.subscribe('/api/search?q=a', [], () => {})
    await Bun.sleep(1)
    unsubscribe()

    await Bun.sleep(5)

    expect(cancelado).toBe(true)
  })

  test('si se va antes de arrancar, ni se abre la conexión', async () => {
    let abiertas = 0
    const hub = createSearchHub({
      open: () => {
        abiertas += 1
        return (async function* () {
          yield { type: 'done', providers: 0 } as SearchEventPayload
        })()
      },
    })

    hub.subscribe('/api/search?q=a', [], () => {})()
    await Bun.sleep(5)

    expect(abiertas).toBe(0)
  })

  test('un fallo de transporte se cuenta y cierra, en lugar de dejar esqueletos', async () => {
    const hub = createSearchHub({
      open: () => {
        // Lo que lanza `fetch` sin red, con el mensaje medido en este repositorio.
        throw new TypeError('Unable to connect. Is the computer able to access the url?')
      },
    })

    hub.subscribe('/api/search?q=a', ['uno'], () => {})
    await Bun.sleep(10)
    const estado = hub.read('/api/search?q=a')

    expect(estado.done).toBe(true)
    expect(estado.pending).toEqual([])
    // El fallo viaja clasificado, no como el texto del motor: es lo que permite
    // que el anuncio diga «sin conexión con el servidor» y no el mensaje crudo.
    expect(estado.failed?.clase).toBe('sinConexion')
    expect(estado.failed?.tecnico).toContain('Unable to connect')
  })

  test('cancelar no se reporta como fallo: el usuario cambió de consulta', async () => {
    const hub = createSearchHub({
      open: (_path, signal) => {
        return (async function* () {
          await new Promise<void>((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
          )
          yield { type: 'done', providers: 0 } as SearchEventPayload
        })()
      },
    })

    const unsubscribe = hub.subscribe('/api/search?q=a', ['uno'], () => {})
    unsubscribe()
    await Bun.sleep(5)

    expect(hub.read('/api/search?q=a').failed).toBeUndefined()
  })
})

describe('precarga', () => {
  test('precarga la tarjeta señalada, una sola vez', async () => {
    const pedidas: string[] = []
    const prefetch = createPrefetcher({
      fetchDetail: async (providerId, ref) => {
        pedidas.push(`${providerId}:${ref}`)
      },
    })

    prefetch.hover('uno', 'a')
    prefetch.hover('uno', 'a')
    await Bun.sleep(5)

    expect(pedidas).toEqual(['uno:a'])
  })

  test('al salir el puntero se cancela lo que estaba en vuelo', async () => {
    let cancelado = false
    const prefetch = createPrefetcher({
      fetchDetail: (_providerId, _ref, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              cancelado = true
              reject(signal.reason)
            },
            { once: true },
          )
        }),
    })

    prefetch.hover('uno', 'a')
    prefetch.leave()

    expect(cancelado).toBe(true)
  })

  test('pasar por encima de otra tarjeta cancela la anterior', async () => {
    const canceladas: string[] = []
    const prefetch = createPrefetcher({
      fetchDetail: (providerId, _ref, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              canceladas.push(providerId)
              reject(signal.reason)
            },
            { once: true },
          )
        }),
    })

    prefetch.hover('uno', 'a')
    prefetch.hover('dos', 'b')

    expect(canceladas).toEqual(['uno'])
  })

  test('el tope corta el catálogo: nunca se precarga todo', () => {
    const prefetch = createPrefetcher({ fetchDetail: async () => {}, max: 3 })

    for (let i = 0; i < 20; i++) prefetch.hover('uno', `e${i}`)

    expect(prefetch.started()).toBe(3)
  })

  test('el tope por defecto es pequeño, no el catálogo', () => {
    const prefetch = createPrefetcher({ fetchDetail: async () => {} })

    for (let i = 0; i < 50; i++) prefetch.hover('uno', `e${i}`)

    expect(prefetch.started()).toBe(6)
  })
})
