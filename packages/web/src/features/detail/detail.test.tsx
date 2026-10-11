import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { WatchedEpisodePayload } from '@nn-anime/core/api'
import type { AnimeSummary, Episode, ProviderCapabilities } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { DetailPage } from './DetailPage'
import { EpisodeList } from './EpisodeList'
import { FavoriteButton } from './FavoriteButton'
import { RelatedList } from './RelatedList'
import { chosenMode, formatDuration, isFavorite, modesFor, watchedPercent } from './useDetail'

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
    const html = render(<EpisodeList episodes={[episodio(1), episodio(2, { mode: 'dub' })]} />)

    expect(html).toContain('<ol class="episodes"')
    expect(html).toContain('Episodio 1')
    expect(html).toContain('24 min')
    expect(html).toContain('subtitulado')
    expect(html).toContain('doblado')
  })

  test('sin episodios lo dice, en lugar de dejar la lista vacía', () => {
    const html = render(<EpisodeList episodes={[]} />)

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
    const html = render(<EpisodeList episodes={[episodio(1), episodio(2)]} />)

    expect(html).toContain('href="/watch/fixture/aurora-nocturna%231?anime=aurora-nocturna"')
    expect(html).toContain('href="/watch/fixture/aurora-nocturna%232?anime=aurora-nocturna"')
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
      <EpisodeList
        episodes={[
          episodio(12, {
            ref: { providerId: 'jkanime', value: 'dandadan/12' },
            animeRef: { providerId: 'jkanime', value: 'dandadan' },
          }),
        ]}
      />,
    )

    expect(html).toContain('href="/watch/jkanime/dandadan%2F12?anime=dandadan"')
  })

  test('el modo elegido viaja en el enlace', () => {
    const html = render(<EpisodeList episodes={[episodio(1)]} mode="dub" />)

    expect(html).toContain(
      'href="/watch/fixture/aurora-nocturna%231?mode=dub&amp;anime=aurora-nocturna"',
    )
  })

  test('un episodio sin título ni duración no rompe la fila', () => {
    const html = render(
      <EpisodeList
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
      <EpisodeList episodes={[episodio(1)]} watched={[visto(1, { finished: true, ratio: 1 })]} />,
    )

    expect(html).toContain('episode--visto')
    expect(html).toContain('visto')
    expect(html).not.toContain('<progress')
  })

  test('el que está a medias lleva su barra con el porcentaje', () => {
    const html = render(<EpisodeList episodes={[episodio(2)]} watched={[visto(2)]} />)

    expect(html).toContain('<progress')
    expect(html).toContain('Visto al 40 %')
    expect(html).not.toContain('episode--visto')
  })

  test('sin duración no hay barra ni marca: no se inventa la proporción', () => {
    const html = render(
      <EpisodeList
        episodes={[episodio(3)]}
        watched={[visto(3, { durationS: 0, ratio: 0, positionS: 900 })]}
      />,
    )

    expect(html).not.toContain('<progress')
    expect(html).not.toContain('episode--visto')
  })

  test('sin visionados, la lista es la de siempre', () => {
    const html = render(<EpisodeList episodes={[episodio(1)]} />)

    expect(html).not.toContain('<progress')
    expect(html).not.toContain('episode--visto')
  })

  /**
   * La marca es del episodio, no del par episodio y modo: verlo en subtitulado es
   * haberlo visto, y marcarlo por modo partiría en dos la misma fila.
   */
  test('el mismo número visto en sub se marca también con la lista en dub', () => {
    const html = render(
      <EpisodeList
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
