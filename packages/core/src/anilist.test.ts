/**
 * Las funciones puras de AniList.
 *
 * Se miden con datos reales de la API —los nombres que publica de «Danmachi», una
 * descripción con etiquetas— porque es donde están los casos que importan: el
 * emparejamiento que el repositorio ya necesitaba cuando dos fuentes nombran la
 * misma obra de otra forma (`discovery-identidad.md`), y el saneado de un texto
 * que viene de fuera.
 */

import { describe, expect, test } from 'bun:test'
import {
  ANILIST_GENRES,
  ANILIST_RELATIONS,
  type AniListCandidate,
  anilistGenre,
  anilistImagePath,
  anilistKeys,
  anilistNames,
  kindOfFormat,
  pickAniListMatch,
  plainText,
  relationOf,
  sameAniListWork,
} from './anilist'
import { namesOf } from './identity'

/** Los nombres con los que AniList publica «Danmachi», recortados. */
const DANMACHI = {
  romaji: 'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka',
  english: 'Is It Wrong to Try to Pick Up Girls in a Dungeon?',
  native: 'ダンジョンに出会いを求めるのは間違っているだろうか',
  synonyms: ['Danmachi', 'DanMachi: Familia Myth'],
}

/** «Kimetsu no Yaiba» y su temporada, que AniList publica como dos obras. */
const KIMETSU: AniListCandidate = {
  id: 101922,
  names: { romaji: 'Kimetsu no Yaiba' },
  year: 2019,
  kind: 'tv',
}

const HASHIRA: AniListCandidate = {
  id: 166240,
  names: {
    romaji: 'Kimetsu no Yaiba: Hashira Geiko-hen',
    english: 'Demon Slayer: Hashira Training Arc',
  },
  year: 2024,
  kind: 'tv',
}

describe('los nombres de una obra de AniList', () => {
  test('reúne romaji, inglés, nativo y sinónimos, sin los vacíos', () => {
    expect(anilistNames(DANMACHI)).toEqual([
      'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka',
      'Is It Wrong to Try to Pick Up Girls in a Dungeon?',
      'ダンジョンに出会いを求めるのは間違っているだろうか',
      'Danmachi',
      'DanMachi: Familia Myth',
    ])

    expect(anilistNames({ romaji: 'Solo', english: '  ', synonyms: [''] })).toEqual(['Solo'])
  })

  test('las claves comparan sin acentos, sin signos y sin mayúsculas', () => {
    expect(anilistKeys({ romaji: 'Sousou no Frieren' })).toEqual(
      anilistKeys({ romaji: 'sousou  no frieren!' }),
    )
  })
})

describe('¿es la misma obra?', () => {
  test('«Danmachi» de una fuente es el título largo de AniList', () => {
    const local = namesOf({ title: 'Danmachi', ref: 'danmachi' })

    expect(sameAniListWork(local, DANMACHI)).toBe(true)
  })

  test('la serie y su temporada son obras distintas', () => {
    const local = namesOf({ title: 'Kimetsu no Yaiba' })

    expect(sameAniListWork(local, { romaji: 'Kimetsu no Yaiba: Hashira Geiko-hen' })).toBe(false)
    expect(sameAniListWork(local, { romaji: 'Kimetsu no Yaiba' })).toBe(true)
  })

  test('un nombre sin letras ni números no empareja con nada', () => {
    expect(sameAniListWork(namesOf({ title: '!!' }), { romaji: '!!' })).toBe(false)
  })

  test('el nombre alternativo de la fuente también sirve', () => {
    const local = namesOf({ title: 'Kimetsu', titleAlt: 'Demon Slayer: Hashira Training Arc' })

    expect(sameAniListWork(local, HASHIRA.names)).toBe(true)
  })
})

describe('la candidata que se elige', () => {
  const local = namesOf({ title: 'Kimetsu no Yaiba' })

  test('sin candidata que cumpla no hay emparejamiento', () => {
    expect(pickAniListMatch(local, 2019, [HASHIRA])).toBeUndefined()
  })

  test('entre la obra y su temporada elige la del nombre exacto', () => {
    expect(pickAniListMatch(local, undefined, [HASHIRA, KIMETSU])).toBe(KIMETSU)
  })

  test('entre dos del mismo nombre manda el año', () => {
    const otra = { ...KIMETSU, id: 999, year: 2026 }

    expect(pickAniListMatch(local, 2026, [KIMETSU, otra])).toBe(otra)
  })

  test('sin año que comparar se queda con la primera, que es el orden de AniList', () => {
    expect(pickAniListMatch(local, undefined, [KIMETSU, { ...KIMETSU, id: 999 }])?.id).toBe(
      KIMETSU.id,
    )
  })
})

describe('el texto de una descripción', () => {
  test('quita las etiquetas y decodifica las entidades', () => {
    expect(plainText('Uno<br>Dos &amp; tres &quot;cuatro&quot; &#039;cinco&#039;')).toBe(
      'Uno Dos & tres "cuatro" \'cinco\'',
    )
  })

  test('un punto de código hexadecimal también se decodifica', () => {
    expect(plainText('Frieren &#x2014; la maga')).toBe('Frieren — la maga')
  })

  test('una entidad que no se reconoce se queda tal cual y se ve', () => {
    expect(plainText('&noexiste; y texto')).toBe('&noexiste; y texto')
  })

  test('los espacios de las etiquetas no se acumulan', () => {
    expect(plainText('  <i>Uno</i>\n\n  <br>  Dos  ')).toBe('Uno Dos')
  })
})

describe('el formato de AniList', () => {
  test('cada formato tiene su tipo, y la música no tiene ninguno', () => {
    expect(kindOfFormat('TV')).toBe('tv')
    expect(kindOfFormat('TV_SHORT')).toBe('tv')
    expect(kindOfFormat('MOVIE')).toBe('movie')
    expect(kindOfFormat('OVA')).toBe('ova')
    expect(kindOfFormat('ONA')).toBe('ona')
    expect(kindOfFormat('SPECIAL')).toBe('special')
    expect(kindOfFormat('MUSIC')).toBeUndefined()
    expect(kindOfFormat('LO_QUE_SEA')).toBeUndefined()
  })
})

/**
 * Los nombres con los que AniList publica las relaciones que se enseñan, en su
 * orden. Es la lista de fuera, escrita a mano aquí: si el mapa de dentro cambia
 * —un valor de menos, un nombre mal escrito, dos intercambiados— esta prueba y la
 * de arriba se contradicen.
 */
const RELACIONES_DE_ANILIST = [
  'SEQUEL',
  'PREQUEL',
  'PARENT',
  'SIDE_STORY',
  'SPIN_OFF',
  'ALTERNATIVE',
  'SUMMARY',
  'SPECIAL',
] as const

describe('las relaciones de AniList', () => {
  test('cada nombre que se enseña se lee, y en el orden declarado', () => {
    expect(RELACIONES_DE_ANILIST.map((nombre) => relationOf(nombre))).toEqual([
      ...ANILIST_RELATIONS,
    ])
  })

  test('lo que apunta a otra cosa no se enseña', () => {
    // Medido contra la API para «Kimetsu no Yaiba»: SOURCE es el manga y
    // CHARACTER son cuatro ONAs de gag y un crossover. Ninguna es una entrega
    // que encadenar, y las dos llegarían a la ficha si la lista fuese abierta.
    expect(relationOf('SOURCE')).toBeUndefined()
    expect(relationOf('ADAPTATION')).toBeUndefined()
    expect(relationOf('CHARACTER')).toBeUndefined()
    expect(relationOf('COMPILATION')).toBeUndefined()
    expect(relationOf('CONTAINS')).toBeUndefined()
    expect(relationOf('OTHER')).toBeUndefined()
  })

  test('un tipo nuevo, o el mismo en minúsculas, no se adivina', () => {
    expect(relationOf('SIDE_STORY_NEW')).toBeUndefined()
    expect(relationOf('sequel')).toBeUndefined()
  })
})

describe('la ruta de una imagen', () => {
  test('compone la referencia local, que es lo que el servidor resuelve', () => {
    expect(anilistImagePath('cover', 16498)).toBe('/api/anilist/image/cover/16498')
    expect(anilistImagePath('banner', 16498)).toBe('/api/anilist/image/banner/16498')
  })

  test('un id que no lo es se corta aquí y no en una petición con 404', () => {
    expect(() => anilistImagePath('cover', 0)).toThrow()
    expect(() => anilistImagePath('cover', 1.5)).toThrow()
    expect(() => anilistImagePath('cover', -3)).toThrow()
  })
})

/**
 * El término de la búsqueda, traducido al género de AniList.
 *
 * AniList sólo acepta el nombre inglés de su lista cerrada, y los catálogos de
 * este proyecto publican el género en español: sin esta traducción, pulsar
 * «Acción» no podría pedirle a AniList su lista. Lo que se mide, además del caso
 * que funciona, es lo que **no** se traduce: un término que no es un género no
 * puede viajar como `genre:`.
 */
describe('el género de AniList al que se refiere un término', () => {
  test('el nombre canónico, tal cual y sin acentos', () => {
    expect(anilistGenre('Action')).toBe('Action')
    expect(anilistGenre('sci-fi')).toBe('Sci-Fi')
    expect(anilistGenre('  Slice of Life ')).toBe('Slice of Life')
    expect(anilistGenre('Mahou Shoujo')).toBe('Mahou Shoujo')
  })

  test('el nombre con el que lo publican los catálogos en español', () => {
    expect(anilistGenre('Acción')).toBe('Action')
    expect(anilistGenre('accion')).toBe('Action')
    expect(anilistGenre('Ciencia ficción')).toBe('Sci-Fi')
    expect(anilistGenre('Recuentos de la vida')).toBe('Slice of Life')
    expect(anilistGenre('Terror')).toBe('Horror')
    expect(anilistGenre('Sobrenatural')).toBe('Supernatural')
    expect(anilistGenre('Suspense')).toBe('Thriller')
  })

  test('un estudio, un título o un vacío no son un género', () => {
    // Es la mitad que evita el fallo caro: `genre:` con un valor que no está en
    // su lista no devuelve vacío, devuelve un error que tumba la consulta entera
    // —y con ella la lista del estudio que sí valía—.
    expect(anilistGenre('ufotable')).toBeUndefined()
    expect(anilistGenre('Kimetsu no Yaiba')).toBeUndefined()
    expect(anilistGenre('   ')).toBeUndefined()
    expect(anilistGenre('')).toBeUndefined()
  })

  test('no se acepta una coincidencia parcial', () => {
    expect(anilistGenre('acción romántica')).toBeUndefined()
    expect(anilistGenre('drama')).toBe('Drama')
    expect(anilistGenre('dramatismo')).toBeUndefined()
  })

  test('cada género de la lista se reconoce por su nombre', () => {
    // La tabla está indexada por el tipo, así que un género nuevo sin alias no
    // compila; esto mide lo otro: que ninguno se quede sin reconocer.
    for (const genero of ANILIST_GENRES) {
      expect(anilistGenre(genero)).toBe(genero)
    }
  })
})
