import { describe, expect, test } from 'bun:test'
import type { RecommendationResponse } from '@nn-anime/core/api'
import type { AnimeSummary } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { arteDibujado, Pieza, RECURSOS, recursoDe, tituloYCuerpo } from '../../components/Pieza'
import { PiezaVacia } from '../../components/PiezaVacia'
import { SectionHeader } from '../../components/SectionHeader'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { featuredMeta, pieDelCartel } from './FeaturedHero'
import { FeedRow } from './FeedRow'
import { GenreRow, generosConCuenta, topGenres } from './GenreRow'
import { metaDeRecomendacion } from './RecommendedRow'
import { Ticker } from './Ticker'
import { puestosVisibles, quedanPuestos, TOP_VISIBLES, TopRow } from './TopRow'
import { cuentaDelTop, cuentaDeTitulos, pesoDeNovedades } from './tramo'

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

  /**
   * El tercer renglón de la nota: la cuenta del tramo. Es lo que dice de un vistazo
   * cuánto hay, y va aparte del titular y de la etiqueta.
   */
  test('la cuenta del tramo es opcional y va aparte', () => {
    const html = render(<SectionHeader title="Top 5" cuenta="10 de 42" />)

    expect(html).toContain('nota__cuenta')
    expect(html).toContain('10 de 42')
    expect(render(<SectionHeader title="sólo" />)).not.toContain('nota__cuenta')
  })
})

describe('la cuenta de un tramo', () => {
  test('singular y plural, porque «1 títulos» no se dice', () => {
    expect(cuentaDeTitulos(1)).toBe('1 título')
    expect(cuentaDeTitulos(3)).toBe('3 títulos')
  })

  test('el top dice lo que hay y lo que queda por desplegar', () => {
    expect(cuentaDelTop(12, 10)).toBe('12 títulos · y 2 más')
    // Desplegado, la cuenta deja de mentir: ya no queda nada por enseñar.
    expect(cuentaDelTop(12, 12)).toBe('12 títulos')
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
   * El cuerpo de la pieza es un enlace de verdad y lo que se pulsa vive **fuera**
   * de él: el botón «i» que abre la hoja y los mandos del asomo. Un control dentro
   * de otro control no es un control, y el enlace es lo que hace que la cuadrícula
   * se pueda recorrer con el teclado.
   */
  test('es un enlace a la ficha y sus mandos quedan fuera del enlace', () => {
    const html = render(
      <Pieza
        providerId="f"
        ref="x"
        title="X"
        to="/anime/f/x"
        sinopsis="Una flota navega un océano transparente."
      />,
    )

    expect(html).toContain('href="/anime/f/x"')
    expect(html).toContain('pz__enlace')
    // El cierre del enlace va antes del botón: el botón no está dentro.
    expect(html.indexOf('href="/anime/f/x"')).toBeLessThan(html.indexOf('pz__abrir'))
    expect(html.indexOf('</a>')).toBeLessThan(html.indexOf('pz__abrir'))
  })

  test('sin nada que contar no hay asomo ni botón que lo abra', () => {
    const html = render(<Pieza providerId="f" ref="x" title="X" to="/anime/f/x" />)

    expect(html).not.toContain('pz__asomo')
    expect(html).not.toContain('pz__abrir')
  })

  test('con motivo hay asomo y botón, y la hoja no se pinta hasta que se abre', () => {
    const html = render(
      <Pieza providerId="f" ref="x" title="X" to="/anime/f/x" motivo="Porque viste Aurora." />,
    )

    expect(html).toContain('pz__asomo')
    expect(html).toContain('Porque viste Aurora.')
    expect(html).toContain('pz__abrir')
    // La hoja es estado: se abre al pulsar y aquí no se pulsa.
    expect(html).not.toContain('hoja__caja')
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

  test('la puntuación del motor se lee en la pieza', () => {
    const html = render(
      <Pieza providerId="f" ref="x" title="X" to="/anime/f/x" puntuacion={0.92} />,
    )

    expect(html).toContain('pz__punto')
    expect(html).toContain('0.920')
    expect(render(<Pieza providerId="f" ref="x" title="X" to="/anime/f/x" />)).not.toContain(
      'pz__punto',
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

  test('el sello de origen, cuando lo trae', () => {
    const html = render(
      <Pieza providerId="f" ref="x" title="X" to="/anime/f/x" sello={['Origen: fixture']} />,
    )

    expect(html).toContain('pz__sello')
    expect(html).toContain('Origen: fixture')
    expect(render(<Pieza providerId="f" ref="x" title="X" to="/anime/f/x" />)).not.toContain(
      'pz__sello',
    )
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

    expect(html).toContain('pz__campo--circulo')
  })

  /**
   * El dibujo sólo aparece si la portada no llega: manda la portada. Viaja como
   * hijo del campo porque un `<img>` no pinta pseudo-elementos ni dibuja dentro,
   * así que con portada el navegador aparta el dibujo solo.
   */
  test('el dibujo no se pinta si la portada llega', () => {
    const html = render(
      <Pieza providerId="f" ref="x" title="X" to="/anime/f/x" recurso="letra" year={2019} />,
    )

    expect(html).toContain('src="/api/cover/f/x"')
    expect(html).not.toContain('pz__letra')
    expect(html).not.toContain('pz__cifra')
  })

  test('lo que se dibuja cuando la portada falla: inicial, cifra y nada más', () => {
    expect(render(arteDibujado('letra', 'Xilófono', undefined))).toContain('pz__letra')
    expect(render(arteDibujado('letra', 'Xilófono', undefined))).toContain('X')

    const cifra = render(arteDibujado('cifra', 'X', 2019))

    expect(cifra).toContain('pz__cifra')
    expect(cifra).toContain('2019')
    // Sin año no hay cifra que enseñar, y un recurso de dibujo no añade texto.
    expect(render(arteDibujado('cifra', 'X', undefined))).toBe('')
    expect(render(arteDibujado('trama', 'X', 2019))).toBe('')
  })
})

describe('el vacío de un tramo', () => {
  /** El primer punto es el corte natural entre el titular y el cuerpo. */
  test('una frase se parte en titular y cuerpo', () => {
    expect(tituloYCuerpo('Nada a medias. Lo que empieces aparecerá aquí.')).toEqual({
      title: 'Nada a medias',
      body: 'Lo que empieces aparecerá aquí.',
    })
  })

  test('un vacío de una sola frase se queda con el titular y sin cuerpo', () => {
    expect(tituloYCuerpo('Ningún proveedor activo publica novedades.')).toEqual({
      title: 'Ningún proveedor activo publica novedades.',
    })
  })

  test('ocupa el hueco con la forma y el borde de una pieza', () => {
    const html = render(<PiezaVacia texto="Nada a medias. Lo que empieces aparecerá aquí." />)

    expect(html).toContain('pz--fantasma')
    expect(html).toContain('Nada a medias')
    expect(html).toContain('Lo que empieces aparecerá aquí.')
  })

  test('una fila vacía se explica con una pieza, no con una caja de texto', () => {
    const html = render(<TopRow items={[]} />)

    expect(html).toContain('pz--fantasma')
    expect(html).toContain('Ningún proveedor activo publica un top')
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
   * debajo: ocupa su hueco y la rejilla no se descoloca al aparecer. Y dice cuántos
   * quedan, que es lo que hace falta para decidir si se pulsa.
   */
  test('el mando de desplegar ocupa su hueco en el mosaico y dice cuántos quedan', () => {
    const html = render(<TopRow items={puestos(TOP_VISIBLES + 1)} />)

    expect(html).toContain('pz--mando')
    expect(html).toContain('y 1 más')
    expect(html.indexOf('pz--mando')).toBeLessThan(html.indexOf('Mostrar más'))
  })

  test('todas las piezas del top pesan lo mismo: dos por dos', () => {
    const html = render(<TopRow items={puestos(5)} />)

    expect(html.match(/pz--b/g)?.length).toBe(5)
  })
})

describe('los pesos de un tramo', () => {
  /**
   * El primer título de un tramo pesa más que los que lo acompañan: es lo que hace
   * que el mosaico se lea como una revista y no como una cuadrícula uniforme.
   */
  test('novedades abre con la más reciente, que es la que manda', () => {
    expect(pesoDeNovedades(0)).toBe('m')
    expect(pesoDeNovedades(1)).toBe('w')
    expect(pesoDeNovedades(2)).toBe('s')

    const html = render(<FeedRow items={[resumen('uno'), resumen('dos')]} />)

    expect(html).toContain('pz--m')
    expect(html).toContain('pz--w')
  })

  /** El ciclo se repite: un tramo largo no se queda sin dibujo a mitad. */
  test('el reparto se repite con el tramo', () => {
    expect(pesoDeNovedades(5)).toBe(pesoDeNovedades(0))
    expect(recursoDe(6)).toBe(recursoDe(0))
  })
})

describe('la cinta', () => {
  test('sin títulos no se pinta', () => {
    expect(render(<Ticker items={[]} />)).toBe('')
  })

  test('con títulos, cada uno lleva a su ficha', () => {
    const html = render(<Ticker items={[resumen('Mar de Cristal')]} />)

    expect(html).toContain('cinta__rotulo')
    expect(html).toContain('cinta__pista')
    expect(html).toContain('href="/anime/fixture/Mar%20de%20Cristal"')
  })

  /**
   * El rótulo va fuera del carro: es el que dice de qué va la línea y no puede
   * irse con ella.
   */
  test('el rótulo no viaja dentro del carro', () => {
    const html = render(<Ticker items={[resumen('Mar de Cristal')]} />)

    expect(html.indexOf('cinta__rotulo')).toBeLessThan(html.indexOf('cinta__carro'))
  })

  /**
   * La lista va dos veces para que el bucle no tenga costura. La copia **no es un
   * enlace ni se anuncia**: es la misma información otra vez, y quien navega con
   * el teclado no tiene por qué pasar por ella.
   */
  test('la copia que cierra el bucle queda fuera del foco y del lector', () => {
    const html = render(<Ticker items={[resumen('Mar de Cristal')]} />)

    expect(html.match(/href="\/anime\/fixture\/Mar%20de%20Cristal"/g)?.length).toBe(1)
    // Fuera del lector queda la copia del título, y con ella su punto.
    expect(html.match(/class="cinta__item" aria-hidden="true"/g)?.length).toBe(1)
    expect(html).not.toContain('tabindex')
    // Y la copia sigue estando: sin ella el bucle salta al empezar de nuevo.
    expect(html.match(/cinta__item/g)?.length).toBe(2)
  })
})

describe('los géneros', () => {
  test('se cuentan y se ordenan por los que más salen', () => {
    expect(generosConCuenta([['Acción', 'Fantasía'], ['Acción'], ['Drama']], 2)).toEqual([
      { name: 'Acción', count: 2 },
      { name: 'Drama', count: 1 },
    ])
    expect(topGenres([['Acción', 'Fantasía'], ['Acción'], ['Drama']], 2)).toEqual([
      'Acción',
      'Drama',
    ])
  })

  test('con el mismo número, el orden es alfabético y no el de llegada', () => {
    expect(topGenres([['B'], ['A']], 2)).toEqual(['A', 'B'])
  })

  test('sin tags no hay géneros', () => {
    expect(topGenres([[], []], 5)).toEqual([])
  })

  /** El recuento va en voladizo sobre la palabra, y también para el lector. */
  test('cada género lleva a su búsqueda con su recuento', () => {
    const html = render(<GenreRow genres={[{ name: 'Acción', count: 4 }]} />)

    expect(html).toContain('href="/search?q=Acci%C3%B3n"')
    expect(html).toContain('generos')
    expect(html).toContain('genero__cuenta')
    expect(html).toContain('4 títulos')
  })

  test('sin géneros lo explica en vez de dejar la lista vacía', () => {
    expect(render(<GenreRow genres={[]} />)).toContain('Todavía no hay géneros')
  })
})

describe('la línea del destacado', () => {
  test('junta géneros, año y episodios', () => {
    const item = { ...recomendacion('x', ['Acción', 'Fantasía']), year: 2019 }

    expect(featuredMeta(item, 12)).toBe('Acción · Fantasía · 2019 · 12 ep.')
  })

  test('con lo que haya: sin año ni episodios no deja huecos', () => {
    expect(featuredMeta(recomendacion('x', ['Acción']), undefined)).toBe('Acción')
  })

  /** El pie del cartel: el título y el año, como en la vitrina impresa. */
  test('el pie del cartel no repite el año cuando no lo hay', () => {
    expect(pieDelCartel(recomendacion('Mar de Cristal'))).toBe('Mar de Cristal')
    expect(pieDelCartel({ ...recomendacion('Mar de Cristal'), year: 2023 })).toBe(
      'Mar de Cristal · 2023',
    )
  })
})

describe('la línea de datos de una recomendación', () => {
  test('los géneros del vector y el año', () => {
    expect(
      metaDeRecomendacion({ ...recomendacion('x', ['Aventura', 'Fantasía']), year: 2023 }),
    ).toBe('Aventura, Fantasía · Año 2023')
  })

  test('sin tags ni año se queda sin línea, que no es lo mismo que vacía', () => {
    expect(metaDeRecomendacion(recomendacion('x'))).toBeUndefined()
  })
})
