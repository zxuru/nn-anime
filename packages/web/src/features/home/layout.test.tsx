import { describe, expect, test } from 'bun:test'
import type { RecommendationResponse } from '@nn-anime/core/api'
import type { AnimeSummary } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { PosterCard } from '../../components/PosterCard'
import { SectionHeader } from '../../components/SectionHeader'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { featuredMeta } from './FeaturedHero'
import { GenreRow, topGenres } from './GenreRow'
import { Ticker } from './Ticker'
import { TopFive } from './TopFive'

function render(node: ReactNode): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory('/')}>{node}</HistoryProvider>,
  )
}

function recomendacion(titulo: string, tags: readonly string[] = []): RecommendationResponse {
  return {
    ref: { providerId: 'fixture', value: titulo },
    title: titulo,
    score: 0.5,
    tags: [...tags],
    reason: { kind: 'popular', text: 'Es de lo más visto.' },
    reasons: [{ kind: 'popular', text: 'Es de lo más visto.' }],
  }
}

function resumen(titulo: string): AnimeSummary {
  return { ref: { providerId: 'fixture', value: titulo }, title: titulo }
}

describe('el titular de una fila', () => {
  test('lleva su etiqueta a la derecha', () => {
    const html = render(<SectionHeader title="Top 5" meta="Lo mejor para ti" />)

    expect(html).toContain('section__title')
    expect(html).toContain('Lo mejor para ti')
  })

  test('sin etiqueta no deja el hueco', () => {
    expect(render(<SectionHeader title="Sólo el título" />)).not.toContain('section__meta')
  })
})

describe('la tarjeta de una fila', () => {
  test('portada, título y pie', () => {
    const html = render(
      <PosterCard
        providerId="fixture"
        ref="aurora-nocturna"
        title="Aurora Nocturna"
        to="/anime/fixture/aurora-nocturna"
        caption="Quedan 12 min"
      />,
    )

    expect(html).toContain('src="/api/cover/fixture/aurora-nocturna"')
    expect(html).toContain('Aurora Nocturna')
    expect(html).toContain('Quedan 12 min')
  })

  test('el número del top va detrás del enlace, no dentro', () => {
    const html = render(<PosterCard providerId="f" ref="x" title="X" to="/anime/f/x" number={3} />)

    expect(html).toContain('poster__number')
    expect(html.indexOf('poster__number')).toBeLessThan(html.indexOf('poster__link'))
  })

  test('sin pie ni número no inventa nada', () => {
    const html = render(<PosterCard providerId="f" ref="x" title="X" to="/anime/f/x" />)

    expect(html).not.toContain('poster__meta')
    expect(html).not.toContain('poster__number')
    expect(html).not.toContain('<progress')
  })

  test('con progreso, la barra lleva su etiqueta accesible', () => {
    const html = render(
      <PosterCard
        providerId="f"
        ref="x"
        title="X"
        to="/anime/f/x"
        progress={40}
        progressLabel="Seguir en 12:00"
      />,
    )

    expect(html).toContain('value="40"')
    expect(html).toContain('aria-label="Seguir en 12:00"')
  })
})

describe('el top de la semana', () => {
  test('numera del uno al cinco', () => {
    const items = ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis'].map((t) => recomendacion(t))
    const html = render(<TopFive items={items} coldStart={false} />)

    expect(html.match(/poster__number/g)?.length).toBe(5)
    expect(html).not.toContain('seis')
  })

  test('cada uno lleva su motivo en el pie', () => {
    const html = render(<TopFive items={[recomendacion('uno')]} coldStart={false} />)

    expect(html).toContain('Es de lo más visto.')
  })

  test('sin historial lo dice en la etiqueta', () => {
    const html = render(<TopFive items={[recomendacion('uno')]} coldStart />)

    expect(html).toContain('Lo más visto del catálogo')
  })

  test('sin nada que recomendar lo explica', () => {
    expect(render(<TopFive items={[]} coldStart />)).toContain('Todavía no hay nada que recomendar')
  })
})

describe('la cinta', () => {
  test('sin títulos no se pinta', () => {
    expect(render(<Ticker items={[]} />)).toBe('')
  })

  test('con títulos, cada uno lleva a su ficha', () => {
    const html = render(<Ticker items={[resumen('Mar de Cristal')]} />)

    expect(html).toContain('ticker__label')
    expect(html).toContain('href="/anime/fixture/Mar%20de%20Cristal"')
  })
})

describe('los géneros', () => {
  test('se cuentan y se ordenan por los que más salen', () => {
    const generos = topGenres([['Acción', 'Fantasía'], ['Acción'], ['Drama']], 2)

    expect(generos).toEqual(['Acción', 'Drama'])
  })

  test('con el mismo número, el orden es alfabético y no el de llegada', () => {
    expect(topGenres([['B'], ['A']], 2)).toEqual(['A', 'B'])
  })

  test('sin tags no hay géneros', () => {
    expect(topGenres([[], []], 5)).toEqual([])
  })

  test('cada género lleva a su búsqueda', () => {
    const html = render(<GenreRow genres={['Acción']} />)

    expect(html).toContain('href="/search?q=Acci%C3%B3n"')
  })

  test('sin géneros lo explica en vez de dejar la lista vacía', () => {
    expect(render(<GenreRow genres={[]} />)).toContain('Todavía no hay géneros')
  })
})

describe('la línea del destacado', () => {
  test('junta géneros, año y episodios', () => {
    const item = { ...recomendacion('x', ['Acción', 'Fantasía']), year: 2019 }

    expect(featuredMeta(item, 12)).toBe('Acción / Fantasía / 2019 / 12 ep.')
  })

  test('con lo que haya: sin año ni episodios no deja huecos', () => {
    expect(featuredMeta(recomendacion('x', ['Acción']), undefined)).toBe('Acción')
  })
})
