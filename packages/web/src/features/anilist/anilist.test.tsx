/**
 * La búsqueda de una casilla en la interfaz.
 *
 * Lo que se mide aquí es la lógica que tiene reglas —el camino de la petición, las
 * transiciones del estado, la puerta del 429 y el presupuesto— y el primer render de la
 * pantalla. El navegador hace falta para el resto, y eso no lo cubre esta prueba.
 */

import { describe, expect, test } from 'bun:test'
import type { AniListSearchItem, AniListSearchResponse } from '@nn-anime/core/api'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { AniListSearchPage, claveDeFallo, piezaDeBusqueda } from './AniListSearchPage'
import {
  DEBOUNCE_MS,
  ESTADO_INICIAL,
  empezar,
  esperaHasta,
  fallar,
  MIN_INTERVAL_MS,
  proximaSalida,
  puedePedirMas,
  puedeSalir,
  puertaTras429,
  recibir,
  retryAfterSeconds,
  searchPath,
  THROTTLE_DEFAULT_S,
} from './useAniListSearch'

const FRIEREN: AniListSearchItem = {
  anilistId: 154587,
  title: 'Frieren: Beyond Journey’s End',
  secondaryTitle: 'Sousou no Frieren',
  titles: { romaji: 'Sousou no Frieren', english: 'Frieren: Beyond Journey’s End', native: null },
  cover: '/api/anilist/image/cover/154587',
  adult: false,
  year: 2023,
  format: 'TV',
  kind: 'tv',
  genres: ['Adventure', 'Drama'],
}

function cuerpo(items: readonly AniListSearchItem[], page = 1): AniListSearchResponse {
  // La copia es porque el schema de la frontera infiere un array mutable: la respuesta se
  // construye aquí como la construiría el servidor, y no se comparte la lista del test.
  return { items: [...items], page, hasNextPage: false, total: items.length, unknownGenres: [] }
}

function render(node: ReactNode): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory('/anilist')}>{node}</HistoryProvider>,
  )
}

describe('el camino de la petición', () => {
  test('el texto va escapado y la página sólo cuando no es la primera', () => {
    expect(searchPath('frieren', 1)).toBe('/api/anilist/search?q=frieren')
    expect(searchPath('frieren #fantasy', 1)).toBe('/api/anilist/search?q=frieren%20%23fantasy')
    expect(searchPath('frieren', 2)).toBe('/api/anilist/search?q=frieren&page=2')
  })

  test('va a la ruta del servidor y nunca a AniList', () => {
    expect(searchPath('naruto', 1).startsWith('/api/anilist/search')).toBe(true)
    expect(searchPath('naruto', 1)).not.toContain('graphql.anilist.co')
  })
})

describe('el estado', () => {
  test('empezar dice qué se está cargando y olvida el fallo anterior', () => {
    const conFallo = fallar(ESTADO_INICIAL, { kind: 'network' })

    expect(conFallo.failure).toEqual({ kind: 'network' })
    expect(empezar(conFallo, 'more').loading).toBe('more')
    expect(empezar(conFallo, 'more').failure).toBeUndefined()
  })

  test('la primera página sustituye y el «más» añade', () => {
    const una = recibir(ESTADO_INICIAL, cuerpo([FRIEREN]), 'first')
    const dos = recibir(una, cuerpo([{ ...FRIEREN, anilistId: 2, title: 'Otra' }], 2), 'more')

    expect(una.items).toHaveLength(1)
    expect(dos.items.map((item) => item.anilistId)).toEqual([154587, 2])
    expect(dos.page).toBe(2)
  })

  test('un fallo deja la lista donde estaba y deja de cargar', () => {
    const conLista = recibir(ESTADO_INICIAL, cuerpo([FRIEREN]), 'first')
    const roto = fallar({ ...conLista, loading: 'more' }, { kind: 'server', status: 502 })

    expect(roto.items).toHaveLength(1)
    expect(roto.loading).toBe('none')
    expect(roto.failure).toEqual({ kind: 'server', status: 502 })
  })

  test('el estado inicial ya está buscando: la pantalla busca al montarse', () => {
    // Si el estado inicial dijera «nada», el primer render afirmaría que no hay resultados
    // antes de haber preguntado.
    expect(ESTADO_INICIAL.loading).toBe('first')
  })

  test('cada fallo tiene su clave de traducción', () => {
    expect(claveDeFallo({ kind: 'network' })).toBe('anilist.failed.network')
    expect(claveDeFallo({ kind: 'timeout' })).toBe('anilist.failed.timeout')
    expect(claveDeFallo({ kind: 'throttled', waitS: 30 })).toBe('anilist.failed.throttled')
    expect(claveDeFallo({ kind: 'server', status: 502 })).toBe('anilist.failed.server')
    expect(claveDeFallo({ kind: 'shape' })).toBe('anilist.failed.shape')
  })
})

describe('la puerta del 429 y el presupuesto', () => {
  test('lo que diga `Retry-After`, en segundos', () => {
    expect(retryAfterSeconds('30')).toBe(30)
    expect(retryAfterSeconds(' 12 ')).toBe(12)
    expect(retryAfterSeconds('0')).toBeUndefined()
    expect(retryAfterSeconds('-5')).toBeUndefined()
    expect(retryAfterSeconds('en un rato')).toBeUndefined()
    expect(retryAfterSeconds(null)).toBeUndefined()
  })

  test('no se sale antes de que se abra la puerta, y se sabe cuánto falta', () => {
    const ahora = 1_000
    const puerta = ahora + 30_000

    expect(puedeSalir(ahora, puerta)).toBe(false)
    expect(esperaHasta(ahora, puerta)).toBe(30_000)
    expect(puedeSalir(puerta, puerta)).toBe(true)
    expect(esperaHasta(puerta + 1, puerta)).toBe(0)
  })

  test('un 429 abre la puerta por lo que dura, y el presupuesto por dos segundos', () => {
    expect(puertaTras429(1_000, 30)).toBe(31_000)
    expect(puertaTras429(1_000, THROTTLE_DEFAULT_S)).toBe(61_000)
    expect(proximaSalida(1_000)).toBe(3_000)
  })

  test('la página siguiente sólo se pide si la hay y no hay nada en vuelo', () => {
    const conMas = { ...ESTADO_INICIAL, hasNextPage: true, loading: 'none' as const }

    expect(puedePedirMas(conMas)).toBe(true)
    expect(puedePedirMas({ ...conMas, hasNextPage: false })).toBe(false)
    // Pulsar «más» dos veces seguidas no puede pedir la misma página dos veces.
    expect(puedePedirMas({ ...conMas, loading: 'more' })).toBe(false)
    expect(puedePedirMas({ ...conMas, loading: 'first' })).toBe(false)
  })

  test('el presupuesto entre peticiones es de dos segundos y el retardo de 300 ms', () => {
    expect(MIN_INTERVAL_MS).toBe(2000)
    expect(DEBOUNCE_MS).toBe(300)
  })
})

describe('la pieza que se pinta', () => {
  test('lleva el romaji y los géneros en la línea de datos', () => {
    const pieza = piezaDeBusqueda(FRIEREN)

    expect(pieza.title).toBe('Frieren: Beyond Journey’s End')
    expect(pieza.meta).toContain('Sousou no Frieren')
    expect(pieza.meta).toContain('Adventure · Drama')
    expect(pieza.portada).toBe('/api/anilist/image/cover/154587')
  })

  test('una obra que la base conoce abre su ficha; la que no, la búsqueda', () => {
    expect(piezaDeBusqueda({ ...FRIEREN, ref: { providerId: 'mio', value: 'a' } }).to).toBe(
      '/anime/mio/a',
    )
    expect(piezaDeBusqueda(FRIEREN).to).toContain('/search?q=')
  })
})

describe('la pantalla', () => {
  test('el primer render busca y no afirma que no haya nada', () => {
    const html = render(<AniListSearchPage />)

    expect(html).toContain('Buscando')
    // El texto del estado vacío, no su clave: la clave no aparece nunca en el HTML y
    // comprobarla no mediría nada.
    expect(html).not.toContain('Nada en el catálogo coincide')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('id="anilist-term"')
    expect(html).toContain('class="anilist-page"')
    expect(html).toContain('Explora anime por título o género.')
  })

  test('explica cómo se escribe un género', () => {
    const html = render(<AniListSearchPage />)

    expect(html).toContain('#slice-of-life')
    expect(html).toContain('Catálogo')
  })
})
