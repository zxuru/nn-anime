/**
 * El renglón de la lista de episodios del reproductor.
 *
 * La pantalla no se puede montar entera en una prueba —pide páginas por efecto y
 * en el renderizado de servidor no hay efectos—, así que se mide la pieza que
 * decide: el renglón. Es donde vive el respaldo del nombre del título, que es lo
 * que se ve en la columna cuando el proveedor no nombra sus episodios.
 */

import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { EpisodeRow, type EpisodeRowProps } from './WatchEpisodes'

/** El título del caso real: animeav1 sirve sus diez episodios sin nombre. */
const TITULO = 'Sousou no Frieren 2nd Season'

function renglon(props: Partial<EpisodeRowProps> = {}): string {
  const completo: EpisodeRowProps = {
    providerId: 'animeav1',
    titleRef: 'sousou-no-frieren-2nd-season',
    mode: 'sub',
    current: false,
    episode: { value: 'sousou-no-frieren-2nd-season#1', number: 1, title: undefined },
    ...props,
  }

  return renderToString(
    <HistoryProvider history={createMemoryHistory('/watch')}>
      <EpisodeRow {...completo} />
    </HistoryProvider>,
  )
}

describe('el renglón de un episodio sin nombre', () => {
  test('lleva el del título, que es lo que se tiene', () => {
    const html = renglon({ animeTitle: TITULO })

    expect(html).toContain(`<span class="watch__list-title">${TITULO}</span>`)
    expect(html).toContain('<span class="watch__list-number">1</span>')
  })

  test('sin nombre del título tampoco se inventa uno', () => {
    const html = renglon({ animeTitle: undefined })

    expect(html).not.toContain('watch__list-title')
    expect(html).toContain('<span class="watch__list-number">1</span>')
  })

  /**
   * El hueco del nombre no se lee igual que «un nombre en blanco»: un renglón con
   * un `<span>` vacío deja el marco del enlace con un hueco de más.
   */
  test('un nombre del título en blanco se trata como ausente', () => {
    const html = renglon({ animeTitle: '   ' })

    expect(html).not.toContain('watch__list-title')
  })
})

describe('la temporada del renglón', () => {
  test('viaja al enlace para que el episodio no se busque en otra', () => {
    const html = renglon({
      episode: {
        value: 'sousou-no-frieren-2nd-season/temporada/2#1',
        number: 1,
        season: 2,
      },
    })

    expect(html).toContain('n=1')
    expect(html).toContain('s=2')
  })
})

describe('el renglón de un episodio con nombre', () => {
  test('manda el del episodio, no el del título', () => {
    const html = renglon({
      animeTitle: TITULO,
      episode: {
        value: 'sousou-no-frieren-2nd-season#1',
        number: 1,
        title: 'El viaje continúa',
      },
    })

    expect(html).toContain('<span class="watch__list-title">El viaje continúa</span>')
    expect(html).not.toContain(TITULO)
  })
})

/**
 * El nombre accesible no es un adorno: el texto visible de este enlace empieza
 * por un número suelto, y «1» no dice nada. Lo que se ve tiene que oírse, y por
 * eso el respaldo del título va también aquí.
 */
describe('el nombre accesible del renglón', () => {
  test('nombra el episodio y el respaldo del título', () => {
    const html = renglon({ animeTitle: TITULO })

    expect(html).toContain(`aria-label="Episodio 1 · ${TITULO}"`)
  })

  test('con nombre de episodio, lo dice y no repite el del título', () => {
    const html = renglon({
      animeTitle: TITULO,
      episode: { value: 'sousou-no-frieren-2nd-season#1', number: 1, title: 'El viaje continúa' },
    })

    expect(html).toContain('aria-label="Episodio 1 · El viaje continúa"')
  })
})

/**
 * La marca del que se está viendo es una de las tres señales del renglón
 * —marco, color y `aria-current`—: al sacar el renglón del componente que lo
 * pintaba, tiene que seguir puesta.
 */
test('el renglón que se está viendo se marca como el actual', () => {
  const html = renglon({ current: true, animeTitle: TITULO })

  expect(html).toContain('aria-current="page"')
})

test('el renglón que no se está viendo no se marca', () => {
  const html = renglon({ current: false, animeTitle: TITULO })

  expect(html).not.toContain('aria-current')
})
