import { describe, expect, test } from 'bun:test'
import { groupByWork, namesOf, sameWork, uniqueByWork, type WorkItem, workKeys } from './identity'

/** La fuente que muestra un nombre y guarda la referencia. */
function fuente(title: string, ref?: string, titleAlt?: string) {
  return namesOf({
    title,
    ...(ref === undefined ? {} : { ref }),
    ...(titleAlt === undefined ? {} : { titleAlt }),
  })
}

/** Las dos fichas reales de la base de desarrollo, tal y como las devuelve cada fuente. */
const ANIMEAV1_DANMACHI = fuente(
  'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka',
  'danmachi',
  'Is It Wrong to Try to Pick Up Girls in a Dungeon?',
)
const JKANIME_DANMACHI = fuente(
  'Danmachi',
  'dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka',
)

describe('namesOf', () => {
  test('reúne el título, su alternativa y la referencia escrita como título', () => {
    const nombres = fuente(
      'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka',
      'danmachi',
      'Is It Wrong?',
    )

    expect(nombres.title).toBe('Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka')
    expect(nombres.visible).toEqual([
      'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka',
      'Is It Wrong?',
    ])
    expect(nombres.variants).toContain('danmachi')
  })

  test('la referencia numérica no es un nombre', () => {
    // Un identificador no dice nada del título. Si contara, dos obras distintas
    // con la referencia «1042» en dos fuentes emparejarían por el id.
    expect(fuente('Aurora', '1042').variants).toEqual(['Aurora'])
    expect(fuente('Aurora', '12/34').variants).toEqual(['Aurora'])
  })

  test('no repite la misma clave dos veces', () => {
    // El título y su slug son el mismo nombre escrito dos veces.
    expect(fuente('Danmachi', 'danmachi').variants).toEqual(['Danmachi'])
  })
})

describe('workKeys', () => {
  test('la clave lleva el título base y la temporada', () => {
    expect([...workKeys(fuente('Overlord IV'))]).toEqual(['overlord|4'])
    expect([...workKeys(fuente('Overlord'))]).toEqual(['overlord|'])
  })

  test('un título sin letras ni dígitos no deja clave', () => {
    // Sin esto, dos títulos basura —«···» y «---»— emparejarían entre sí.
    expect(workKeys(fuente('···')).size).toBe(0)
  })
})

describe('sameWork', () => {
  test('la misma obra con dos nombres distintos es la misma', () => {
    // La mutación que devuelva sólo la coincidencia de título deja esta prueba
    // en rojo: es el caso de la captura —«Danmachi» contra el título original—.
    expect(sameWork(JKANIME_DANMACHI, ANIMEAV1_DANMACHI)).toBe(true)
    expect(sameWork(ANIMEAV1_DANMACHI, JKANIME_DANMACHI)).toBe(true)
  })

  test('el mismo nombre con referencias distintas es la misma obra', () => {
    expect(sameWork(fuente('One Piece', 'one-piece'), fuente('One Piece', 'one_piece_1999'))).toBe(
      true,
    )
  })

  test('la temporada separa dos entregas que el título base junta', () => {
    // Mutar la clave para dejar sólo el título base junta «Overlord» con
    // «Overlord IV» y esta prueba cae.
    expect(sameWork(fuente('Overlord'), fuente('Overlord IV'))).toBe(false)
    expect(sameWork(fuente('Sousou no Frieren'), fuente('Sousou no Frieren 2nd Season'))).toBe(
      false,
    )
  })

  test('la película no es la serie, aunque el título de saga las junte', () => {
    // `sagaTitle` deja las dos en «kimetsu no yaiba»: la clave de identidad no
    // puede ser el título de saga o la película desaparece de la búsqueda.
    expect(
      sameWork(
        fuente('Kimetsu no Yaiba Movie 1: Mugenjou-hen', 'kimetsu-no-yaiba-movie-1'),
        fuente('Kimetsu no Yaiba', 'kimetsu-no-yaiba'),
      ),
    ).toBe(false)
  })

  test('el spin-off con nombre propio no es la serie', () => {
    // «Danmachi: Sword Oratoria» comparte saga con «Danmachi», y su nombre de
    // más —el subtítulo propio— es lo que lo deja fuera de la identidad.
    expect(
      sameWork(
        fuente(
          'Danmachi: Sword Oratoria',
          'dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka-gaiden-sword-oratoria',
        ),
        ANIMEAV1_DANMACHI,
      ),
    ).toBe(false)
  })

  test('la obra que nombra la alternativa de la otra es la misma', () => {
    // Una tercera fuente que use el nombre inglés en vez del original.
    const enInglés = fuente('Is It Wrong to Try to Pick Up Girls in a Dungeon?', 'is-it-wrong')

    expect(sameWork(enInglés, ANIMEAV1_DANMACHI)).toBe(true)
  })

  test('un título vacío no empareja con nada', () => {
    expect(sameWork(fuente(''), fuente(''))).toBe(false)
  })
})

/** Una entrada de lista, con lo que la fuente publicó. */
function entrada(providerId: string, ref: string, title: string, year?: number): WorkItem {
  return { ref: { providerId, value: ref }, title, ...(year === undefined ? {} : { year }) }
}

const MISMO_AÑO = (uno: WorkItem, otro: WorkItem) => (uno.year ?? null) === (otro.year ?? null)

describe('groupByWork', () => {
  test('la misma obra con dos nombres distintos va al mismo grupo', () => {
    // Es el caso de la captura, y la mutación que vuelva a comparar el título
    // normalizado deja esta prueba en rojo con dos grupos.
    const grupos = groupByWork(
      [
        entrada(
          'jkanime',
          'dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka',
          'Danmachi',
          2015,
        ),
        entrada(
          'animeav1',
          'danmachi',
          'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka',
          2015,
        ),
      ],
      MISMO_AÑO,
    )

    expect(grupos).toHaveLength(1)
    expect(grupos[0]?.map((item) => item.ref.providerId)).toEqual(['jkanime', 'animeav1'])
  })

  test('el orden de llegada manda: la primera entrada abre su grupo', () => {
    const grupos = groupByWork(
      [entrada('uno', 'a', 'Aurora'), entrada('dos', 'b', 'Aurora'), entrada('tres', 'c', 'Otra')],
      MISMO_AÑO,
    )

    expect(grupos.map((grupo) => grupo[0]?.ref.providerId)).toEqual(['uno', 'tres'])
  })

  test('el año decide si separa: con la guarda, dos grupos; sin ella, uno', () => {
    const items = [entrada('uno', 'a', 'One Piece', 1999), entrada('dos', 'b', 'One Piece', 2026)]

    expect(groupByWork(items, MISMO_AÑO)).toHaveLength(2)
    expect(groupByWork(items, () => true)).toHaveLength(1)
  })

  test('el spin-off y la película no entran en el grupo de la serie', () => {
    // Las cuatro filas reales: la obra (dos nombres), su spin-off y la película
    // de otra serie. El spin-off le sobra un nombre y la película también.
    const grupos = groupByWork(
      [
        entrada(
          'jkanime',
          'dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka',
          'Danmachi',
          2015,
        ),
        entrada(
          'animeav1',
          'danmachi',
          'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka',
          2015,
        ),
        entrada(
          'jkanime',
          'dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka-gaiden-sword-oratoria',
          'Danmachi: Sword Oratoria',
          2017,
        ),
        entrada('animeav1', 'kimetsu-no-yaiba', 'Kimetsu no Yaiba', 2019),
        entrada(
          'animeav1',
          'kimetsu-no-yaiba-movie-1-mugenjou-hen',
          'Kimetsu no Yaiba Movie 1: Mugenjou-hen',
          2019,
        ),
      ],
      MISMO_AÑO,
    )

    expect(grupos.map((grupo) => grupo.map((item) => item.title))).toEqual([
      ['Danmachi', 'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka'],
      ['Danmachi: Sword Oratoria'],
      ['Kimetsu no Yaiba'],
      ['Kimetsu no Yaiba Movie 1: Mugenjou-hen'],
    ])
  })

  test('un título sin letras ni números no se come a otro', () => {
    // Sin la clave vacía fuera de los conjuntos, las dos entradas basura
    // emparejarían entre sí y la fila perdería una.
    const grupos = groupByWork([entrada('uno', 'a', '···'), entrada('dos', 'b', '---')], MISMO_AÑO)

    expect(grupos).toHaveLength(2)
  })
})

describe('uniqueByWork', () => {
  test('deja la primera entrada de cada obra, en orden', () => {
    const unicas = uniqueByWork(
      [entrada('uno', 'a', 'Aurora'), entrada('dos', 'b', 'Aurora'), entrada('tres', 'c', 'Otra')],
      MISMO_AÑO,
    )

    expect(unicas.map((item) => item.ref.providerId)).toEqual(['uno', 'tres'])
  })
})
