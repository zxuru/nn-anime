import { describe, expect, test } from 'bun:test'
import { namesOf, sameWork, workKeys } from './identity'

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
