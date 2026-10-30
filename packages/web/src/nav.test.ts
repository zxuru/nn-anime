/**
 * La lista de destinos.
 *
 * La cabecera y la barra del móvil pintan estos mismos datos, así que lo que se
 * mide aquí es el contrato que las dos comparten: cinco destinos únicos, cada uno
 * con su dibujo, sus rutas y —en la home y la búsqueda— la mitad que se está
 * mirando. Si una de las dos listas se separara, esto lo diría antes que la
 * pantalla.
 */

import { describe, expect, test } from 'bun:test'
import { destinoDeNav, esNavActual, NAV_ITEMS } from './nav'

describe('los destinos de la navegación', () => {
  test('son cinco, con dirección propia y su dibujo', () => {
    expect(NAV_ITEMS).toHaveLength(5)
    expect(new Set(NAV_ITEMS.map((item) => item.to)).size).toBe(5)

    for (const item of NAV_ITEMS) {
      expect(item.icon).toBeDefined()
      expect(item.label.startsWith('nav.')).toBe(true)
      expect(item.routes.length).toBeGreaterThan(0)
    }
  })

  test('la home y la búsqueda arrastran la mitad que se mira; los demás no', () => {
    const inicio = NAV_ITEMS.find((item) => item.to === '/')
    const buscar = NAV_ITEMS.find((item) => item.to === '/search')
    const perfil = NAV_ITEMS.find((item) => item.to === '/profile')

    if (inicio === undefined || buscar === undefined || perfil === undefined) {
      throw new Error('faltan destinos en NAV_ITEMS')
    }

    expect(destinoDeNav(inicio, 'movies')).toBe('/?tipo=movies')
    expect(destinoDeNav(buscar, 'movies')).toBe('/search?tipo=movies')
    expect(destinoDeNav(perfil, 'movies')).toBe('/profile')
  })

  test('la biblioteca se enciende también en su dirección vieja', () => {
    const biblioteca = NAV_ITEMS.find((item) => item.to === '/library')

    if (biblioteca === undefined) throw new Error('falta el destino de la biblioteca')

    expect(esNavActual(biblioteca, 'library')).toBe(true)
    expect(esNavActual(biblioteca, 'downloads')).toBe(true)
    expect(esNavActual(biblioteca, 'settings')).toBe(false)
  })

  test('una ficha o el reproductor no encienden ningún destino', () => {
    for (const name of ['detail', 'watch', 'not-found'] as const) {
      expect(NAV_ITEMS.filter((item) => esNavActual(item, name))).toHaveLength(0)
    }
  })
})
