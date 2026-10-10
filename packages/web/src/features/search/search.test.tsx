import { describe, expect, test } from 'bun:test'
import type { SearchResult } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { Grid, GridItem } from '../../components/Grid'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { ResultCard } from './ResultCard'
import { ResultGrid } from './ResultGrid'
import {
  announce,
  createScheduler,
  providersFromPath,
  queryFromPath,
  SEARCH_DEBOUNCE_MS,
  SearchPage,
  searchPath,
} from './SearchPage'
import { createPrefetcher, initialState } from './useSearchStream'

function resultado(
  providerId: string,
  ref: string,
  title: string,
  extra: Partial<SearchResult> = {},
): SearchResult {
  return {
    ref: { providerId, value: ref },
    title,
    ...extra,
  }
}

function render(node: ReactNode): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory('/search')}>{node}</HistoryProvider>,
  )
}

describe('la consulta vive en la dirección', () => {
  test('lee el término de la ruta, escapado o no', () => {
    expect(queryFromPath('/search?q=naruto%20shippuden')).toBe('naruto shippuden')
    expect(queryFromPath('/search?q=naruto')).toBe('naruto')
    expect(queryFromPath('/search')).toBe('')
    expect(queryFromPath('/search?provider=mio&q=uno')).toBe('uno')
  })

  test('construye la ruta, y sin término deja la pantalla a secas', () => {
    expect(searchPath('naruto')).toBe('/search?q=naruto')
    expect(searchPath('naruto shippuden')).toBe('/search?q=naruto%20shippuden')
    expect(searchPath('añejo & raro')).toBe('/search?q=a%C3%B1ejo%20%26%20raro')
    expect(searchPath('   ')).toBe('/search')
  })

  test('conserva el filtro de proveedor al reescribir la consulta', () => {
    expect(searchPath('naruto', ['mio'])).toBe('/search?q=naruto&provider=mio')
    expect(searchPath('', ['mio', 'otro'])).toBe('/search?provider=mio&provider=otro')
  })

  test('lee el filtro de proveedor de la ruta', () => {
    expect(providersFromPath('/search?q=a&provider=uno&provider=dos')).toEqual(['uno', 'dos'])
    expect(providersFromPath('/search?q=a')).toEqual([])
  })

  test('el retardo es el del spec', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(400)
  })
})

describe('anuncio para lectores de pantalla', () => {
  test('mientras busca, lo dice', () => {
    expect(announce(initialState(['uno']), ['uno'])).toContain('Buscando')
  })

  test('sin proveedores todavía cargados no afirma que no haya ninguno', () => {
    expect(announce(initialState([]), [], false)).toContain('Buscando')
  })

  test('sin proveedores activos, lo dice', () => {
    expect(announce(initialState([]), [])).toContain('No hay ningún proveedor activo')
  })

  test('al cerrar anuncia el recuento y cuántos proveedores respondieron', () => {
    const estado = {
      results: [resultado('uno', 'a', 'A'), resultado('dos', 'b', 'B'), resultado('dos', 'c', 'C')],
      pending: [],
      errors: [],
      done: true,
    }

    const texto = announce(estado, ['uno', 'dos'])

    expect(texto).toContain('3 resultados')
    expect(texto).toContain('2 proveedores')
  })

  test('un fallo de transporte se anuncia como fallo', () => {
    const estado = { ...initialState([]), done: true, failed: 'sin conexión' }

    expect(announce(estado, [])).toContain('sin conexión')
  })
})

describe('retardo', () => {
  test('programa con el tiempo indicado y no cancela nada la primera vez', () => {
    const programados: number[] = []
    const cancelados: number[] = []
    const scheduler = createScheduler(
      (_run: () => void, ms: number) => {
        programados.push(ms)
        return programados.length
      },
      (handle: number) => cancelados.push(handle),
    )

    scheduler(() => {}, 400)

    expect(programados).toEqual([400])
    expect(cancelados).toEqual([])
  })

  test('programar otra vez cancela lo anterior: una tecla no es una petición', () => {
    const cancelados: number[] = []
    let programados = 0
    const scheduler = createScheduler(
      (_run: () => void, _ms: number) => {
        programados += 1
        return programados
      },
      (handle: number) => cancelados.push(handle),
    )

    scheduler(() => {}, 400)
    scheduler(() => {}, 400)
    scheduler(() => {}, 400)

    expect(cancelados).toEqual([1, 2])
    expect(programados).toBe(3)
  })
})

describe('tarjeta', () => {
  test('es un enlace real a la ruta de detalle, con la referencia codificada', () => {
    const html = render(<ResultCard result={resultado('mio', 'a/b c', 'Título')} />)

    expect(html).toContain('href="/anime/mio/a%2Fb%20c"')
    expect(html).toContain('Título')
  })

  test('lleva la etiqueta del proveedor de origen', () => {
    const html = render(<ResultCard result={resultado('mio', 't1', 'Uno')} />)

    expect(html).toContain('Origen: mio')
  })

  test('el nombre del proveedor gana sobre su id cuando se conoce', () => {
    const html = render(
      <ResultCard result={resultado('mio', 't1', 'Uno')} providerLabel="Mi fuente" />,
    )

    expect(html).toContain('Origen: Mi fuente')
    expect(html).not.toContain('Origen: mio')
  })

  test('pide la portada al proxy, nunca al sitio del proveedor', () => {
    const html = render(
      <ResultCard
        result={resultado('mio', 't1', 'Uno', { coverUrl: 'https://fixture.invalid/p.webp' })}
      />,
    )

    expect(html).toContain('src="/api/cover/mio/t1"')
    expect(html).not.toContain('fixture.invalid')
  })

  test('sin portada no pide nada: un hueco, no una imagen rota', () => {
    const html = render(<ResultCard result={resultado('mio', 't1', 'Uno')} />)

    expect(html).not.toContain('<img')
    expect(html).toContain('card__cover--vacia')
  })

  test('el año y el tipo salen como metadatos, y se omiten si no los hay', () => {
    const conDatos = render(
      <ResultCard result={resultado('mio', 't1', 'Uno', { year: 2019, kind: 'tv' })} />,
    )
    const sinDatos = render(<ResultCard result={resultado('mio', 't1', 'Uno')} />)

    expect(conDatos).toContain('2019 · tv')
    expect(sinDatos).not.toContain('card__meta')
  })
})

describe('rejilla y estado vacío', () => {
  test('lista los resultados en una lista con nombre accesible', () => {
    const html = render(
      <ResultGrid
        query="uno"
        results={[resultado('mio', 't1', 'Uno'), resultado('otro', 't2', 'Dos')]}
      />,
    )

    expect(html).toContain('<ul class="grid" aria-label="Resultados"')
    expect(html.match(/<li class="grid__item"/g)).toHaveLength(2)
    expect(html).toContain('href="/anime/otro/t2"')
  })

  test('sin resultados dice qué consulta no encontró nada', () => {
    const html = render(<ResultGrid query="xyz" results={[]} />)

    expect(html).toContain('Nada coincide')
    expect(html).toContain('xyz')
    expect(html).not.toContain('<ul')
  })

  test('sin consulta explica que hay que escribir algo', () => {
    const html = render(<ResultGrid query="" results={[]} />)

    expect(html).toContain('Escribe un título')
  })

  test('la rejilla genérica numera sus elementos', () => {
    const html = render(
      <Grid label="Cosas">
        <GridItem>uno</GridItem>
      </Grid>,
    )

    expect(html).toContain('aria-label="Cosas"')
    expect(html).toContain('uno')
  })
})

describe('página', () => {
  function pagina(path: string): string {
    return renderToString(
      <HistoryProvider history={createMemoryHistory(path)}>
        <SearchPage prefetcher={createPrefetcher({ fetchDetail: async () => {} })} />
      </HistoryProvider>,
    )
  }

  test('el campo toma el término que ya venía en la dirección', () => {
    const html = pagina('/search?q=naruto')

    expect(html).toContain('value="naruto"')
    expect(html).toContain('placeholder="Escribe un título…"')
  })

  test('el primer render no depende de ninguna petición', () => {
    const html = pagina('/search')

    // Sin proveedores cargados todavía, la región viva dice que está buscando y
    // el cuerpo invita a escribir: nada de esto necesita red.
    expect(html).toContain('Buscando')
    expect(html).toContain('Escribe un título')
    expect(html).toContain('aria-live="polite"')
  })

  test('sin resultados, el estado vacío explica la consulta', () => {
    expect(pagina('/search?q=xyz')).toContain('Escribe un título')
  })
})
