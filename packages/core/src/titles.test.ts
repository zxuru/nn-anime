import { describe, expect, test } from 'bun:test'
import { baseTitle } from './titles'

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
