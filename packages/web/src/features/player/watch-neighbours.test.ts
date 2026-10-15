import { describe, expect, test } from 'bun:test'
import type { EpisodesResponse } from '@nn-anime/core/api'
import type { Episode } from '@nn-anime/core/models'
import type { RequestDeps } from '../../api/client'
import { episodeNumberPath, episodesPath } from '../detail/useDetail'
import { loadWatchNeighbours, shouldLoadNeighbours } from './WatchPage'

/** Un episodio del fixture, con lo mínimo que exige el schema. */
function episodio(number: number): Episode {
  return {
    ref: { providerId: 'fixture', value: `aurora-nocturna#${number}` },
    animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
    number,
    title: `Episodio ${number}`,
    durationS: 1440,
    mode: 'sub',
  }
}

/** Una página servida, con lo que no venga en el cuerpo por defecto. */
function pagina(
  episodes: readonly Episode[],
  extras: Partial<Pick<EpisodesResponse, 'page' | 'hasMore' | 'total'>> = {},
): EpisodesResponse {
  return {
    episodes: [...episodes],
    page: extras.page ?? 1,
    hasMore: extras.hasMore ?? false,
    ...(extras.total === undefined ? {} : { total: extras.total }),
  }
}

/**
 * Un servidor de mentira que apunta las rutas pedidas.
 *
 * Aquí la medición **es** la lista de rutas: el fallo que se persigue no cambia
 * ningún resultado —los vecinos salen igual—, sólo hace que la pantalla descargue
 * de más. Con el número en la dirección, la página que se pide es para leer el
 * total y, cuando el episodio está en ella, evita las dos lecturas puntuales.
 */
function servidor(respuestas: ReadonlyMap<string, unknown>): {
  readonly rutas: string[]
  readonly deps: RequestDeps
} {
  const rutas: string[] = []

  return {
    rutas,
    deps: {
      fetch: (input) => {
        rutas.push(input)
        const cuerpo = respuestas.get(input)
        if (cuerpo === undefined) {
          return Promise.resolve(new Response('{"error":"no está"}', { status: 404 }))
        }

        return Promise.resolve(new Response(JSON.stringify(cuerpo), { status: 200 }))
      },
    },
  }
}

/**
 * Ninguna lectura de la lista es la lista entera.
 *
 * El troceado es del servidor: una lectura sin `?page=` es la lista completa, que
 * es justo lo que la pantalla dejó de pedir cuando sólo necesita los vecinos y el
 * total.
 */
function todaListaConPagina(rutas: readonly string[]): boolean {
  return rutas.every((ruta) => !ruta.endsWith('/episodes') || ruta.includes('?page='))
}

function mirar(
  episodeRef: string,
  number: number | undefined,
): Parameters<typeof loadWatchNeighbours>[0] {
  return { providerId: 'fixture', titleRef: 'aurora-nocturna', episodeRef, number }
}

describe('los vecinos con el número en la dirección', () => {
  /**
   * El episodio está en la primera página: los vecinos salen de ella.
   *
   * La página se pide igualmente —es la que trae el total, y sin él la pantalla
   * decía «Episodio 12» donde sabía decir «de 26»—, y de paso trae a los vecinos:
   * las dos lecturas puntuales sobran.
   */
  test('con `?n=12` y el episodio en la primera página no se pide ningún número', async () => {
    const objetivo = servidor(
      new Map([
        [
          episodesPath('fixture', 'aurora-nocturna', { page: 1 }),
          pagina([episodio(11), episodio(12), episodio(13)], { total: 26 }),
        ],
      ]),
    )

    const vecinos = await loadWatchNeighbours(mirar('aurora-nocturna#12', 12), {
      deps: objetivo.deps,
    })

    expect(objetivo.rutas).toEqual(['/api/anime/fixture/aurora-nocturna/episodes?page=1'])
    expect(todaListaConPagina(objetivo.rutas)).toBe(true)
    expect(vecinos.previous?.number).toBe(11)
    expect(vecinos.next?.number).toBe(13)
    // El total viene de la página: es lo que convierte «Episodio 12» en «de 26».
    expect(vecinos.position).toEqual({ number: 12, total: 26, title: 'Episodio 12' })
  })

  test('sin total en la página, el episodio se dice y no de cuántos', async () => {
    const objetivo = servidor(
      new Map([[episodesPath('fixture', 'aurora-nocturna', { page: 1 }), pagina([episodio(12)])]]),
    )

    const vecinos = await loadWatchNeighbours(mirar('aurora-nocturna#12', 12), {
      deps: objetivo.deps,
    })

    // Un «de 26» que el proveedor no dio es peor que no decir de cuántos.
    expect(vecinos.position).toEqual({ number: 12, title: 'Episodio 12' })
  })

  /**
   * El episodio no está en la primera página: se vuelve a lo puntual.
   *
   * Es el caso de una serie de mil episodios que pagina de cien en cien: la
   * primera página no tiene el 1180, así que sus vecinos se piden por número. El
   * total sigue saliendo de la página.
   */
  test('con el episodio fuera de la página se piden el 1179 y el 1181', async () => {
    const objetivo = servidor(
      new Map<string, unknown>([
        [
          episodesPath('fixture', 'aurora-nocturna', { page: 1 }),
          pagina([episodio(1), episodio(2)], { hasMore: true, total: 1180 }),
        ],
        [episodeNumberPath('fixture', 'aurora-nocturna', 1179), { episode: episodio(1179) }],
        [episodeNumberPath('fixture', 'aurora-nocturna', 1181), { episode: episodio(1181) }],
      ]),
    )

    const vecinos = await loadWatchNeighbours(mirar('aurora-nocturna#1180', 1180), {
      deps: objetivo.deps,
    })

    expect([...objetivo.rutas].sort()).toEqual([
      '/api/anime/fixture/aurora-nocturna/episodes/number/1179',
      '/api/anime/fixture/aurora-nocturna/episodes/number/1181',
      '/api/anime/fixture/aurora-nocturna/episodes?page=1',
    ])
    expect(vecinos.previous?.number).toBe(1179)
    expect(vecinos.next?.number).toBe(1181)
    // El número es el de la dirección —la lista no lo traía— y el total, el de la página.
    expect(vecinos.position).toEqual({ number: 1180, total: 1180 })
  })

  test('con `?n=1` no se pide el episodio 0 y la flecha anterior queda sin destino', async () => {
    const objetivo = servidor(
      new Map([
        [
          episodesPath('fixture', 'aurora-nocturna', { page: 1 }),
          pagina([episodio(1), episodio(2)], { total: 12 }),
        ],
      ]),
    )

    const vecinos = await loadWatchNeighbours(mirar('aurora-nocturna#1', 1), {
      deps: objetivo.deps,
    })

    expect(objetivo.rutas).toEqual(['/api/anime/fixture/aurora-nocturna/episodes?page=1'])
    expect(objetivo.rutas.some((ruta) => ruta.includes('/number/0'))).toBe(false)
    // Sin anterior es lo que apaga la flecha: la pantalla pinta el rótulo apagado.
    expect(vecinos.previous).toBeUndefined()
    expect(vecinos.next?.number).toBe(2)
    expect(vecinos.position).toEqual({ number: 1, total: 12, title: 'Episodio 1' })
  })

  test('el último de la página con `hasMore` pide la siguiente una sola vez', async () => {
    const objetivo = servidor(
      new Map([
        [
          episodesPath('fixture', 'aurora-nocturna', { page: 1 }),
          pagina([episodio(99), episodio(100)], { hasMore: true }),
        ],
        [
          episodesPath('fixture', 'aurora-nocturna', { page: 2 }),
          pagina([episodio(101)], { page: 2, total: 101 }),
        ],
      ]),
    )

    const vecinos = await loadWatchNeighbours(mirar('aurora-nocturna#100', 100), {
      deps: objetivo.deps,
    })

    expect(objetivo.rutas).toEqual([
      '/api/anime/fixture/aurora-nocturna/episodes?page=1',
      '/api/anime/fixture/aurora-nocturna/episodes?page=2',
    ])
    expect(vecinos.next?.number).toBe(101)
    // El total de la segunda página también vale: es el del título.
    expect(vecinos.position?.total).toBe(101)
  })

  test('un 404 en un vecino es «no hay vecino», no un fallo', async () => {
    const objetivo = servidor(
      new Map<string, unknown>([
        [
          episodesPath('fixture', 'aurora-nocturna', { page: 1 }),
          pagina([episodio(1), episodio(2)], { hasMore: true, total: 12 }),
        ],
        [episodeNumberPath('fixture', 'aurora-nocturna', 13), { episode: episodio(13) }],
      ]),
    )

    const vecinos = await loadWatchNeighbours(mirar('aurora-nocturna#12', 12), {
      deps: objetivo.deps,
    })

    expect(vecinos.previous).toBeUndefined()
    expect(vecinos.next?.number).toBe(13)
  })

  /**
   * La página caída no se lleva por delante al episodio.
   *
   * Sin ella se pierde el total, no los vecinos: la pantalla sigue reproduciendo y
   * las flechas siguen ahí porque el número de la dirección basta para pedirlas.
   */
  test('si la primera página falla, quedan los dos vecinos puntuales y ningún total', async () => {
    const objetivo = servidor(
      new Map([
        [episodeNumberPath('fixture', 'aurora-nocturna', 11), { episode: episodio(11) }],
        [episodeNumberPath('fixture', 'aurora-nocturna', 13), { episode: episodio(13) }],
      ]),
    )

    const vecinos = await loadWatchNeighbours(mirar('aurora-nocturna#12', 12), {
      deps: objetivo.deps,
    })

    expect(objetivo.rutas).toEqual([
      '/api/anime/fixture/aurora-nocturna/episodes?page=1',
      '/api/anime/fixture/aurora-nocturna/episodes/number/11',
      '/api/anime/fixture/aurora-nocturna/episodes/number/13',
    ])
    expect(vecinos.previous?.number).toBe(11)
    expect(vecinos.next?.number).toBe(13)
    expect(vecinos.position).toEqual({ number: 12 })
  })
})

describe('los vecinos sin número', () => {
  test('sin `?n=` se pide la página 1, con su número de página', async () => {
    const objetivo = servidor(
      new Map([
        [
          episodesPath('fixture', 'aurora-nocturna', { page: 1 }),
          { episodes: [episodio(1), episodio(2), episodio(3)], page: 1, hasMore: false, total: 3 },
        ],
      ]),
    )

    const vecinos = await loadWatchNeighbours(mirar('aurora-nocturna#2', undefined), {
      deps: objetivo.deps,
    })

    expect(objetivo.rutas).toEqual(['/api/anime/fixture/aurora-nocturna/episodes?page=1'])
    expect(vecinos.previous?.number).toBe(1)
    expect(vecinos.next?.number).toBe(3)
    expect(vecinos.position).toEqual({ number: 2, total: 3, title: 'Episodio 2' })
  })

  test('el último de la página con `hasMore` pide la siguiente una sola vez', async () => {
    const objetivo = servidor(
      new Map([
        [
          episodesPath('fixture', 'aurora-nocturna', { page: 1 }),
          { episodes: [episodio(1), episodio(2)], page: 1, hasMore: true },
        ],
        [
          episodesPath('fixture', 'aurora-nocturna', { page: 2 }),
          { episodes: [episodio(3)], page: 2, hasMore: false, total: 3 },
        ],
      ]),
    )

    const vecinos = await loadWatchNeighbours(mirar('aurora-nocturna#2', undefined), {
      deps: objetivo.deps,
    })

    expect(objetivo.rutas.filter((ruta) => ruta.endsWith('?page=2')).length).toBe(1)
    expect(vecinos.next?.number).toBe(3)
    // El total de la segunda página también vale: es el del título.
    expect(vecinos.position?.total).toBe(3)
  })

  test('el que no es último de la página no dispara la segunda', async () => {
    const objetivo = servidor(
      new Map([
        [
          episodesPath('fixture', 'aurora-nocturna', { page: 1 }),
          { episodes: [episodio(1), episodio(2)], page: 1, hasMore: true },
        ],
      ]),
    )

    const vecinos = await loadWatchNeighbours(mirar('aurora-nocturna#1', undefined), {
      deps: objetivo.deps,
    })

    expect(objetivo.rutas).toEqual(['/api/anime/fixture/aurora-nocturna/episodes?page=1'])
    expect(vecinos.next?.number).toBe(2)
  })

  test('un episodio que no está en la página 1 no inventa flechas', async () => {
    const objetivo = servidor(
      new Map([
        [
          episodesPath('fixture', 'aurora-nocturna', { page: 1 }),
          { episodes: [episodio(1), episodio(2)], page: 1, hasMore: true },
        ],
      ]),
    )

    const vecinos = await loadWatchNeighbours(mirar('aurora-nocturna#99', undefined), {
      deps: objetivo.deps,
    })

    expect(vecinos).toEqual({ previous: undefined, next: undefined, position: undefined })
    // Ni siquiera se mira la segunda página: no hay a quién buscarle vecinos.
    expect(objetivo.rutas).toEqual(['/api/anime/fixture/aurora-nocturna/episodes?page=1'])
  })
})

describe('cuándo se piden los vecinos', () => {
  test('nunca durante la carga inicial del stream', () => {
    expect(shouldLoadNeighbours('loading')).toBe(false)
    expect(shouldLoadNeighbours('ready')).toBe(true)
    expect(shouldLoadNeighbours('error')).toBe(true)
  })
})
