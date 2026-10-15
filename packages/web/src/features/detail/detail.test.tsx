import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Enrichment, WatchedEpisodePayload } from '@nn-anime/core/api'
import type {
  AnimeDetail,
  AnimeSummary,
  Episode,
  ProviderCapabilities,
} from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { createMemoryHistory, HistoryProvider } from '../../router'
import {
  BandaBanner,
  DetailPage,
  estudios,
  fondoDe,
  generos,
  seccionesDe,
  sinopsis,
} from './DetailPage'
import { EpisodeRows } from './EpisodeList'
import { watchedInWindow, windowAt, windowCount, windowForNumber } from './episode-window'
import { FavoriteButton } from './FavoriteButton'
import { RelatedList } from './RelatedList'
import { SagaRail, sagaGroups } from './SagaRail'
import { SourcePicker } from './SourcePicker'
import {
  chosenMode,
  formatDuration,
  isFavorite,
  modesFor,
  relatedPath,
  sourcesPath,
  watchedPercent,
} from './useDetail'

const ROOT = fileURLToPath(new URL('.', import.meta.url))

function render(node: ReactNode): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory('/anime/fixture/aurora-nocturna')}>
      {node}
    </HistoryProvider>,
  )
}

function capacidades(overrides: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
  // `feed` va después del spread y con su valor por defecto: si quedara dentro
  // del objeto base, el spread lo volvería opcional y el tipo dejaría de cumplir.
  return {
    search: true,
    sub: true,
    dub: false,
    trending: false,
    ...overrides,
    feed: overrides.feed ?? false,
  }
}

function episodio(numero: number, overrides: Partial<Episode> = {}): Episode {
  return {
    ref: { providerId: 'fixture', value: `aurora-nocturna#${numero}` },
    animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
    number: numero,
    title: `Episodio ${numero}`,
    durationS: 1440,
    mode: 'sub',
    ...overrides,
  }
}

describe('modos disponibles', () => {
  test('sin capacidades no se ofrece ninguno', () => {
    expect(modesFor(undefined)).toEqual([])
  })

  test('se ofrecen los que el proveedor declara', () => {
    expect(modesFor(capacidades())).toEqual(['sub'])
    expect(modesFor(capacidades({ dub: true }))).toEqual(['sub', 'dub'])
    expect(modesFor(capacidades({ sub: false, dub: true }))).toEqual(['dub'])
  })
})

describe('el modo con el que se reproduce', () => {
  test('manda el elegido, si está disponible', () => {
    expect(chosenMode(['sub', 'dub'], 'dub')).toBe('dub')
    expect(chosenMode(['sub'], 'sub')).toBe('sub')
  })

  test('sin elección, el primero que ofrece el proveedor', () => {
    expect(chosenMode(['dub', 'sub'], undefined)).toBe('dub')
    expect(chosenMode(['sub'], undefined)).toBe('sub')
  })

  test('una elección que el proveedor no ofrece se ignora', () => {
    expect(chosenMode(['sub'], 'dub')).toBe('sub')
  })

  test('sin ningún modo disponible no hay modo', () => {
    expect(chosenMode([], 'dub')).toBeUndefined()
  })
})

describe('duración legible', () => {
  test('minutos y horas', () => {
    expect(formatDuration(1440)).toBe('24 min')
    expect(formatDuration(5400)).toBe('1 h 30 min')
  })

  test('sin duración o con cero, no se inventa nada', () => {
    expect(formatDuration(undefined)).toBeUndefined()
    expect(formatDuration(0)).toBeUndefined()
    expect(formatDuration(-5)).toBeUndefined()
  })
})

describe('lista de episodios', () => {
  test('numera, titula, dura y dice el modo', () => {
    const html = render(<EpisodeRows episodes={[episodio(1), episodio(2, { mode: 'dub' })]} />)

    expect(html).toContain('<ol class="episodes"')
    expect(html).toContain('Episodio 1')
    expect(html).toContain('24 min')
    expect(html).toContain('subtitulado')
    expect(html).toContain('doblado')
  })

  test('sin episodios lo dice, en lugar de dejar la lista vacía', () => {
    const html = render(<EpisodeRows episodes={[]} />)

    expect(html).toContain('no tiene episodios')
    expect(html).not.toContain('<ol')
  })

  /**
   * La ficha es la puerta del reproductor.
   *
   * Sin esto, la pantalla enseñaba cuántos episodios hay y no dejaba abrir
   * ninguno: el reproductor existía y no había forma de llegar a él salvo
   * escribiendo la dirección a mano.
   */
  test('cada episodio enlaza con el reproductor', () => {
    const html = render(<EpisodeRows episodes={[episodio(1), episodio(2)]} />)

    // El número viaja en la dirección: es lo que deja al reproductor pedir los
    // vecinos con dos lecturas puntuales en vez de con la lista entera.
    expect(html).toContain(
      'href="/watch/fixture/aurora-nocturna%231?anime=aurora-nocturna&amp;n=1"',
    )
    expect(html).toContain(
      'href="/watch/fixture/aurora-nocturna%232?anime=aurora-nocturna&amp;n=2"',
    )
  })

  /**
   * El título viaja con el enlace, no se adivina.
   *
   * La referencia de jkanime numera con barra —`dandadan/12`— y `animeRefOf`
   * cortaba sólo por la almohadilla: el enlace pedía la ficha de `dandadan/12` y
   * el proveedor devolvía la página del episodio, que quedaba escrita en la base
   * como si fuera un título.
   */
  test('el título viaja aunque la referencia del episodio no lo delate', () => {
    const html = render(
      <EpisodeRows
        episodes={[
          episodio(12, {
            ref: { providerId: 'jkanime', value: 'dandadan/12' },
            animeRef: { providerId: 'jkanime', value: 'dandadan' },
          }),
        ]}
      />,
    )

    expect(html).toContain('href="/watch/jkanime/dandadan%2F12?anime=dandadan&amp;n=12"')
  })

  test('el modo elegido viaja en el enlace', () => {
    const html = render(<EpisodeRows episodes={[episodio(1)]} mode="dub" />)

    expect(html).toContain(
      'href="/watch/fixture/aurora-nocturna%231?mode=dub&amp;anime=aurora-nocturna&amp;n=1"',
    )
  })

  test('con total, la fila dice de cuántos', () => {
    const html = render(<EpisodeRows episodes={[episodio(12)]} total={26} />)

    expect(html).toContain('Episodio 12 de 26')
  })

  test('sin total, la fila sólo dice el número: no se inventa el de cuántos', () => {
    const html = render(<EpisodeRows episodes={[episodio(12)]} />)

    expect(html).toContain('Episodio 12')
    expect(html).not.toContain('de 26')
  })

  test('un episodio sin título ni duración no rompe la fila', () => {
    const html = render(
      <EpisodeRows
        episodes={[
          {
            ref: { providerId: 'fixture', value: 'x#1' },
            animeRef: { providerId: 'fixture', value: 'x' },
            number: 1,
            mode: 'sub',
          },
        ]}
      />,
    )

    expect(html).toContain('Episodio 1')
    expect(html).not.toContain('episode__title')
  })
})

describe('las ventanas de la lista larga', () => {
  /** Mil ciento ochenta episodios, que es One Piece, y los que hagan falta. */
  function saga(cuantos: number): readonly Episode[] {
    return Array.from({ length: cuantos }, (_, indice) => episodio(indice + 1))
  }

  function visto(numero: number, finished: boolean): WatchedEpisodePayload {
    return {
      number: numero,
      mode: 'sub',
      positionS: finished ? 1440 : 576,
      durationS: 1440,
      ratio: finished ? 1 : 0.4,
      finished,
      watchedAt: '2026-10-12T10:00:00.000Z',
    }
  }

  test('cien por ventana, y la última se corta donde acaba la lista', () => {
    expect(windowAt(0, 1180)).toEqual({ start: 0, end: 100 })
    expect(windowAt(11, 1180)).toEqual({ start: 1100, end: 1180 })
    expect(windowCount(1180)).toBe(12)
  })

  test('un índice fuera de rango cae al extremo, no deja la lista en blanco', () => {
    // La mutación que devuelva el trozo tal cual pide un índice negativo deja
    // `slice(-100, 0)` y la lista vacía.
    expect(windowAt(-3, 250)).toEqual({ start: 0, end: 100 })
    expect(windowAt(99, 250)).toEqual({ start: 200, end: 250 })
  })

  test('el salto va a la ventana del número pedido', () => {
    const numeros = saga(1180).map((episode) => episode.number)

    expect(windowForNumber(1, numeros)).toBe(0)
    expect(windowForNumber(100, numeros)).toBe(0)
    expect(windowForNumber(101, numeros)).toBe(1)
    expect(windowForNumber(1180, numeros)).toBe(11)
  })

  test('un número que no existe lleva a la última ventana, no a la primera', () => {
    const numeros = saga(1180).map((episode) => episode.number)

    // 1200 no está en una lista de 1180: la última ventana es lo más cerca que
    // se puede dejar a quien lo pidió.
    expect(windowForNumber(1200, numeros)).toBe(11)
    expect(windowForNumber(0, numeros)).toBe(0)
  })

  test('el resumen de vistos cuenta la ventana, no el título entero', () => {
    const window = windowAt(0, 1180)
    const numeros = saga(1180).map((episode) => episode.number)

    // El 900 está visto, pero no en la primera ventana: no cuenta.
    expect(
      watchedInWindow(window, numeros, [visto(5, true), visto(900, true), visto(7, false)]),
    ).toBe(1)
  })

  test('con mil ciento ochenta episodios se pintan cien filas y sus controles', () => {
    const html = render(<EpisodeRows episodes={saga(1180)} />)

    expect((html.match(/<li/g) ?? []).length).toBe(100)
    expect(html).toContain('Episodios 1–100')
    // La ventana se navega con «Siguientes», no con un salto: el salto por número
    // vive ahora en los mandos de la página, que preguntan al servidor.
    expect(html).toContain('Siguientes')
    // La numeración del documento sigue contando desde donde va la ventana.
    expect(html).toContain('start="1"')
  })

  test('con cien episodios o menos no hay controles', () => {
    const html = render(<EpisodeRows episodes={saga(100)} />)

    // La mutación que quite la condición pinta una barra de paginación para una
    // lista que cabe entera.
    expect(html).not.toContain('episodes__windows')
    expect((html.match(/<li/g) ?? []).length).toBe(100)
  })

  test('el resumen de la ventana sale en la banda', () => {
    const html = render(<EpisodeRows episodes={saga(1180)} watched={[visto(5, true)]} />)

    expect(html).toContain('1 de 100 vistos')
  })
})

describe('porcentaje visto', () => {
  test('redondea en vez de truncar: al 99,6 % la barra se ve llena', () => {
    expect(watchedPercent(0.5)).toBe(50)
    expect(watchedPercent(0.996)).toBe(100)
    expect(watchedPercent(1.5)).toBe(100)
    expect(watchedPercent(-1)).toBe(0)
    expect(watchedPercent(Number.NaN)).toBe(0)
  })
})

describe('episodios vistos', () => {
  function visto(
    numero: number,
    overrides: Partial<WatchedEpisodePayload> = {},
  ): WatchedEpisodePayload {
    return {
      number: numero,
      mode: 'sub',
      positionS: 576,
      durationS: 1440,
      ratio: 0.4,
      finished: false,
      watchedAt: '2026-10-12T10:00:00.000Z',
      ...overrides,
    }
  }

  test('el terminado lleva la palabra «visto», no sólo el color', () => {
    const html = render(
      <EpisodeRows episodes={[episodio(1)]} watched={[visto(1, { finished: true, ratio: 1 })]} />,
    )

    expect(html).toContain('episode--visto')
    expect(html).toContain('visto')
    expect(html).not.toContain('<progress')
  })

  test('el que está a medias lleva su barra con el porcentaje', () => {
    const html = render(<EpisodeRows episodes={[episodio(2)]} watched={[visto(2)]} />)

    expect(html).toContain('<progress')
    expect(html).toContain('Visto al 40 %')
    expect(html).not.toContain('episode--visto')
  })

  test('sin duración no hay barra ni marca: no se inventa la proporción', () => {
    const html = render(
      <EpisodeRows
        episodes={[episodio(3)]}
        watched={[visto(3, { durationS: 0, ratio: 0, positionS: 900 })]}
      />,
    )

    expect(html).not.toContain('<progress')
    expect(html).not.toContain('episode--visto')
  })

  test('sin visionados, la lista es la de siempre', () => {
    const html = render(<EpisodeRows episodes={[episodio(1)]} />)

    expect(html).not.toContain('<progress')
    expect(html).not.toContain('episode--visto')
  })

  /**
   * La marca es del episodio, no del par episodio y modo: verlo en subtitulado es
   * haberlo visto, y marcarlo por modo partiría en dos la misma fila.
   */
  test('el mismo número visto en sub se marca también con la lista en dub', () => {
    const html = render(
      <EpisodeRows
        episodes={[episodio(5, { mode: 'dub' })]}
        mode="dub"
        watched={[visto(5, { mode: 'sub', finished: true })]}
      />,
    )

    expect(html).toContain('episode--visto')
  })
})

describe('botón de favorito', () => {
  test('dice su estado con aria-pressed', () => {
    expect(render(<FavoriteButton value={false} onToggle={() => {}} />)).toContain(
      'aria-pressed="false"',
    )
    expect(render(<FavoriteButton value onToggle={() => {}} />)).toContain('aria-pressed="true"')
  })

  test('el texto cambia con el estado', () => {
    expect(render(<FavoriteButton value={false} onToggle={() => {}} />)).toContain(
      'Añadir a favoritos',
    )
    expect(render(<FavoriteButton value onToggle={() => {}} />)).toContain('Quitar de favoritos')
  })

  test('mientras guarda, se deshabilita', () => {
    expect(render(<FavoriteButton value={false} busy onToggle={() => {}} />)).toContain('disabled')
  })
})

/**
 * El botón nace marcado si el título ya estaba guardado.
 *
 * La comparación decide eso, y es lo que estaba mal: el estado inicial era
 * siempre «no está», así que el cartel de destacado negaba un favorito que la
 * fila de favoritos sí enseñaba. Se mide en la función pura porque el hook
 * necesita un navegador, y el caso de navegador es del e2e.
 */
describe('si el título ya está en favoritos', () => {
  function resumen(providerId: string, value: string): AnimeSummary {
    return { ref: { providerId, value }, title: value }
  }

  test('se compara la referencia entera, no sólo el valor', () => {
    const lista = [resumen('fixture', 'aurora-nocturna')]

    expect(isFavorite(lista, { providerId: 'fixture', value: 'aurora-nocturna' })).toBe(true)
    // Mismo valor en otro proveedor: son títulos distintos y no está guardado.
    expect(isFavorite(lista, { providerId: 'otro', value: 'aurora-nocturna' })).toBe(false)
    // Mismo proveedor y otro título.
    expect(isFavorite(lista, { providerId: 'fixture', value: 'otro-titulo' })).toBe(false)
  })

  test('sin lista no hay nada guardado', () => {
    expect(isFavorite([], { providerId: 'fixture', value: 'aurora-nocturna' })).toBe(false)
  })
})

describe('la ruta de los hermanos', () => {
  test('el alcance de la saga no se escribe; el de franquicia, sí', () => {
    // Sin el parámetro, la dirección es la de siempre: escribirla daría dos
    // claves de caché para la misma lectura.
    expect(relatedPath('jkanime', 'dandadan')).toBe('/api/anime/jkanime/dandadan/related')
    expect(relatedPath('jkanime', 'dandadan', 'franchise')).toBe(
      '/api/anime/jkanime/dandadan/related?scope=franchise',
    )
  })

  test('la referencia se escapa: puede llevar barra', () => {
    expect(relatedPath('jkanime', 'dandadan/12')).toContain('dandadan%2F12')
  })
})

describe('relacionados', () => {
  function resumen(value: string, title: string, year?: number): AnimeSummary {
    return { ref: { providerId: 'fixture', value }, title, ...(year === undefined ? {} : { year }) }
  }

  test('cada hermano es un enlace a su ficha, con su año', () => {
    const html = render(<RelatedList items={[resumen('frieren', 'Sousou no Frieren', 2023)]} />)

    expect(html).toContain('href="/anime/fixture/frieren"')
    expect(html).toContain('Sousou no Frieren')
    expect(html).toContain('Año 2023')
  })

  test('un relacionado sin año no se inventa uno', () => {
    const html = render(<RelatedList items={[resumen('x', 'Sin Año')]} />)

    expect(html).toContain('related__title')
    expect(html).not.toContain('related__meta')
  })

  test('sin hermanos lo dice en lugar de dejar el hueco', () => {
    const html = render(<RelatedList items={[]} />)

    expect(html).toContain('No hay más títulos de esta saga')
    expect(html).not.toContain('<ul')
  })

  test('una portada con esquema raro no se pide: el hueco se ve como hueco', () => {
    const html = render(
      <RelatedList
        items={[{ ...resumen('x', 'Raro'), coverUrl: 'javascript:alert(1)' } as AnimeSummary]}
      />,
    )

    expect(html).not.toContain('<img')
    expect(html).toContain('related__cover')
  })

  test('la entrega que se está viendo sale marcada y sin enlace', () => {
    const actual = resumen('dandadan', 'Dandadan', 2024)
    const html = render(
      <RelatedList
        items={[actual, resumen('dandadan-2', 'Dandadan 2nd Season', 2025)]}
        current={actual.ref}
      />,
    )

    // Sin enlace: la fila lleva a la ficha que ya se está leyendo.
    expect(html).not.toContain('href="/anime/fixture/dandadan"')
    expect(html).toContain('aria-current="page"')
    // Y lo dice con la palabra, no sólo con el color.
    expect(html).toContain('viendo')
    // La otra sigue siendo un enlace.
    expect(html).toContain('href="/anime/fixture/dandadan-2"')
  })

  test('la insignia la pone quien conoce el grupo', () => {
    const html = render(
      <RelatedList
        items={[resumen('frieren-2', 'Sousou no Frieren 2nd Season', 2026)]}
        badge={(item) => (item.year === 2026 ? 'Temporada 2' : undefined)}
      />,
    )

    expect(html).toContain('Temporada 2')
  })

  /**
   * El año y la insignia van juntos y **en su propio renglón**.
   *
   * Sueltos en el flujo del título, la barra lateral los parte: «Año 2025» rompe
   * por el espacio y el recuadro de «Temporada 2» se abre en dos renglones. Es el
   * fallo que se reportó con una captura de la ficha. El reparto de líneas no se
   * puede medir sin un navegador; lo que sí se mide aquí es la forma que lo
   * decide, y con ella el orden del marcado: los datos, después del título y
   * dentro de su grupo.
   */
  test('el año y la insignia van en su renglón, no en el del título', () => {
    const html = render(
      <RelatedList
        items={[resumen('darling-2', 'My Dress-Up Darling Season 2', 2025)]}
        badge={() => 'Temporada 2'}
      />,
    )

    const titulo = html.indexOf('related__title')
    const datos = html.indexOf('related__chips')
    const año = html.indexOf('related__meta')
    const insignia = html.indexOf('class="badge"')

    expect(titulo).toBeGreaterThan(-1)
    // El grupo de los datos existe y abre después del título: con el título
    // dentro, los tres comparten renglón y el año se parte a la mitad.
    expect(datos).toBeGreaterThan(titulo)
    expect(año).toBeGreaterThan(datos)
    expect(insignia).toBeGreaterThan(datos)
  })

  test('sin año ni insignia no queda un renglón de datos vacío', () => {
    const html = render(<RelatedList items={[resumen('x', 'Sin Año')]} />)

    // El grupo vacío no se pinta: con el `gap` de la columna, un hueco sin nada
    // dentro es un renglón de aire entre el título y el borde.
    expect(html).not.toContain('related__chips')
  })
})

describe('el rail de temporadas', () => {
  function entrega(
    value: string,
    title: string,
    year: number | undefined,
    kind: AnimeSummary['kind'],
  ): AnimeSummary {
    return {
      ref: { providerId: 'jkanime', value },
      title,
      ...(year === undefined ? {} : { year }),
      ...(kind === undefined ? {} : { kind }),
    }
  }

  const DANDADAN = entrega('dandadan', 'Dandadan', 2024, 'tv')
  const DANDADAN_2 = entrega('dandadan-2', 'Dandadan 2nd Season', 2025, 'tv')

  test('las temporadas van en orden y la actual está entre ellas', () => {
    const grupos = sagaGroups({ current: DANDADAN, siblings: [DANDADAN_2], franchise: [] })

    // La mutación que deje fuera la entrega actual devuelve una sola fila y deja
    // esta prueba en rojo: sin ella no se sabe en qué temporada se está.
    expect(grupos.seasons.map((item) => item.ref.value)).toEqual(['dandadan', 'dandadan-2'])
    expect(grupos.movies).toEqual([])
  })

  test('el orden es por año, y sin año la fila va al final', () => {
    const sinAño = entrega('bleach-ttbw', 'Bleach: Sennen Kessen-hen', undefined, 'tv')
    const grupos = sagaGroups({
      current: entrega('bleach', 'Bleach', 2004, 'tv'),
      siblings: [sinAño, entrega('bleach-ketsubetsu', 'Bleach: Ketsubetsu-tan', 2023, 'tv')],
      franchise: [],
    })

    expect(grupos.seasons.map((item) => item.ref.value)).toEqual([
      'bleach',
      'bleach-ketsubetsu',
      'bleach-ttbw',
    ])
  })

  test('las películas y los especiales van en su grupo, no intercalados', () => {
    const pelicula = entrega('bleach-movie', 'Bleach Movie 3: Fade to Black', 2008, 'movie')
    const especial = entrega('bleach-special', 'Bleach: Memories in the Rain', 2004, 'special')
    const grupos = sagaGroups({
      current: entrega('bleach', 'Bleach', 2004, 'tv'),
      siblings: [
        pelicula,
        especial,
        entrega('bleach-ttbw', 'Bleach: Sennen Kessen-hen', 2022, 'tv'),
      ],
      franchise: [],
    })

    // La mutación que clasifique todo como serie mete las tres en Temporadas.
    expect(grupos.seasons.map((item) => item.ref.value)).toEqual(['bleach', 'bleach-ttbw'])
    expect(grupos.movies.map((item) => item.ref.value)).toEqual(['bleach-special', 'bleach-movie'])
  })

  test('la franquicia no repite lo que ya está en las temporadas', () => {
    const naruto = entrega('naruto', 'Naruto', 2002, 'tv')
    const shippuden = entrega('naruto-shippuden', 'Naruto Shippuden', 2007, 'tv')
    const grupos = sagaGroups({
      current: naruto,
      // La franquicia contiene a la saga: la misma entrega llega en las dos listas.
      siblings: [shippuden],
      franchise: [naruto, shippuden, entrega('boruto', 'Boruto', 2017, 'tv')],
    })

    // La mutación que no filtre deja «Naruto» y «Naruto Shippuden» repetidos.
    expect(grupos.franchise.map((item) => item.ref.value)).toEqual(['boruto'])
  })

  test('sin ninguna entrega más, el hueco se explica', () => {
    const html = render(<SagaRail current={DANDADAN} siblings={[]} franchise={[DANDADAN]} />)

    expect(html).toContain('No hay más títulos de esta saga')
    expect(html).not.toContain('<ul')
  })

  test('con dos temporadas, cada grupo tiene su titular', () => {
    const html = render(
      <SagaRail
        current={DANDADAN}
        siblings={[DANDADAN_2, entrega('dandadan-movie', 'Dandadan Movie', 2025, 'movie')]}
        franchise={[]}
      />,
    )

    expect(html).toContain('Temporadas')
    expect(html).toContain('Películas y especiales')
    expect(html).toContain('Temporada 2')
    expect(html).toContain('viendo')
    // La franquicia no aporta nada nuevo: su sección no se pinta.
    expect(html).not.toContain('Más de esta franquicia')
  })

  test('la franquicia se pinta cuando aporta una entrega nueva', () => {
    const html = render(
      <SagaRail
        current={entrega('naruto', 'Naruto', 2002, 'tv')}
        siblings={[]}
        franchise={[entrega('naruto-shippuden', 'Naruto Shippuden', 2007, 'tv')]}
      />,
    )

    expect(html).toContain('Más de esta franquicia')
    expect(html).toContain('Naruto Shippuden')
  })
})

describe('las otras fuentes de la misma obra', () => {
  const OTRA: AnimeSummary = {
    ref: { providerId: 'animeav1', value: 'aurora-nocturna' },
    title: 'Aurora Nocturna',
    year: 2019,
  }

  test('nombra la otra fuente y enlaza su ficha', () => {
    const html = render(
      <SourcePicker
        items={[OTRA]}
        current="fixture"
        providerLabels={new Map([['animeav1', 'AnimeAV1']])}
      />,
    )

    expect(html).toContain('También en')
    expect(html).toContain('>AnimeAV1</a>')
    // El enlace lleva a la ficha de **esa** fuente, con su referencia: la obra no
    // se fusiona y el reproductor de destino es el suyo.
    expect(html).toContain('href="/anime/animeav1/aurora-nocturna"')
    // El nombre visible es lo que se lee; el título del enlace dice de qué obra es.
    expect(html).toContain('Aurora Nocturna en AnimeAV1')
  })

  test('sin nombre declarado se usa el id, no un hueco', () => {
    const html = render(
      <SourcePicker items={[OTRA]} current="fixture" providerLabels={new Map()} />,
    )

    expect(html).toContain('>animeav1</a>')
  })

  test('sin otras fuentes la sección no se pinta', () => {
    const html = render(<SourcePicker items={[]} current="fixture" providerLabels={new Map()} />)

    // Ni un titular vacío: una ficha sin nada que elegir no tiene una sección.
    expect(html).toBe('')
  })

  test('la fuente que se está viendo no se lista, aunque llegue en la respuesta', () => {
    const propia: AnimeSummary = {
      ref: { providerId: 'fixture', value: 'aurora-nocturna' },
      title: 'Aurora Nocturna',
      year: 2019,
    }

    // El servidor ya la excluye; si algún día dejara de hacerlo, un enlace a la
    // misma ficha que se está leyendo no puede aparecer.
    const html = render(
      <SourcePicker items={[propia]} current="fixture" providerLabels={new Map()} />,
    )

    expect(html).toBe('')
  })

  test('la referencia de la otra fuente viaja codificada en la ruta', () => {
    // jkanime numera con barra y sin escapar la ruta se parte en trozos.
    expect(sourcesPath('jkanime', 'dandadan/12')).toBe('/api/anime/jkanime/dandadan%2F12/sources')
  })
})

describe('pantalla de detalle', () => {
  test('el primer render es el esqueleto, sin depender de la red', () => {
    const html = render(<DetailPage providerId="fixture" ref="aurora-nocturna" />)

    expect(html).toContain('Cargando la ficha')
    expect(html).toContain('aria-busy="true"')
  })

  test('ningún dato de proveedor se inserta como HTML', async () => {
    const fuentes = await Promise.all(
      [
        'DetailPage.tsx',
        'EpisodeList.tsx',
        'FavoriteButton.tsx',
        'RelatedList.tsx',
        'useDetail.ts',
      ].map((archivo) => readFile(`${ROOT}${archivo}`, 'utf8')),
    )

    // Se quitan los comentarios antes de mirar: nombrar la función para decir
    // que no se usa es lo correcto, y una comprobación textual que lo confunda
    // con usarla obliga a escribir peor los comentarios.
    for (const fuente of fuentes) {
      const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

      expect(codigo).not.toContain('dangerouslySetInnerHTML')
      expect(codigo).not.toContain('innerHTML')
    }
  })
})

describe('lo que añade AniList', () => {
  const detalle: AnimeDetail = {
    ref: { providerId: 'fixture', value: 'aurora-nocturna' },
    title: 'Aurora Nocturna',
    genres: [],
    studios: [],
  }

  const enriquecido: Enrichment = {
    anilistId: 555,
    cover: '/api/anilist/image/cover/555',
    synopsis: 'Una cartógrafa recorre el cielo.',
    genres: ['Misterio'],
    studios: ['Estudio Cobre'],
    score: 84,
    year: 2019,
    status: 'finished',
    siteUrl: 'https://anilist.co/anime/555',
  }

  test('la sinopsis del proveedor manda y la de AniList llena el vacío', () => {
    expect(sinopsis(detalle, enriquecido)).toBe('Una cartógrafa recorre el cielo.')
    expect(sinopsis({ ...detalle, synopsis: 'La de la fuente.' }, enriquecido)).toBe(
      'La de la fuente.',
    )
    expect(sinopsis(detalle, null)).toBeUndefined()
  })

  test('los géneros y los estudios de la fuente mandan; AniList completa', () => {
    expect(generos(detalle, enriquecido)).toEqual(['Misterio'])
    expect(generos({ ...detalle, genres: ['Acción'] }, enriquecido)).toEqual(['Acción'])
    expect(estudios(detalle, enriquecido)).toEqual(['Estudio Cobre'])
    expect(estudios({ ...detalle, studios: ['Otro'] }, enriquecido)).toEqual(['Otro'])
  })

  test('sin emparejamiento no se pinta nada nuevo', () => {
    expect(seccionesDe(null)).toBeNull()
    expect(seccionesDe(undefined)).toBeNull()
  })

  test('con emparejamiento salen la nota, el estado y el enlace', () => {
    const html = render(seccionesDe(enriquecido))

    expect(html).toContain('De AniList')
    expect(html).toContain('Nota 84/100')
    expect(html).toContain('terminado')
    expect(html).toContain('href="https://anilist.co/anime/555"')
    expect(html).toContain('rel="noreferrer noopener"')
  })

  test('un próximo capítulo se anuncia con su fecha', () => {
    const html = render(
      seccionesDe({
        ...enriquecido,
        nextEpisode: { number: 12, airingAt: new Date(2026, 9, 20, 20, 30).toISOString() },
      }),
    )

    expect(html).toContain('Próximo capítulo')
    expect(html).toContain('12')
  })
})

/**
 * La ruta del banner, sólo si es la del servidor.
 *
 * El dato llega por HTTP, y la capa del fondo se compone con él: sin esta
 * comprobación, una ruta con comillas cerraría el `url()` y metería otra imagen.
 * No pasa por `isSafeUrl` —que sólo admite direcciones absolutas y rechazaría la
 * ruta local que el servidor compone— sino por la forma exacta de esa ruta.
 */
describe('la ruta del banner de AniList', () => {
  const enriquecido: Enrichment = {
    anilistId: 555,
    cover: '/api/anilist/image/cover/555',
    genres: [],
    studios: [],
    siteUrl: 'https://anilist.co/anime/555',
  }

  test('se acepta la que compone el servidor para un banner', () => {
    expect(fondoDe({ ...enriquecido, banner: '/api/anilist/image/banner/182255' })).toBe(
      '/api/anilist/image/banner/182255',
    )
  })

  test('sin banner, o sin emparejamiento, no hay fondo', () => {
    expect(fondoDe(enriquecido)).toBeUndefined()
    expect(fondoDe(null)).toBeUndefined()
    expect(fondoDe(undefined)).toBeUndefined()
  })

  test('cualquier otra cosa no se pinta', () => {
    for (const banner of [
      'https://otro.example/banner.jpg',
      'javascript:alert(1)',
      '//otro.example/banner.jpg',
      '/api/anilist/image/cover/555',
      '/api/anilist/image/banner/0',
      '/api/anilist/image/banner/555"',
      '/api/anilist/image/banner/../../etc',
    ]) {
      expect(fondoDe({ ...enriquecido, banner }), banner).toBeUndefined()
    }
  })
})

/**
 * La banda del banner.
 *
 * La imagen dejó de ser un `<img>` del flujo —el que dejaba el icono de imagen
 * rota cuando la obra no tenía banner o la caché todavía no lo servía— y pasó a
 * ser el fondo de la cabecera. Aquí se mide la forma del marcado: que se vea, y
 * con qué contraste, es del e2e y de `a11y.test.ts`.
 */
describe('la banda del banner', () => {
  const detalle: AnimeDetail = {
    ref: { providerId: 'fixture', value: 'aurora-nocturna' },
    title: 'Aurora Nocturna',
    titleAlt: 'Aurora Nocturna: el cielo a pie',
    genres: [],
    studios: [],
    year: 2019,
    status: 'finished',
  }

  test('el título, el otro nombre y el año van dentro de la banda', () => {
    const html = render(<BandaBanner detail={detalle} fondo="/api/anilist/image/banner/555" />)

    const banda = html.indexOf('class="detail__banner"')
    const titulo = html.indexOf('<h1>Aurora Nocturna</h1>')
    const otro = html.indexOf('Aurora Nocturna: el cielo a pie')
    const anyo = html.indexOf('Año 2019')

    expect(banda).toBeGreaterThan(-1)
    expect(titulo).toBeGreaterThan(banda)
    expect(otro).toBeGreaterThan(titulo)
    expect(anyo).toBeGreaterThan(otro)
  })

  test('el banner entra como fondo, decorativo, y sin ninguna imagen que romper', () => {
    const html = render(<BandaBanner detail={detalle} fondo="/api/anilist/image/banner/555" />)

    const capa = /<span class="detail__banner-fondo"[^>]*>/.exec(html)?.[0] ?? ''

    expect(capa).toContain('banner/555')
    // Decorativa: no lleva texto y no se anuncia.
    expect(capa).toContain('aria-hidden="true"')
    // Y no queda ninguna imagen en el flujo: el navegador no pinta el icono de
    // imagen rota de un fondo que no carga.
    expect(html).not.toContain('<img')
  })

  test('sin banner la banda sigue: es la cabecera, no el adorno', () => {
    const html = render(<BandaBanner detail={detalle} />)

    expect(html).toContain('class="detail__banner"')
    expect(html).toContain('<h1>Aurora Nocturna</h1>')
    expect(html).not.toContain('detail__banner-fondo')
  })
})
