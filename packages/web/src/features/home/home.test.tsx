import { describe, expect, test } from 'bun:test'
import type { ContinueWatchingItem } from '@nn-anime/core/api'
import type { AnimeSummary } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { ContinueRow } from './ContinueRow'
import { FavoritesRow } from './FavoritesRow'
import { HomePage } from './HomePage'
import { continuePath, progressPercent, resumeLabel } from './rows'
import { TrendingRow } from './TrendingRow'

function render(node: ReactNode): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory('/')}>{node}</HistoryProvider>,
  )
}

function item(overrides: Partial<ContinueWatchingItem> = {}): ContinueWatchingItem {
  return {
    animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
    title: 'Aurora Nocturna',
    episodeRef: { providerId: 'fixture', value: 'aurora-nocturna#3' },
    episodeNumber: 3,
    mode: 'sub',
    positionS: 720,
    durationS: 1440,
    ratio: 0.5,
    watchedAt: '2026-01-31T00:00:00.000Z',
    ...overrides,
  }
}

function resumen(titulo: string): AnimeSummary {
  return { ref: { providerId: 'fixture', value: titulo }, title: titulo }
}

describe('la fila de continuar viendo', () => {
  test('enseña la posición donde se dejó', () => {
    expect(resumeLabel(item({ positionS: 720 }))).toBe('12:00')
    expect(resumeLabel(item({ positionS: 3900 }))).toBe('1 h 5 min')
  })

  test('la proporción se redondea a porcentaje', () => {
    expect(progressPercent(item({ ratio: 0.5 }))).toBe(50)
    expect(progressPercent(item({ ratio: 1.5 }))).toBe(100)
    expect(progressPercent(item({ ratio: -1 }))).toBe(0)
  })

  test('el enlace va al episodio, escapado', () => {
    expect(continuePath(item())).toBe('/watch/fixture/aurora-nocturna%233')
  })

  test('la tarjeta lleva su barra de progreso', () => {
    const html = render(<ContinueRow items={[item()]} />)

    expect(html).toContain('<progress')
    expect(html).toContain('value="50"')
    expect(html).toContain('12:00')
  })

  test('sin nada a medias lo dice, y dice qué aparecerá aquí', () => {
    const html = render(<ContinueRow items={[]} />)

    expect(html).toContain('Nada a medias')
    expect(html).not.toContain('<progress')
  })
})

describe('la fila de favoritos', () => {
  test('el estado vacío explica dónde se marca', () => {
    const html = render(<FavoritesRow items={[]} />)

    expect(html).toContain('La estrella está en la ficha')
  })

  test('con favoritos, cada uno enlaza a su ficha', () => {
    const html = render(<FavoritesRow items={[resumen('Aurora Nocturna')]} />)

    // La referencia se escapa: un espacio no puede viajar crudo en una ruta.
    expect(html).toContain('href="/anime/fixture/Aurora%20Nocturna"')
  })
})

describe('la fila de tendencias', () => {
  test('sin proveedor que las ofrezca lo dice', () => {
    expect(render(<TrendingRow items={[]} />)).toContain(
      'Ningún proveedor activo ofrece tendencias',
    )
  })

  test('con tendencias, enlaza a cada ficha', () => {
    const html = render(<TrendingRow items={[resumen('Mar de Cristal')]} />)

    expect(html).toContain('Mar de Cristal')
    expect(html).toContain('href="/anime/fixture/Mar%20de%20Cristal"')
    expect(html).toContain('src="/api/cover/fixture/Mar%20de%20Cristal"')
  })
})

describe('la home', () => {
  test('arranca cargando y con las filas anunciadas', () => {
    const html = render(<HomePage />)

    expect(html).toContain('Cargando tu inicio')
    expect(html).toContain('aria-busy="true"')
  })

  test('el panel de recomendaciones es una fila más', () => {
    const html = render(<HomePage />)

    expect(html).toContain('Recomendado para ti')
  })
})
