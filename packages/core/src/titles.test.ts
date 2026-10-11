import { describe, expect, test } from 'bun:test'
import { baseTitle, sagaTitle } from './titles'

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
})
