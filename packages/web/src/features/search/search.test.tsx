import { describe, expect, test } from 'bun:test'
import type { DiscoverItem } from '@nn-anime/core/api'
import type { SearchResult } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describirFallo } from '../../api/fallo'
import { Grid, GridItem } from '../../components/Grid'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { AniListCard, AniListCards } from './AniListCards'
import { AniListResults } from './AniListResults'
import { ResultCard } from './ResultCard'
import { ResultGrid } from './ResultGrid'
import {
  announce,
  createScheduler,
  providersFromPath,
  queryFromPath,
  resuelta,
  SEARCH_DEBOUNCE_MS,
  SearchPage,
  searchPath,
} from './SearchPage'
import { createPrefetcher, initialState, reduce } from './useSearchStream'

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
      ...initialState([]),
      results: [resultado('uno', 'a', 'A'), resultado('dos', 'b', 'B'), resultado('dos', 'c', 'C')],
      done: true,
    }

    const texto = announce(estado, ['uno', 'dos'])

    expect(texto).toContain('3 resultados')
    expect(texto).toContain('2 proveedores')
  })

  test('un fallo de transporte se anuncia como fallo', () => {
    const estado = {
      ...initialState([]),
      done: true,
      failed: describirFallo(new TypeError('Failed to fetch')),
    }

    expect(announce(estado, [])).toContain('sin conexión')
  })

  test('la misma obra en dos proveedores cuenta como un resultado, no como dos', () => {
    const estado = {
      ...initialState([]),
      results: [resultado('uno', 'a', 'Aurora'), resultado('dos', 'b', 'Aurora')],
      done: true,
    }

    // Contar respuestas en lugar de obras diría «2 resultados» con una sola
    // tarjeta en pantalla.
    expect(announce(estado, ['uno', 'dos'])).toContain('1 resultado de 2 proveedores')
  })
})

describe('cuándo se puede concluir que no hay nada', () => {
  test('con la búsqueda en vuelo, no', () => {
    // Es el instante en que se abre la pantalla desde un enlace: la petición
    // acaba de salir y todavía no ha contestado nadie.
    expect(resuelta({ done: false })).toBe(false)
  })

  test('cuando la búsqueda no llegó a abrirse, tampoco', () => {
    // Aquí el anuncio ya dice que falló; debajo no puede poner «nada coincide».
    // Mutar `resuelta` para mirar sólo `done` deja esta prueba en rojo.
    expect(resuelta({ done: true, failed: describirFallo(new TypeError('Failed to fetch')) })).toBe(
      false,
    )
  })

  test('con la búsqueda cerrada y respondida, sí', () => {
    expect(resuelta({ done: true })).toBe(true)
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

  test('una portada con `javascript:` no genera ningún atributo con ese valor', () => {
    const html = render(
      <ResultCard result={resultado('mio', 't1', 'Uno', { coverUrl: 'javascript:alert(1)' })} />,
    )

    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<img')
    // El hueco se ve igual: la tarjeta no se rompe por una dirección prohibida.
    expect(html).toContain('card__cover--vacia')
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

/**
 * El rastro de la búsqueda.
 *
 * El servidor anota en `search_history` la búsqueda que trae a una ficha, pero
 * sólo si la petición la lleva. Sin esto, `search_history` se quedaba vacía y el
 * motor no cambiaba con lo que se buscaba: con el historial de visionado vacío,
 * todos los candidatos puntuaban cero y el orden lo decidía sólo el desempate.
 */
describe('el rastro de la búsqueda', () => {
  const PIEZA_DE_ANILIST: DiscoverItem = {
    anilistId: 101922,
    title: 'Kimetsu no Yaiba',
    cover: '/api/anilist/image/cover/101922',
    adult: false,
    year: 2019,
    format: 'TV',
  }

  test('la tarjeta lleva la consulta en la dirección de la ficha', () => {
    const html = render(<ResultCard result={resultado('mio', 't1', 'Uno')} consulta="aurora" />)

    expect(html).toContain('href="/anime/mio/t1?q=aurora"')
  })

  test('sin consulta la ficha se abre como siempre', () => {
    const html = render(<ResultCard result={resultado('mio', 't1', 'Uno')} />)

    expect(html).not.toContain('?q=')
  })

  test('la tarjeta del catálogo también lo deja, y sólo si abre una ficha', () => {
    const conFicha = render(
      <AniListCard
        item={{ ...PIEZA_DE_ANILIST, ref: { providerId: 'jkanime', value: 'kimetsu' } }}
        consulta="kimetsu"
      />,
    )

    expect(conFicha).toContain('href="/anime/jkanime/kimetsu?q=kimetsu"')
    // La que no está en ninguna fuente lleva a la búsqueda de su título, que ya
    // trae su propia consulta: pegarle otra dejaría dos `q` en la misma dirección.
    expect(render(<AniListCard item={PIEZA_DE_ANILIST} consulta="kimetsu" />)).toContain(
      'href="/search?q=Kimetsu%20no%20Yaiba"',
    )
  })
})

describe('rejilla y estado vacío', () => {
  test('lista los resultados en una lista con nombre accesible', () => {
    const html = render(
      <ResultGrid
        query="uno"
        results={[resultado('mio', 't1', 'Uno'), resultado('otro', 't2', 'Dos')]}
        done
      />,
    )

    expect(html).toContain('<ul class="grid" aria-label="Resultados"')
    expect(html.match(/<li class="grid__item"/g)).toHaveLength(2)
    expect(html).toContain('href="/anime/otro/t2?q=uno"')
  })

  test('dos proveedores con la misma obra pintan una tarjeta, con la otra fuente enlazada', () => {
    const html = render(
      <ResultGrid
        query="kimetsu"
        results={[
          resultado('jkanime', 'kimetsu', 'Kimetsu no Yaiba'),
          resultado('animeav1', 'kimetsu-no-yaiba', 'Kimetsu no Yaiba'),
        ]}
        providerLabels={
          new Map([
            ['jkanime', 'JKANIME'],
            ['animeav1', 'ANIMEAV1'],
          ])
        }
        done
      />,
    )

    // Un `<li>` por obra: dos tarjetas idénticas son el contenido repetido que
    // se reportó. La mutación que quite la agrupación de `ResultGrid` deja esto
    // en rojo con dos.
    expect(html.match(/<li class="grid__item"/g)).toHaveLength(1)
    // Las dos direcciones —la de la tarjeta y la de «También en»— dejan el
    // rastro de la búsqueda: abrir la ficha desde cualquiera de las dos es lo
    // mismo para el motor.
    expect(html).toContain('href="/anime/jkanime/kimetsu?q=kimetsu"')
    expect(html).toContain('href="/anime/animeav1/kimetsu-no-yaiba?q=kimetsu"')
    expect(html).toContain('También en')
    expect(html).toContain('>ANIMEAV1</a>')
  })

  test('sin duplicados no aparece el «también en»', () => {
    const html = render(<ResultGrid query="uno" results={[resultado('mio', 't1', 'Uno')]} done />)

    expect(html).not.toContain('También en')
    expect(html).not.toContain('card__extra')
  })

  /**
   * La prioridad de los ajustes elige **cuál** de las fuentes da la tarjeta; la
   * otra sigue en «También en». Mutar `ResultGrid` para no pasar la prioridad a
   * `groupResults` deja esta prueba en rojo: la tarjeta se quedaría con `jkanime`,
   * que es el primero que respondió.
   */
  test('la tarjeta lleva al proveedor preferido, y el otro sigue en «También en»', () => {
    const html = render(
      <ResultGrid
        query="kimetsu"
        results={[
          resultado('jkanime', 'kimetsu', 'Kimetsu no Yaiba'),
          resultado('animeav1', 'kimetsu-no-yaiba', 'Kimetsu no Yaiba'),
        ]}
        providerPriority={['animeav1']}
        done
      />,
    )

    // El primer enlace de la rejilla es la tarjeta; el `href` va antes que la
    // clase, así que se corta desde la etiqueta y no desde `class="card"`.
    const carta = html.indexOf('<a ')
    const enlace = html.slice(carta, html.indexOf('</a>', carta))

    expect(enlace).toContain('href="/anime/animeav1/kimetsu-no-yaiba?q=kimetsu"')
    expect(html).toContain('También en')
    expect(html).toContain('>jkanime</a>')
  })

  test('sin resultados dice qué consulta no encontró nada', () => {
    const html = render(<ResultGrid query="xyz" results={[]} done />)

    expect(html).toContain('Nada coincide')
    expect(html).toContain('xyz')
    expect(html).not.toContain('<ul')
  })

  /**
   * El renglón que se leyó como respuesta. La pantalla se abría diciendo «Nada
   * coincide con «…»» a la vez que «Buscando…», y quien llegaba desde un enlace
   * —la tarjeta de un género, una pieza de la vitrina sin ficha local— se iba
   * creyendo que su título no existía en ninguna fuente. Quitar la guarda de
   * `done` deja esto en rojo.
   */
  test('mientras busca no dice que no haya nada', () => {
    const html = render(<ResultGrid query="xyz" results={[]} done={false} />)

    expect(html).not.toContain('Nada coincide')
    expect(html).not.toContain('Escribe un título')
    expect(html).toBe('')
  })

  test('sin consulta explica que hay que escribir algo', () => {
    const html = render(<ResultGrid query="" results={[]} done />)

    expect(html).toContain('Escribe un título')
  })

  /**
   * El caso de una búsqueda por género, que es el que trajo la búsqueda cruzada:
   * las fuentes no encuentran nada —ninguna busca por género— y AniList sí tiene
   * su lista. Decir «nada coincide» ahí contradice la sección que está debajo.
   */
  test('con la lista de AniList debajo no dice que no haya nada', () => {
    const html = render(<ResultGrid query="Acción" results={[]} done hayAniList />)

    expect(html).not.toContain('Nada coincide')
    expect(html).toBe('')
  })

  test('sin lista de AniList sí lo dice: entonces es verdad', () => {
    const html = render(<ResultGrid query="xyz" results={[]} done />)

    expect(html).toContain('Nada coincide')
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
  /**
   * El caso del usuario, en el primer render: se abre `/search?q=<título>` desde
   * otra pantalla y la búsqueda todavía no ha preguntado a nadie. Antes decía
   * «Nada coincide con «…»» en ese mismo instante; la medición de que ya no lo
   * dice es esta. Mutar la guarda de `done` la deja en rojo.
   */
  test('abrir una búsqueda no afirma que no haya nada antes de buscar', () => {
    const html = pagina('/search?q=Tokyo%20Revengers%3A%20Santen%20Sensou-hen')

    expect(html).toContain('value="Tokyo Revengers: Santen Sensou-hen"')
    expect(html).toContain('Buscando')
    expect(html).not.toContain('Nada coincide')
  })

  /**
   * El hueco entre «Buscando…» y la primera respuesta de proveedores.
   *
   * Antes de que `/api/providers` llegue no hay un `pending` por proveedor del que
   * colgar la rejilla, y la pantalla se quedaba sólo con una frase. La rejilla de
   * espera existe para que se vea que la búsqueda está trabajando.
   */
  test('sin saber qué proveedores hay, la búsqueda ya enseña esqueletos', () => {
    const html = pagina('/search?q=naruto')

    expect(html.match(/class="skeleton"/g)?.length).toBe(4)
  })
})

/**
 * La búsqueda cruzada, en la página.
 *
 * Es la mitad que las fuentes no pueden contestar: de un estudio o de un género,
 * AniList sí tiene la lista, y la lista se cruza con lo que hay en los proveedores
 * —cada pieza dice si está y abre su ficha cuando la tiene—. Lo que se mide aquí
 * es ese cruce y el estado que lo guarda, no el pintado del mosaico, que es el de
 * siempre.
 */
describe('lo que AniList tiene del término', () => {
  const DE_ANILIST: DiscoverItem = {
    anilistId: 16498,
    title: 'Shingeki no Kyojin',
    cover: '/api/anilist/image/cover/16498',
    adult: false,
    year: 2013,
  }

  test('una pieza que la base conoce abre su ficha y lleva el sello', () => {
    const html = render(
      <AniListResults
        items={[{ ...DE_ANILIST, ref: { providerId: 'jkanime', value: 'shingeki' } }]}
        query="Action"
      />,
    )

    // La consulta viaja con la ficha para que el servidor deje el rastro que el
    // motor usa: sin ella, buscar no cambiaba ninguna recomendación.
    expect(html).toContain('href="/anime/jkanime/shingeki?q=Action"')
    expect(html).toContain('En AniList')
    expect(html).toContain('En tus fuentes')
  })

  test('una que ninguna fuente tiene lleva a la búsqueda de su título, y sin sello', () => {
    const html = render(<AniListResults items={[DE_ANILIST]} query="Action" />)

    // La salida honesta: no hay ficha que abrir, así que se busca el título.
    expect(html).toContain(`href="${searchPath('Shingeki no Kyojin')}"`)
    expect(html).not.toContain('En tus fuentes')
  })

  test('el sello no se le pone a la pieza que sólo está en AniList', () => {
    // Es la medición del cruce: si el sello se pintara por estar en la lista y no
    // por tener referencia local, diría que una fuente la tiene cuando no la tiene.
    const html = render(
      <AniListResults
        items={[
          DE_ANILIST,
          { ...DE_ANILIST, anilistId: 20, title: 'Naruto', ref: { providerId: 'mio', value: 'n' } },
        ]}
        query="Action"
      />,
    )

    expect(html.match(/En tus fuentes/g)).toHaveLength(1)
  })

  test('sin nada de AniList no se pinta la sección', () => {
    expect(render(<AniListResults items={[]} query="Action" />)).toBe('')
  })

  test('el estado guarda la lista y la sustituye cuando llega la del término siguiente', () => {
    const conLista = reduce(initialState([]), { type: 'anilist', items: [DE_ANILIST] })

    expect(conLista.anilist).toHaveLength(1)
    // Sustituir y no acumular: la lista es la del término que se está buscando.
    expect(reduce(conLista, { type: 'anilist', items: [] }).anilist).toEqual([])
  })

  test('el anuncio cuenta también las piezas de AniList', () => {
    // El caso que importa: una búsqueda por género sin nada en los proveedores.
    // Anunciar «0 resultados» con veinte piezas en pantalla es mentir a quien no
    // ve la pantalla.
    const estado = reduce(
      { ...initialState(['uno']), done: true },
      {
        type: 'anilist',
        items: [DE_ANILIST],
      },
    )

    expect(announce(estado, ['uno'])).toContain('0 resultados')
    expect(announce(estado, ['uno'])).toContain('1 en AniList')
  })

  test('con un género, el anuncio cuenta el catálogo y no unos proveedores que no se preguntaron', () => {
    const estado = reduce(
      { ...initialState(['uno']), done: true },
      {
        type: 'anilist',
        items: [DE_ANILIST],
      },
    )

    expect(announce(estado, ['uno'], true, true)).toBe('1 título en el catálogo.')
    expect(announce(estado, ['uno'], true, true)).not.toContain('proveedores')
  })
})

/**
 * La lista del catálogo pintada como los resultados de la página.
 *
 * Lo que se mide es el diseño y el destino: la tarjeta es la misma `card` de los
 * resultados —no la pieza del mosaico—, **sin sello**, y el enlace lleva a la ficha
 * cuando la base conoce la obra y a la búsqueda de su título cuando no.
 */
describe('las tarjetas del catálogo', () => {
  const PIEZA: DiscoverItem = {
    anilistId: 101922,
    title: 'Kimetsu no Yaiba',
    cover: '/api/anilist/image/cover/101922',
    adult: false,
    year: 2019,
    format: 'TV',
  }

  test('la tarjeta es la de los resultados, con su portada local y su pie', () => {
    const html = render(<AniListCard item={PIEZA} />)

    expect(html).toContain('class="card"')
    expect(html).toContain('card__cover')
    expect(html).toContain('card__title')
    expect(html).toContain('/api/anilist/image/cover/101922')
    expect(html).toContain('Kimetsu no Yaiba')
    // La misma marca de año que la tarjeta de un proveedor.
    expect(html).toContain('Año 2019')
  })

  test('no lleva sello: el enlace ya dice lo que hay', () => {
    const conFicha = render(
      <AniListCard item={{ ...PIEZA, ref: { providerId: 'jkanime', value: 'kimetsu' } }} />,
    )

    expect(conFicha).not.toContain('badge')
    expect(conFicha).not.toContain('Origen:')
    expect(conFicha).not.toContain('En tus fuentes')
  })

  test('una obra que la base conoce abre su ficha; la que no, la búsqueda de su título', () => {
    expect(
      render(<AniListCard item={{ ...PIEZA, ref: { providerId: 'jkanime', value: 'kimetsu' } }} />),
    ).toContain('href="/anime/jkanime/kimetsu"')
    expect(render(<AniListCard item={PIEZA} />)).toContain('href="/search?q=Kimetsu%20no%20Yaiba"')
  })

  test('la rejilla usa la lista de resultados de la página, no el mosaico', () => {
    const html = render(<AniListCards items={[PIEZA]} query="#aventura" done />)

    expect(html).toContain('class="grid"')
    expect(html).not.toContain('mosaico')
    expect(html).toContain('aria-label="Resultados"')
  })

  test('sin nada y con la búsqueda cerrada lo dice; mientras busca, no', () => {
    expect(render(<AniListCards items={[]} query="#aventura" done={false} />)).toBe('')
    expect(render(<AniListCards items={[]} query="#aventura" done />)).toContain(
      'Nada en el catálogo coincide',
    )
  })
})
