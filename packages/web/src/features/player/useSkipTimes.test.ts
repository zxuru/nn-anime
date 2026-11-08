import { describe, expect, test } from 'bun:test'
import type { SkipInterval } from '@nn-anime/core/schema'
import type { RequestDeps } from '../../api/client'
import {
  anilistIdDelTitulo,
  intervalosDelEpisodio,
  rutaDeEnriquecimiento,
  rutaDeSaltos,
} from './useSkipTimes'

/**
 * Un `fetch` de mentira con sus rutas apuntadas.
 *
 * Las funciones puras del hook son las que hablan con la aplicación, y lo que
 * hay que medir es qué piden y qué hacen con lo que reciben —incluidos los
 * fallos, que es donde la pantalla se queda sin botón—. El hook en sí necesita
 * un navegador y lo cubre el e2e.
 */
function fetchFalso(
  responder: (ruta: string) => { readonly status: number; readonly cuerpo: unknown },
): { readonly deps: RequestDeps; readonly rutas: string[] } {
  const rutas: string[] = []

  return {
    rutas,
    deps: {
      fetch: (ruta) => {
        rutas.push(ruta)
        const { status, cuerpo } = responder(ruta)

        return Promise.resolve(
          new Response(status === 204 ? null : JSON.stringify(cuerpo), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
        )
      },
    },
  }
}

const ENRIQUECIMIENTO = {
  enrichment: {
    anilistId: 555,
    cover: '/api/anilist/image/cover/555',
    genres: ['Misterio'],
    adult: false,
    siteUrl: 'https://anilist.co/anime/555',
    studios: ['Estudio Cobre'],
  },
}

describe('la ruta del enriquecimiento', () => {
  test('codifica las dos referencias', () => {
    expect(rutaDeEnriquecimiento('fixture', 'aurora-nocturna')).toBe(
      '/api/anime/fixture/aurora-nocturna/enrichment',
    )
    // La almohadilla de la referencia no puede partir la ruta.
    expect(rutaDeEnriquecimiento('fic ture', 'aurora no#cturna')).toBe(
      '/api/anime/fic%20ture/aurora%20no%23cturna/enrichment',
    )
  })
})

describe('la ruta de los saltos', () => {
  test('lleva el identificador, el episodio y la duración redondeada', () => {
    expect(rutaDeSaltos(555, 3, 1440.4)).toBe('/api/skip-times/555/3?length=1440')
    expect(rutaDeSaltos(555, 3, 1440.6)).toBe('/api/skip-times/555/3?length=1441')
  })
})

describe('el identificador de AniList', () => {
  test('sale del enriquecimiento', async () => {
    const { deps, rutas } = fetchFalso(() => ({ status: 200, cuerpo: ENRIQUECIMIENTO }))

    expect(await anilistIdDelTitulo('fixture', 'aurora-nocturna', undefined, deps)).toBe(555)
    expect(rutas).toEqual(['/api/anime/fixture/aurora-nocturna/enrichment'])
  })

  test('`null` es «no hay ficha», no un fallo: no se inventa un identificador', async () => {
    const { deps } = fetchFalso(() => ({ status: 200, cuerpo: { enrichment: null } }))

    expect(await anilistIdDelTitulo('fixture', 'aurora-nocturna', undefined, deps)).toBeUndefined()
  })

  test('un fallo de red o una forma que no es la pactada devuelven nada, sin lanzar', async () => {
    const redRota: RequestDeps = {
      fetch: () => Promise.reject(new Error('sin red')),
    }
    const formaRara = fetchFalso(() => ({
      status: 200,
      cuerpo: { enrichment: { anilistId: 'no' } },
    }))
    const errorDelServidor = fetchFalso(() => ({ status: 500, cuerpo: {} }))

    expect(await anilistIdDelTitulo('fixture', 'x', undefined, redRota)).toBeUndefined()
    expect(await anilistIdDelTitulo('fixture', 'x', undefined, formaRara.deps)).toBeUndefined()
    expect(
      await anilistIdDelTitulo('fixture', 'x', undefined, errorDelServidor.deps),
    ).toBeUndefined()
  })
})

describe('los intervalos del episodio', () => {
  const INTERVALOS: readonly SkipInterval[] = [
    { type: 'op', start: 5, end: 20 },
    { type: 'ed', start: 40, end: 55 },
  ]

  test('se piden con la duración y se devuelven validados', async () => {
    const { deps, rutas } = fetchFalso(() => ({ status: 200, cuerpo: INTERVALOS }))

    expect(await intervalosDelEpisodio(555, 3, 60, undefined, deps)).toEqual(INTERVALOS)
    expect(rutas).toEqual(['/api/skip-times/555/3?length=60'])
  })

  test('una respuesta vacía es una respuesta: la lista vacía se devuelve tal cual', async () => {
    const { deps } = fetchFalso(() => ({ status: 200, cuerpo: [] }))

    expect(await intervalosDelEpisodio(555, 3, 60, undefined, deps)).toEqual([])
  })

  test('sin duración no se pide nada: `length=0` no describe ningún episodio', async () => {
    const { deps, rutas } = fetchFalso(() => ({ status: 200, cuerpo: INTERVALOS }))

    expect(await intervalosDelEpisodio(555, 3, 0, undefined, deps)).toEqual([])
    expect(await intervalosDelEpisodio(555, 3, Number.NaN, undefined, deps)).toEqual([])
    expect(rutas).toEqual([])
  })

  test('un fallo devuelve una lista vacía, sin lanzar', async () => {
    const redRota: RequestDeps = { fetch: () => Promise.reject(new Error('sin red')) }
    const errorDelServidor = fetchFalso(() => ({ status: 500, cuerpo: {} }))
    const formaRara = fetchFalso(() => ({ status: 200, cuerpo: [{ type: 'otro' }] }))

    expect(await intervalosDelEpisodio(555, 3, 60, undefined, redRota)).toEqual([])
    expect(await intervalosDelEpisodio(555, 3, 60, undefined, errorDelServidor.deps)).toEqual([])
    expect(await intervalosDelEpisodio(555, 3, 60, undefined, formaRara.deps)).toEqual([])
  })
})
