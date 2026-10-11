import { describe, expect, test } from 'bun:test'
import { baseTitle, franchiseTitle, sagaTitle, seasonNumberOf } from './titles'

describe('baseTitle', () => {
  test('quita el marcador de temporada y deja el título comparable', () => {
    expect(baseTitle('Sousou no Frieren 2nd Season')).toBe('sousou no frieren')
    expect(baseTitle('Sousou no Frieren')).toBe('sousou no frieren')
  })

  test('reconoce los marcadores en sus formas escritas', () => {
    expect(baseTitle('Kimetsu no Yaiba Season 3')).toBe('kimetsu no yaiba')
    expect(baseTitle('Kimetsu no Yaiba 3rd Season')).toBe('kimetsu no yaiba')
    expect(baseTitle('Kimetsu no Yaiba Temporada 3')).toBe('kimetsu no yaiba')
    expect(baseTitle('Bleach: Thousand-Year Blood War Part 2')).toBe(
      'bleach thousand year blood war',
    )
    expect(baseTitle('Kimetsu no Yaiba Cour 2')).toBe('kimetsu no yaiba')
    expect(baseTitle('Shingeki no Kyojin: The Final Season')).toBe('shingeki no kyojin')
  })

  test('quita el romano final, con su falso positivo declarado', () => {
    expect(baseTitle('Overlord IV')).toBe('overlord')
    // El falso positivo está escrito en el módulo: se prueba para que nadie lo
    // descubra por sorpresa en la interfaz.
    expect(baseTitle('Final Fantasy VII')).toBe('final fantasy')
  })

  test('un título que es un número se queda como está', () => {
    // La mutación que quite la lista cerrada y normalice dígitos sueltos deja
    // esta prueba en rojo: «86» no es la octogésima sexta temporada de nada.
    expect(baseTitle('86')).toBe('86')
    expect(baseTitle('5-toubun no Hanayome')).toBe('5 toubun no hanayome')
  })

  test('quita los marcadores en cadena', () => {
    expect(baseTitle('Sousou no Frieren 2nd Season Part 2')).toBe('sousou no frieren')
  })

  test('es idempotente y no toca un título sin marcador', () => {
    const base = baseTitle('Fate/stay night')

    expect(base).toBe('fate stay night')
    expect(baseTitle(base)).toBe(base)
  })

  test('sin diacríticos ni signos: dos formas de escribir lo mismo coinciden', () => {
    expect(baseTitle('Shōjo Shūmatsu')).toBe(baseTitle('shojo  shumatsu'))
  })
})

describe('sagaTitle', () => {
  test('corta el subtítulo: la entrega y su saga son la misma', () => {
    // La mutación que quite el corte por «:» deja esta prueba en rojo con
    // «kimetsu no yaiba mugen ressha hen» y la ficha sin relacionados.
    expect(sagaTitle('Kimetsu no Yaiba: Mugen Ressha-hen')).toBe('kimetsu no yaiba')
    expect(sagaTitle('Kimetsu no Yaiba: Yuukaku-hen')).toBe('kimetsu no yaiba')
    expect(sagaTitle('Kimetsu no Yaiba')).toBe('kimetsu no yaiba')
  })

  test('quita el marcador de película delante y detrás', () => {
    expect(sagaTitle('Kimetsu no Yaiba Movie 1: Mugenjou-hen - Akaza Sairai')).toBe(
      'kimetsu no yaiba',
    )
    expect(sagaTitle('Kimetsu no Yaiba Movie: Mugen Ressha-hen')).toBe('kimetsu no yaiba')
    expect(sagaTitle('Gekijouban Kimetsu no Yaiba: Mugen Ressha-hen')).toBe('kimetsu no yaiba')
  })

  test('hereda el título base: la temporada tampoco separa la saga', () => {
    expect(sagaTitle('Sousou no Frieren 2nd Season')).toBe('sousou no frieren')
    expect(sagaTitle('Bleach: Thousand-Year Blood War Part 2')).toBe('bleach')
  })

  test('un guion sin espacios no corta: «5-toubun» no es «5»', () => {
    // Sin esta regla, media saga de títulos con guion se parte en la primera
    // palabra con guion y todo empareja con todo.
    expect(sagaTitle('5-toubun no Hanayome')).toBe('5 toubun no hanayome')
  })

  test('la saga vecina que empieza igual no se come', () => {
    expect(sagaTitle('Kimetsu Gakuen: Valentine-hen')).toBe('kimetsu gakuen')
  })

  test('el spin-off con subtítulo propio entra en la saga: falso positivo declarado', () => {
    // Está escrito en el módulo: cortar por el primer separador mete el spin-off
    // en su saga. Se prueba para que nadie lo descubra en la interfaz.
    expect(sagaTitle('Boku no Hero Academia: Vigilantes')).toBe('boku no hero academia')
    // Y el caso extremo de la misma regla: un título que empieza por «Re:».
    expect(sagaTitle('Re:Zero kara Hajimeru Isekai Seikatsu')).toBe('re')
  })

  test('es idempotente', () => {
    const saga = sagaTitle('Kimetsu no Yaiba Movie 1: Mugenjou-hen')

    expect(saga).toBe('kimetsu no yaiba')
    expect(sagaTitle(saga)).toBe(saga)
  })

  test('la palabra `film` también marca película: «One Piece Film: Red»', () => {
    // Sin `film` en la lista, el título queda en «one piece film» y la película
    // se queda fuera de la saga a la que pertenece.
    expect(sagaTitle('One Piece Film: Red')).toBe('one piece')
    expect(sagaTitle('One Piece Movie 14: Stampede')).toBe('one piece')
  })
})

describe('seasonNumberOf', () => {
  test('lee el número de los marcadores escritos', () => {
    expect(seasonNumberOf('Sousou no Frieren 2nd Season')).toBe(2)
    expect(seasonNumberOf('Kimetsu no Yaiba Season 3')).toBe(3)
    expect(seasonNumberOf('Kimetsu no Yaiba Temporada 3')).toBe(3)
    expect(seasonNumberOf('Ranma ½ (2024) 3rd Season')).toBe(3)
  })

  test('con dos marcadores manda la temporada, no la parte', () => {
    expect(seasonNumberOf('Shingeki no Kyojin Season 3 Part 2')).toBe(3)
    expect(seasonNumberOf('Sousou no Frieren 2nd Season Part 2')).toBe(2)
  })

  test('la parte sola no es una temporada', () => {
    // «The Final Season Part 2» no es la temporada 2 de nada: es la segunda mitad
    // de la última. Devolver 2 la colocaría entre las primeras de su saga.
    expect(seasonNumberOf('Shingeki no Kyojin: The Final Season Part 2')).toBeUndefined()
  })

  test('el romano final vale por su número', () => {
    expect(seasonNumberOf('Overlord IV')).toBe(4)
    expect(seasonNumberOf('Overlord')).toBeUndefined()
  })

  test('sin marcador no hay número: no se inventa el uno', () => {
    // Mutar el `undefined` por 1 deja esta prueba en rojo, y con ella la
    // etiqueta «Temporada 1» que la interfaz pondría sobre una obra que la
    // fuente nunca numeró.
    expect(seasonNumberOf('One Piece')).toBeUndefined()
    expect(seasonNumberOf('Bleach: Sennen Kessen-hen')).toBeUndefined()
    expect(seasonNumberOf('86')).toBeUndefined()
    expect(seasonNumberOf('Frieren: Beyond Journey’s End')).toBeUndefined()
  })
})

describe('franchiseTitle', () => {
  test('la secuela con sufijo vuelve a la franquicia de su serie', () => {
    expect(franchiseTitle('Naruto Shippuden')).toBe('naruto')
    expect(franchiseTitle('Naruto')).toBe('naruto')
    expect(franchiseTitle('Dragon Ball Z')).toBe('dragon ball')
    expect(franchiseTitle('Dragon Ball GT')).toBe('dragon ball')
    expect(franchiseTitle('Dragon Ball Kai')).toBe('dragon ball')
    expect(franchiseTitle('Dragon Ball Super')).toBe('dragon ball')
    expect(franchiseTitle('Dragon Ball Daima')).toBe('dragon ball')
    expect(franchiseTitle('Fullmetal Alchemist: Brotherhood')).toBe('fullmetal alchemist')
  })

  test('el calificador entre paréntesis no es parte del nombre', () => {
    expect(franchiseTitle('Dragon Ball Z (Original)')).toBe('dragon ball')
    expect(franchiseTitle('Ranma ½ (2024) 3rd Season')).toBe('ranma')
  })

  test('el subtítulo de la entrega tampoco separa la franquicia', () => {
    expect(franchiseTitle('Dragon Ball Super: Beerus')).toBe('dragon ball')
    expect(franchiseTitle('Kimetsu no Yaiba: Mugen Ressha-hen')).toBe('kimetsu no yaiba')
  })

  test('un sufijo que no está en la lista no junta nada: falso negativo declarado', () => {
    // El spin-off tiene saga propia —«naruto sd»— y no entra en la franquicia de
    // «Naruto». Es el precio de una lista cerrada, y está escrito en el módulo.
    expect(franchiseTitle('Naruto SD: Rock Lee no Seishun Full-Power Ninden')).toBe('naruto sd')
  })

  test('la primera palabra por sí sola no une dos obras distintas', () => {
    // La mutación que devuelva la primera palabra de la saga junta «One Piece»
    // con «One Punch Man», que no son la misma franquicia.
    expect(franchiseTitle('One Piece')).toBe('one piece')
    expect(franchiseTitle('One Punch Man')).toBe('one punch man')
    expect(franchiseTitle('86')).toBe('86')
  })
})
