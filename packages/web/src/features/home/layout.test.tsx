import { describe, expect, test } from 'bun:test'
import type { RecommendationResponse } from '@nn-anime/core/api'
import type { AnimeSummary } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { Pieza, RECURSOS, recursoDe } from '../../components/Pieza'
import { SectionHeader } from '../../components/SectionHeader'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { featuredMeta } from './FeaturedHero'
import { GenreRow, topGenres } from './GenreRow'
import { Ticker } from './Ticker'
import { puestosVisibles, quedanPuestos, TOP_VISIBLES, TopRow } from './TopRow'

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

describe('la nota de una sección', () => {
  test('lleva su titular y su etiqueta', () => {
    const html = render(<SectionHeader title="Top 5" meta="Lo mejor para ti" />)

    expect(html).toContain('seccion__nota')
    expect(html).toContain('nota__titulo')
    expect(html).toContain('Lo mejor para ti')
  })

  test('sin etiqueta no deja el hueco', () => {
    expect(render(<SectionHeader title="Sólo el título" />)).not.toContain('nota__meta')
  })

  test('la cuenta del tramo es opcional y va aparte', () => {
    const html = render(<SectionHeader title="Top 5" cuenta="10 de 42" />)

    expect(html).toContain('nota__cuenta')
    expect(html).toContain('10 de 42')
    expect(render(<SectionHeader title="sólo" />)).not.toContain('nota__cuenta')
  })
})

describe('la pieza de la vitrina', () => {
  test('el arte, el título y el pie', () => {
    const html = render(
      <Pieza
        providerId="fixture"
        ref="aurora-nocturna"
        title="Aurora Nocturna"
        to="/anime/fixture/aurora-nocturna"
        meta="2019"
      />,
    )

    expect(html).toContain('src="/api/cover/fixture/aurora-nocturna"')
    expect(html).toContain('Aurora Nocturna')
    expect(html).toContain('2019')
  })

  /**
   * La pieza es un enlace de verdad y **sin mandos dentro**: lo que hay que pulsar
   * de verdad vive en la ficha, y un control dentro de otro control no es un
   * control.
   */
  test('es un enlace a la ficha y no lleva mandos dentro', () => {
    const html = render(
      <Pieza
        providerId="f"
        ref="x"
        title="X"
        to="/anime/f/x"
        asomo={{ sinopsis: 'Una flota navega un océano transparente.' }}
      />,
    )

    expect(html).toContain('href="/anime/f/x"')
    expect(html).toContain('pz__enlace')
    expect(html).not.toContain('<button')
  })

  test('el peso lo pone la sección, y sin peso es una celda', () => {
    expect(render(<Pieza providerId="f" ref="x" title="X" to="/anime/f/x" peso="m" />)).toContain(
      'pz--m',
    )
    expect(render(<Pieza providerId="f" ref="x" title="X" to="/anime/f/x" />)).toContain('pz--s')
  })

  test('el puesto del top va en la pieza', () => {
    const html = render(<Pieza providerId="f" ref="x" title="X" to="/anime/f/x" posicion={3} />)

    expect(html).toContain('pz__posicion')
    expect(html).toContain('3')
    expect(render(<Pieza providerId="f" ref="x" title="X" to="/anime/f/x" />)).not.toContain(
      'pz__posicion',
    )
  })

  test('con progreso, la barra lleva su etiqueta accesible', () => {
    const html = render(
      <Pieza
        providerId="f"
        ref="x"
        title="X"
        to="/anime/f/x"
        episodio="Ep. 3"
        progreso={40}
        progresoEtiqueta="Seguir en 12:00"
      />,
    )

    expect(html).toContain('value="40"')
    expect(html).toContain('aria-label="Seguir en 12:00"')
    expect(html).toContain('Ep. 3')
  })

  test('sin pie, sin puesto y sin progreso no inventa nada', () => {
    const html = render(<Pieza providerId="f" ref="x" title="X" to="/anime/f/x" />)

    expect(html).not.toContain('pz__meta')
    expect(html).not.toContain('pz__posicion')
    expect(html).not.toContain('<progress')
    expect(html).not.toContain('pz__asomo')
  })

  test('la pieza de favoritos va apagada', () => {
    expect(render(<Pieza providerId="f" ref="x" title="X" to="/anime/f/x" apagada />)).toContain(
      'pz--apagada',
    )
  })

  /**
   * El arte no cambia con el tema ni con la carga: se reparte por el puesto, así
   * que dos piezas contiguas nunca repiten dibujo y la misma pieza enseña el mismo
   * en cada visita. Al azar, el mosaico temblaría en cada carga.
   */
  test('el recurso se reparte por el puesto y no al azar', () => {
    expect(recursoDe(0)).toBe(RECURSOS[0] ?? 'trama')
    expect(recursoDe(RECURSOS.length)).toBe(RECURSOS[0] ?? 'trama')
    expect(recursoDe(1)).not.toBe(recursoDe(0))

    const html = render(
      <Pieza providerId="f" ref="x" title="X" to="/anime/f/x" recurso="circulo" />,
    )

    expect(html).toContain('pz__arte--circulo')
  })

  test('la inicial y la cifra son texto, no dibujo', () => {
    const letra = render(<Pieza providerId="f" ref="x" title="X" to="/anime/f/x" recurso="letra" />)

    expect(letra).toContain('pz__letra')
    expect(letra).toContain('>X<')

    const cifra = render(
      <Pieza providerId="f" ref="x" title="X" to="/anime/f/x" recurso="cifra" year={2019} />,
    )

    expect(cifra).toContain('pz__cifra')
    expect(cifra).toContain('2019')
    // Sin año, la cifra no se pinta: no hay número que enseñar.
    expect(
      render(<Pieza providerId="f" ref="x" title="X" to="/anime/f/x" recurso="cifra" />),
    ).not.toContain('pz__cifra')
  })
})

describe('el top de la fuente', () => {
  /** Doce puestos: dos más que los que se ven de golpe. */
  function puestos(cuantos: number): readonly AnimeSummary[] {
    return Array.from({ length: cuantos }, (_, indice) => resumen(`puesto-${indice + 1}`))
  }

  test('numera los puestos y corta en los visibles', () => {
    const html = render(<TopRow items={puestos(12)} />)

    expect(html.match(/pz__posicion/g)?.length).toBe(TOP_VISIBLES)
    expect(html).toContain('puesto-1')
    expect(html).not.toContain('puesto-11')
  })

  test('el corte es de lo que se pinta, no de la lista', () => {
    const items = puestos(12)

    // Desplegado no se recorta nada: el top real es la lista entera de la fuente.
    expect(puestosVisibles(items, true)).toHaveLength(12)
    expect(puestosVisibles(items, false)).toHaveLength(TOP_VISIBLES)
  })

  test('ofrece «Mostrar más» sólo cuando queda un puesto', () => {
    expect(render(<TopRow items={puestos(TOP_VISIBLES)} />)).not.toContain('Mostrar más')
    expect(render(<TopRow items={puestos(TOP_VISIBLES + 1)} />)).toContain('Mostrar más')
    expect(quedanPuestos(TOP_VISIBLES, false)).toBe(false)
    expect(quedanPuestos(TOP_VISIBLES + 1, false)).toBe(true)
  })

  /**
   * El mando que despliega es una pieza del mosaico, no un botón suelto por
   * debajo: ocupa su hueco y la rejilla no se descoloca al aparecer.
   */
  test('el mando de desplegar ocupa su hueco en el mosaico', () => {
    const html = render(<TopRow items={puestos(TOP_VISIBLES + 1)} />)

    expect(html).toContain('pz--mando')
    expect(html.indexOf('pz--mando')).toBeLessThan(html.indexOf('Mostrar más'))
  })

  test('sin nada que enseñar lo explica', () => {
    expect(render(<TopRow items={[]} />)).toContain('Ningún proveedor activo publica un top')
  })
})

describe('la cinta', () => {
  test('sin títulos no se pinta', () => {
    expect(render(<Ticker items={[]} />)).toBe('')
  })

  test('con títulos, cada uno lleva a su ficha', () => {
    const html = render(<Ticker items={[resumen('Mar de Cristal')]} />)

    expect(html).toContain('cinta__rotulo')
    expect(html).toContain('href="/anime/fixture/Mar%20de%20Cristal"')
  })

  /**
   * La lista va dos veces para que el bucle no tenga costura. La copia **no es un
   * enlace ni se anuncia**: es la misma información otra vez, y quien navega con
   * el teclado no tiene por qué pasar por ella.
   */
  test('la copia que cierra el bucle queda fuera del foco y del lector', () => {
    const html = render(<Ticker items={[resumen('Mar de Cristal')]} />)

    expect(html.match(/href="\/anime\/fixture\/Mar%20de%20Cristal"/g)?.length).toBe(1)
    expect(html.match(/aria-hidden="true"/g)?.length).toBe(1)
    expect(html).not.toContain('tabindex')
    // Y la copia sigue estando: sin ella el bucle salta al empezar de nuevo.
    expect(html.match(/cinta__item/g)?.length).toBe(2)
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
    expect(html).toContain('generos')
    expect(html).toContain('genero')
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
