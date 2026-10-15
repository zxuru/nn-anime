/**
 * La parrilla y las piezas de AniList, en unitario.
 *
 * Lo que se mide aquí es lo que no necesita navegador: a dónde lleva una pieza
 * —la ficha si la base conoce la obra, la búsqueda si no—, cómo se agrupan los
 * capítulos por día y qué dice la etiqueta de cada día. El render cubre lo demás:
 * que el episodio y la hora salgan en el pie y que sin nada se explique.
 */

import { describe, expect, test } from 'bun:test'
import type { AiringItem, DiscoverItem } from '@nn-anime/core/api'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { createMemoryHistory, HistoryProvider } from '../../router'
import {
  agruparPorDia,
  desdeDescubrir,
  desdeEmision,
  destinoDe,
  diaDe,
  etiquetaDeDia,
  horaDe,
  metaDeDescubrir,
} from './descubrir'
import { metaDeEmision, ParrillaRow } from './ParrillaRow'

function render(node: ReactNode): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory('/')}>{node}</HistoryProvider>,
  )
}

/** Un capítulo de la parrilla, con lo mínimo. */
function capitulo(overrides: Partial<AiringItem> = {}): AiringItem {
  return {
    anilistId: 101922,
    title: 'Kimetsu no Yaiba',
    cover: '/api/anilist/image/cover/101922',
    episode: 5,
    airingAt: new Date(2026, 9, 15, 20, 30).toISOString(),
    ...overrides,
  }
}

describe('a dónde lleva una pieza', () => {
  test('con referencia local, a su ficha', () => {
    expect(
      destinoDe({ title: 'Danmachi', ref: { providerId: 'fixture', value: 'danmachi' } }),
    ).toBe('/anime/fixture/danmachi')
  })

  test('sin referencia, a la búsqueda de su título', () => {
    expect(destinoDe({ title: 'Kimetsu no Yaiba' })).toBe('/search?q=Kimetsu%20no%20Yaiba')
  })

  test('la obra de AniList con ficha conocida lleva su portada y su referencia', () => {
    const item: DiscoverItem = {
      anilistId: 20920,
      title: 'Danmachi',
      cover: '/api/anilist/image/cover/20920',
      year: 2015,
      format: 'TV',
      ref: { providerId: 'fixture', value: 'danmachi' },
    }

    const vista = desdeDescubrir(item)

    expect(vista.portada).toBe('/api/anilist/image/cover/20920')
    expect(vista.to).toBe('/anime/fixture/danmachi')
    // Una serie se anuncia con su año y ya: «TV» no distingue nada.
    expect(vista.meta).toBe('Año 2015')
    expect(metaDeDescubrir({ ...item, format: 'OVA' })).toBe('Año 2015 · OVA')
  })

  test('una película se anuncia por su formato y un capítulo por su número', () => {
    expect(metaDeDescubrir({ anilistId: 1, title: 'x', cover: '/y', format: 'MOVIE' })).toBe(
      'MOVIE',
    )
    expect(desdeEmision(capitulo()).meta).toBe('Ep. 5')
    // Un estreno no tiene episodio: se queda sin esa parte.
    expect(desdeEmision(capitulo({ episode: undefined })).meta).toBeUndefined()
  })
})

describe('los días de la parrilla', () => {
  const hoy = new Date(2026, 9, 15, 9, 0)

  test('la etiqueta dice hoy, mañana, el día o la fecha', () => {
    expect(etiquetaDeDia('2026-10-15', hoy)).toBe('Hoy')
    expect(etiquetaDeDia('2026-10-16', hoy)).toBe('Mañana')
    expect(etiquetaDeDia('2026-10-18', hoy)).toBe('domingo')
    // A tres semanas, el día de la semana no dice nada: la fecha sí.
    expect(etiquetaDeDia('2026-11-05', hoy)).toContain('nov')
  })

  test('se agrupa por día natural, en el orden en que llegan', () => {
    const items = [
      capitulo({ airingAt: new Date(2026, 9, 15, 20, 30).toISOString() }),
      capitulo({ anilistId: 2, airingAt: new Date(2026, 9, 16, 13, 0).toISOString() }),
      capitulo({ anilistId: 3, airingAt: new Date(2026, 9, 15, 22, 0).toISOString() }),
    ]

    const dias = agruparPorDia(items, hoy)

    expect(dias.map((dia) => dia.dia)).toEqual(['2026-10-15', '2026-10-16'])
    expect(dias[0]?.items).toHaveLength(2)
    // Dentro del día, por hora: el de las 20:30 antes que el de las 22:00.
    expect(dias[0]?.items[0]?.airingAt).toBe(items[0]?.airingAt)
  })

  test('una fecha que no se entiende no se coloca en ningún día', () => {
    expect(agruparPorDia([capitulo({ airingAt: 'lo que sea' })], hoy)).toEqual([])
  })

  test('el día de una fecha es el del calendario local', () => {
    expect(diaDe(new Date(2026, 0, 3, 23, 59))).toBe('2026-01-03')
  })
})

describe('la hora de un capítulo', () => {
  test('se escribe en la zona del usuario', () => {
    expect(horaDe(new Date(2026, 9, 15, 20, 30).toISOString())).toBe('20:30')
  })

  test('una fecha ilegible no inventa una hora', () => {
    expect(horaDe('lo que sea')).toBe('')
  })
})

describe('la fila de la parrilla', () => {
  test('pinta cada día con su etiqueta y el episodio en el pie', () => {
    const dias = agruparPorDia(
      [
        capitulo(),
        capitulo({
          anilistId: 2,
          title: 'Danmachi',
          cover: '/api/anilist/image/cover/2',
          airingAt: new Date(2026, 9, 16, 13, 0).toISOString(),
        }),
      ],
      new Date(2026, 9, 15, 9, 0),
    )

    const html = render(<ParrillaRow dias={dias} />)

    expect(html).toContain('Hoy')
    expect(html).toContain('Mañana')
    expect(html).toContain('Kimetsu no Yaiba')
    expect(html).toContain('Ep. 5 · 20:30')
    expect(html).toContain('src="/api/anilist/image/cover/2"')
    expect(html).toContain('parrilla__dia')
  })

  test('sin nada que anunciar se explica', () => {
    const html = render(<ParrillaRow dias={[]} />)

    expect(html).toContain('No hay capítulos anunciados')
    expect(html).not.toContain('parrilla__dia')
  })

  test('la meta de una emisión lleva el episodio y la hora, y sin episodio la hora', () => {
    expect(metaDeEmision(capitulo())).toBe('Ep. 5 · 20:30')
    expect(metaDeEmision(capitulo({ episode: undefined }))).toBe('20:30')
  })
})
