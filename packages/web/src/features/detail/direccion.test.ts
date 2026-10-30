import { describe, expect, test } from 'bun:test'
import { conLaConsulta, consultaDeLaFicha, rutaDeFicha } from './direccion'

describe('la dirección de una ficha', () => {
  test('codifica proveedor y referencia', () => {
    expect(rutaDeFicha('fixture', 'aurora-nocturna')).toBe('/anime/fixture/aurora-nocturna')
    expect(rutaDeFicha('fixture', 'a/b c')).toBe('/anime/fixture/a%2Fb%20c')
  })
})

describe('el rastro de la búsqueda en la dirección', () => {
  test('la consulta se anexa a la ficha, escapada', () => {
    expect(conLaConsulta('/anime/fixture/aurora-nocturna', 'aurora nocturna')).toBe(
      '/anime/fixture/aurora-nocturna?q=aurora%20nocturna',
    )
    expect(conLaConsulta('/anime/fixture/aurora-nocturna', 'a&b=c')).toBe(
      '/anime/fixture/aurora-nocturna?q=a%26b%3Dc',
    )
  })

  test('también se anexa a la petición del servidor', () => {
    // La misma consulta viaja en la dirección de la interfaz y en la lectura del
    // detalle: la segunda es la que el servidor anota.
    expect(conLaConsulta('/api/anime/fixture/aurora-nocturna', 'aurora')).toBe(
      '/api/anime/fixture/aurora-nocturna?q=aurora',
    )
  })

  test('sin consulta no se anexa nada', () => {
    expect(conLaConsulta('/anime/fixture/aurora-nocturna', undefined)).toBe(
      '/anime/fixture/aurora-nocturna',
    )
    expect(conLaConsulta('/anime/fixture/aurora-nocturna', '')).toBe(
      '/anime/fixture/aurora-nocturna',
    )
    expect(conLaConsulta('/anime/fixture/aurora-nocturna', '   ')).toBe(
      '/anime/fixture/aurora-nocturna',
    )
  })

  /**
   * Una pieza de AniList que no está en ninguna fuente lleva a la búsqueda de su
   * título, que ya trae su propio `q`. Pegarle otro dejaría dos consultas en la
   * misma dirección y `URLSearchParams.get` devolvería la primera, que no es la
   * que el usuario escribió.
   */
  test('una dirección que no es una ficha se queda como está', () => {
    expect(conLaConsulta('/search?q=kimetsu', 'estudio cobre')).toBe('/search?q=kimetsu')
    expect(conLaConsulta('/', 'aurora')).toBe('/')
  })
})

describe('la consulta que trae la dirección de una ficha', () => {
  test('lee la consulta, esté donde esté en la cadena', () => {
    expect(consultaDeLaFicha('/anime/fixture/aurora-nocturna?q=aurora%20nocturna')).toBe(
      'aurora nocturna',
    )
    expect(consultaDeLaFicha('/anime/fixture/aurora-nocturna?otra=x&q=naruto')).toBe('naruto')
  })

  test('sin consulta no hay rastro que anotar', () => {
    expect(consultaDeLaFicha('/anime/fixture/aurora-nocturna')).toBeUndefined()
    expect(consultaDeLaFicha('/anime/fixture/aurora-nocturna?q=%20')).toBeUndefined()
    expect(consultaDeLaFicha('/anime/fixture/aurora-nocturna?q=')).toBeUndefined()
  })
})
