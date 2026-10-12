import { describe, expect, test } from 'bun:test'
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

/**
 * Un servidor de mentira que apunta las rutas pedidas.
 *
 * Aquí la medición **es** la lista de rutas: el fallo que se persigue no cambia
 * ningún resultado —los vecinos salen igual—, sólo hace que la pantalla descargue
 * la lista entera del título para saber quién va antes y quién después.
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

/** Ninguna lectura de vecinos puede ser la lista entera ni una página suelta. */
function soloPuntuales(rutas: readonly string[]): boolean {
  return rutas.every((ruta) => ruta.includes('/number/'))
}

function mirar(
  episodeRef: string,
  number: number | undefined,
): Parameters<typeof loadWatchNeighbours>[0] {
  return { providerId: 'fixture', titleRef: 'aurora-nocturna', episodeRef, number }
}

describe('los vecinos con el número en la dirección', () => {
  test('con `?n=12` se piden el 11 y el 13, y nada más', async () => {
    const objetivo = servidor(
      new Map([
        [episodeNumberPath('fixture', 'aurora-nocturna', 11), { episode: episodio(11) }],
        [episodeNumberPath('fixture', 'aurora-nocturna', 13), { episode: episodio(13) }],
      ]),
    )

    const vecinos = await loadWatchNeighbours(mirar('aurora-nocturna#12', 12), {
      deps: objetivo.deps,
    })

    expect([...objetivo.rutas].sort()).toEqual([
      '/api/anime/fixture/aurora-nocturna/episodes/number/11',
      '/api/anime/fixture/aurora-nocturna/episodes/number/13',
    ])
    expect(soloPuntuales(objetivo.rutas)).toBe(true)
    expect(vecinos.previous?.number).toBe(11)
    expect(vecinos.next?.number).toBe(13)
    // Sin lista no hay total que enseñar: sólo el número, sin inventar el de cuántos.
    expect(vecinos.position).toEqual({ number: 12 })
  })

  test('con `?n=1` no se pide el episodio 0 y la flecha anterior queda sin destino', async () => {
    const objetivo = servidor(
      new Map([[episodeNumberPath('fixture', 'aurora-nocturna', 2), { episode: episodio(2) }]]),
    )

    const vecinos = await loadWatchNeighbours(mirar('aurora-nocturna#1', 1), {
      deps: objetivo.deps,
    })

    expect(objetivo.rutas).toEqual(['/api/anime/fixture/aurora-nocturna/episodes/number/2'])
    expect(objetivo.rutas.some((ruta) => ruta.includes('/number/0'))).toBe(false)
    // Sin anterior es lo que apaga la flecha: la pantalla pinta el rótulo apagado.
    expect(vecinos.previous).toBeUndefined()
    expect(vecinos.next?.number).toBe(2)
  })

  test('un 404 en un vecino es «no hay vecino», no un fallo', async () => {
    const objetivo = servidor(
      new Map([[episodeNumberPath('fixture', 'aurora-nocturna', 13), { episode: episodio(13) }]]),
    )

    const vecinos = await loadWatchNeighbours(mirar('aurora-nocturna#12', 12), {
      deps: objetivo.deps,
    })

    expect(vecinos.previous).toBeUndefined()
    expect(vecinos.next?.number).toBe(13)
  })
})

describe('los vecinos sin número', () => {
  test('sin `?n=` se pide la página 1, con su número de página', async () => {
    const objetivo = servidor(
      new Map([
        [
          episodesPath('fixture', 'aurora-nocturna', 1),
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
          episodesPath('fixture', 'aurora-nocturna', 1),
          { episodes: [episodio(1), episodio(2)], page: 1, hasMore: true },
        ],
        [
          episodesPath('fixture', 'aurora-nocturna', 2),
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
          episodesPath('fixture', 'aurora-nocturna', 1),
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
          episodesPath('fixture', 'aurora-nocturna', 1),
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
