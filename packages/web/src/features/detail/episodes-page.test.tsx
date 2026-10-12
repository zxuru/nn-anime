import { describe, expect, test } from 'bun:test'
import type { EpisodesResponse } from '@nn-anime/core/api'
import type { Episode } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import type { RequestDeps } from '../../api/client'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { conMandos, EpisodeList, EpisodePager, pageAfter } from './EpisodeList'
import {
  type EpisodeLookup,
  episodeNumberPath,
  episodesPath,
  latestEpisodePath,
  loadEpisodeByNumber,
  loadEpisodesPage,
  loadLatestEpisode,
  parseJump,
} from './useDetail'

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
    // El schema devuelve un array mutable y el de la lista es de sólo lectura.
    episodes: [...episodes],
    page: extras.page ?? 1,
    hasMore: extras.hasMore ?? false,
    ...(extras.total === undefined ? {} : { total: extras.total }),
  }
}

/** Una respuesta servida: un cuerpo y, si toca, su estado. */
interface Respuesta {
  readonly status?: number
  readonly body: unknown
}

/**
 * Un servidor de mentira que apunta las rutas pedidas.
 *
 * Se mide la ruta y no sólo el resultado porque el fallo que se persigue es una
 * petición mal hecha —la lista entera donde basta una página, un número sin su
 * decimal— y eso no rompe ningún resultado: sólo hace lenta o muda la pantalla.
 */
function servidor(respuestas: ReadonlyMap<string, Respuesta>): {
  readonly rutas: string[]
  readonly deps: RequestDeps
} {
  const rutas: string[] = []

  return {
    rutas,
    deps: {
      fetch: (input) => {
        rutas.push(input)
        const servida = respuestas.get(input)
        if (servida === undefined) {
          return Promise.resolve(new Response('{"error":"no está"}', { status: 404 }))
        }

        return Promise.resolve(
          new Response(JSON.stringify(servida.body), { status: servida.status ?? 200 }),
        )
      },
    },
  }
}

function render(node: ReactNode): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory('/anime/fixture/aurora-nocturna')}>
      {node}
    </HistoryProvider>,
  )
}

/** La etiqueta de apertura del botón que lleva ese texto, para mirar si se apaga. */
function boton(html: string, texto: string): string {
  const indice = html.indexOf(texto)

  return html.slice(html.lastIndexOf('<button', indice), html.indexOf('>', indice) + 1)
}

/** El número del episodio que se encontró, para las pruebas que esperan uno. */
function numeroDe(lookup: EpisodeLookup): number | undefined {
  return lookup.kind === 'found' ? lookup.episode.number : undefined
}

function pager(extra: Partial<Parameters<typeof EpisodePager>[0]> = {}): string {
  return render(
    <EpisodePager
      page={1}
      hasMore
      onPage={() => {}}
      onJump={() => {}}
      onLatest={() => {}}
      {...extra}
    />,
  )
}

describe('la lista, por páginas', () => {
  /**
   * La primera página se pide con `?page=1`, no con la lista entera.
   *
   * El servidor trata la ausencia de página como la 1, pero la lista sin parámetro
   * y la primera página son dos claves distintas en la caché del cliente: la
   * pantalla que trocea tiene que decir siempre cuál pide.
   */
  test('la primera página se pide con su número', async () => {
    const objetivo = servidor(
      new Map([[episodesPath('fixture', 'aurora-nocturna', 1), { body: pagina([episodio(1)]) }]]),
    )

    const recibida = await loadEpisodesPage('fixture', 'aurora-nocturna', 1, {
      deps: objetivo.deps,
    })

    expect(objetivo.rutas).toEqual(['/api/anime/fixture/aurora-nocturna/episodes?page=1'])
    expect(recibida.episodes.map((episode) => episode.number)).toEqual([1])
  })

  test('«siguiente» pide la 2 y «anterior» en la 1 vuelve a la 1, nunca a la 0', async () => {
    // Es la misma expresión que usan los botones: la página que pide cada uno.
    expect(episodesPath('fixture', 'aurora-nocturna', pageAfter(1, 1))).toBe(
      '/api/anime/fixture/aurora-nocturna/episodes?page=2',
    )
    expect(episodesPath('fixture', 'aurora-nocturna', pageAfter(1, -1))).toBe(
      '/api/anime/fixture/aurora-nocturna/episodes?page=1',
    )

    const objetivo = servidor(
      new Map([[episodesPath('fixture', 'aurora-nocturna', 2), { body: pagina([]) }]]),
    )

    await loadEpisodesPage('fixture', 'aurora-nocturna', pageAfter(1, 1), { deps: objetivo.deps })

    expect(objetivo.rutas).toEqual(['/api/anime/fixture/aurora-nocturna/episodes?page=2'])
  })

  test('las flechas se apagan en los extremos y el número de página se ve', () => {
    const primera = pager({ page: 1, hasMore: true })

    expect(primera).toContain('Página 1')
    expect(boton(primera, 'Página anterior')).toContain('disabled')
    expect(boton(primera, 'Página siguiente')).not.toContain('disabled')

    const ultima = pager({ page: 4, hasMore: false })

    expect(ultima).toContain('Página 4')
    expect(boton(ultima, 'Página anterior')).not.toContain('disabled')
    expect(boton(ultima, 'Página siguiente')).toContain('disabled')
  })

  test('con una sola página y sin nada detrás no hay mandos', () => {
    expect(conMandos(pagina([], { page: 1, hasMore: false }))).toBe(false)
    expect(conMandos(pagina([], { page: 1, hasMore: false, total: 12 }))).toBe(false)
  })

  test('con más páginas, o con una larga, los mandos están', () => {
    expect(conMandos(pagina([], { page: 2, hasMore: false }))).toBe(true)
    expect(conMandos(pagina([], { page: 1, hasMore: true }))).toBe(true)
    expect(conMandos(pagina([], { page: 1, hasMore: false, total: 1180 }))).toBe(true)
  })
})

describe('el salto por número', () => {
  /**
   * El campo pregunta al servidor por el número, y admite decimales.
   *
   * Antes saltaba de ventana dentro de la lista ya descargada: con la lista
   * troceada eso sólo encontraba lo que ya estaba en el navegador.
   */
  test('12.5 pide `number/12.5` y abre ese episodio', async () => {
    const numero = parseJump('12.5')
    expect(numero).toBe(12.5)
    if (numero === undefined) throw new Error('12.5 debería ser un número')

    const objetivo = servidor(
      new Map([
        [
          episodeNumberPath('fixture', 'aurora-nocturna', numero),
          { body: { episode: episodio(numero) } },
        ],
      ]),
    )

    const encontrado = await loadEpisodeByNumber('fixture', 'aurora-nocturna', numero, {
      deps: objetivo.deps,
    })

    expect(objetivo.rutas).toEqual(['/api/anime/fixture/aurora-nocturna/episodes/number/12.5'])
    expect(numeroDe(encontrado)).toBe(12.5)
  })

  test('un campo vacío, cero o texto no se interpreta', () => {
    expect(parseJump('')).toBeUndefined()
    expect(parseJump('   ')).toBeUndefined()
    expect(parseJump('0')).toBeUndefined()
    expect(parseJump('-3')).toBeUndefined()
    expect(parseJump('12,5')).toBeUndefined()
  })

  /**
   * Un 404 no es un fallo: el proveedor dice que ese episodio no está.
   *
   * Se distingue del resto a propósito, porque «no está» se cuenta con una frase
   * traducida y el fallo se cuenta con el motivo que dio el servidor.
   */
  test('un número que no está es un 404, y se dice con un texto traducido', async () => {
    const objetivo = servidor(new Map())

    const buscado = await loadEpisodeByNumber('fixture', 'aurora-nocturna', 12.5, {
      deps: objetivo.deps,
    })

    expect(buscado.kind).toBe('missing')

    const html = pager({ notFound: 12.5 })

    expect(html).toContain('El episodio 12.5 no está en este título.')
  })

  /**
   * El 502 se cuenta con el motivo del servidor, no como proveedor caído.
   *
   * Está medido con el plugin real: no puede construir un `ProviderError` con
   * estado 404 —vive fuera del repositorio y no resuelve el paquete—, así que un
   * episodio que no tiene llega como **502** con el mensaje «no tiene el episodio
   * 999 de kimetsu-no-yaiba: la ficha dice 26». Enseñar ahí un «el proveedor no
   * responde» esconde lo único que explica lo que pasó.
   */
  test('un 502 trae el mensaje del servidor y se enseña', async () => {
    const mensaje = 'no tiene el episodio 999 de aurora-nocturna: la ficha dice 26'
    const objetivo = servidor(
      new Map([
        [
          episodeNumberPath('fixture', 'aurora-nocturna', 999),
          { status: 502, body: { error: mensaje } },
        ],
      ]),
    )

    const buscado = await loadEpisodeByNumber('fixture', 'aurora-nocturna', 999, {
      deps: objetivo.deps,
    })

    expect(buscado).toEqual({ kind: 'failed', message: mensaje })

    const html = pager({ jumpMessage: buscado.kind === 'failed' ? buscado.message : '' })

    expect(html).toContain('la ficha dice 26')
    expect(html).toContain('No se pudo buscar el episodio')
  })

  test('una red caída trae su motivo en vez de un texto inventado', async () => {
    const roto: RequestDeps = { fetch: () => Promise.reject(new Error('sin red')) }

    const buscado = await loadEpisodeByNumber('fixture', 'aurora-nocturna', 3, { deps: roto })

    expect(buscado).toEqual({ kind: 'failed', message: 'sin red' })
  })
})

describe('el último episodio', () => {
  test('el botón pide `latest` y lleva a ese episodio', async () => {
    const objetivo = servidor(
      new Map([
        [latestEpisodePath('fixture', 'aurora-nocturna'), { body: { episode: episodio(26) } }],
      ]),
    )

    const ultimo = await loadLatestEpisode('fixture', 'aurora-nocturna', { deps: objetivo.deps })

    expect(objetivo.rutas).toEqual(['/api/anime/fixture/aurora-nocturna/episodes/latest'])
    expect(numeroDe(ultimo)).toBe(26)
    expect(pager()).toContain('Último episodio')
  })

  test('si no lo hay, se dice; y si falla, con el motivo del servidor', () => {
    expect(pager({ latestMissing: true })).toContain('No se pudo abrir el último episodio.')
    expect(pager({ latestMessage: 'la ficha no dice cuál es el último' })).toContain(
      'la ficha no dice cuál es el último',
    )
  })
})

describe('el selector completo', () => {
  /**
   * El primer render no depende de la red.
   *
   * Sin efectos no hay petición: el servidor pinta el aviso de que los episodios
   * están llegando, igual que la ficha pinta su esqueleto. Un render que esperara
   * datos no existiría en el servidor.
   */
  test('el primer render dice que están llegando', () => {
    const html = render(<EpisodeList providerId="fixture" ref="aurora-nocturna" />)

    expect(html).toContain('Cargando los episodios')
  })
})
