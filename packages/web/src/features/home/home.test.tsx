import { describe, expect, test } from 'bun:test'
import type { ContinueWatchingItem, RecommendationResponse } from '@nn-anime/core/api'
import type { AnimeSummary } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { ApiError } from '../../api/client'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { ContinueRow } from './ContinueRow'
import { FavoritesRow } from './FavoritesRow'
import { FeedRow } from './FeedRow'
import { featuredOf, HomePage } from './HomePage'
import { RecentRow } from './RecentRow'
import { continuePath, progressPercent, resumeLabel } from './rows'
import { TopRow } from './TopRow'
import { combineRows } from './useHomeRows'

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

function recomendacion(titulo: string): RecommendationResponse {
  return {
    ref: { providerId: 'fixture', value: titulo },
    title: titulo,
    score: 0.5,
    tags: ['Acción'],
    reason: { kind: 'popular', text: 'Es de lo más visto.' },
    reasons: [{ kind: 'popular', text: 'Es de lo más visto.' }],
  }
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

describe('la fila del top', () => {
  test('sin proveedor que lo publique lo dice', () => {
    expect(render(<TopRow items={[]} />)).toContain('Ningún proveedor activo publica un top')
  })

  test('cada puesto enlaza a su ficha', () => {
    const html = render(<TopRow items={[resumen('Mar de Cristal')]} />)

    expect(html).toContain('Mar de Cristal')
    expect(html).toContain('href="/anime/fixture/Mar%20de%20Cristal"')
    expect(html).toContain('src="/api/cover/fixture/Mar%20de%20Cristal"')
  })
})

describe('la fila de novedades', () => {
  test('sin proveedor que las publique lo dice', () => {
    expect(render(<FeedRow items={[]} />)).toContain('Ningún proveedor activo publica novedades')
  })

  test('con novedades, cada una enlaza a su ficha y no reordena', () => {
    const html = render(
      <FeedRow
        items={[
          { ...resumen('Mar de Cristal'), publishedAt: '2026-09-01T12:00:00.000Z' },
          { ...resumen('Aurora Nocturna'), publishedAt: '2026-10-01T12:00:00.000Z' },
        ]}
      />,
    )

    // El orden lo decide el servidor: la fila pinta lo que le dan, tal cual.
    expect(html.indexOf('Mar de Cristal')).toBeLessThan(html.indexOf('Aurora Nocturna'))
    expect(html).toContain('href="/anime/fixture/Aurora%20Nocturna"')
  })
})

describe('la fila de lo último añadido', () => {
  test('el estado vacío dice de dónde sale el contenido', () => {
    const html = render(<RecentRow items={[]} />)

    expect(html).toContain('aparece lo que busques')
  })

  test('con títulos, cada uno enlaza a su ficha', () => {
    const html = render(<RecentRow items={[resumen('Aurora Nocturna')]} />)

    expect(html).toContain('href="/anime/fixture/Aurora%20Nocturna"')
  })
})

describe('el destacado con reservas', () => {
  test('manda el motor cuando tiene algo', () => {
    const destacado = featuredOf([recomendacion('Del motor')], [], [])

    expect(destacado?.title).toBe('Del motor')
    expect(destacado?.reason?.text).toBe('Es de lo más visto.')
  })

  test('sin recomendaciones, sale del feed', () => {
    const destacado = featuredOf([], [{ ...resumen('Del feed'), publishedAt: undefined }], [])

    expect(destacado?.title).toBe('Del feed')
    // Una reserva no inventa un motivo: no viene del motor.
    expect(destacado?.reason).toBeUndefined()
  })

  test('sin feed, sale de lo último que la aplicación conoce', () => {
    expect(featuredOf([], [], [resumen('De la caché')])?.title).toBe('De la caché')
  })

  test('sin nada de nada no hay destacado: el titular vuelve a ser el de la página', () => {
    expect(featuredOf([], [], [])).toBeUndefined()
  })
})

describe('las filas, cuando una lectura falla', () => {
  // Declaración y no flecha con genérico: en un `.tsx` un `<T>` se lee como JSX.
  function ok<T>(value: T): PromiseFulfilledResult<T> {
    return { status: 'fulfilled', value }
  }
  const mal: PromiseRejectedResult = { status: 'rejected', reason: new Error('sin red') }

  test('una que falla deja su fila vacía y las demás se pintan', () => {
    const filas = combineRows({
      continueWatching: mal,
      favorites: ok({ favorites: [resumen('Aurora Nocturna')] }),
      trending: ok({ items: [resumen('Mar de Cristal')] }),
      feed: ok({ items: [resumen('Del feed')] }),
      recent: ok({ items: [resumen('De la caché')] }),
    })

    expect(filas.loading).toBe(false)
    expect(filas.error).toBeUndefined()
    expect(filas.continueWatching).toEqual([])
    expect(filas.favorites).toHaveLength(1)
    expect(filas.trending).toHaveLength(1)
    expect(filas.feed).toHaveLength(1)
    expect(filas.recent).toHaveLength(1)
  })

  test('sólo se declara el error cuando fallan todas', () => {
    const filas = combineRows({
      continueWatching: mal,
      favorites: mal,
      trending: mal,
      feed: mal,
      recent: mal,
    })

    expect(filas.error).toBeDefined()
    expect(filas.feed).toEqual([])
  })

  test('sin sesión lo dice, en vez de mandar a mirar el servidor', () => {
    // La cookie es de cada navegador: abrir la misma dirección en otro no hereda
    // la sesión, y las cinco lecturas fallan con 401 a la vez.
    const sinSesion: PromiseRejectedResult = {
      status: 'rejected',
      reason: new ApiError(401, 'GET /api/favorites respondió 401'),
    }

    const filas = combineRows({
      continueWatching: sinSesion,
      favorites: sinSesion,
      trending: sinSesion,
      feed: sinSesion,
      recent: sinSesion,
    })

    expect(filas.error).toContain('sesión')
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
