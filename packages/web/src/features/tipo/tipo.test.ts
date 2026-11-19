import { describe, expect, test } from 'bun:test'
import type { AnimeSummary } from '@rona/core/models'
import {
  enElFormato,
  esDelFormato,
  formatoFromPath,
  fuenteDeResumen,
  fuenteDeVisionado,
  pathConFormato,
  pathConVista,
  sinTipo,
  tieneTipoRetirado,
} from './tipo'

function resumen(
  providerId: string,
  value: string,
  extra: Pick<AnimeSummary, 'kind' | 'format'> = {},
): AnimeSummary {
  return { ref: { providerId, value }, title: value, ...extra }
}

describe('el formato que pide una ruta', () => {
  test('sin parámetro no se filtra', () => {
    expect(formatoFromPath('/')).toBeUndefined()
    expect(formatoFromPath('/search?q=aurora')).toBeUndefined()
  })

  test('series y movie se leen; lo inventado no filtra', () => {
    expect(formatoFromPath('/?formato=series')).toBe('series')
    expect(formatoFromPath('/?formato=movie')).toBe('movie')
    expect(formatoFromPath('/?formato=miniserie')).toBeUndefined()
  })
})

describe('la dirección vieja con familia se limpia', () => {
  test('`?tipo=` se detecta y se descarta, conservando el resto', () => {
    expect(tieneTipoRetirado('/?tipo=live')).toBe(true)
    expect(tieneTipoRetirado('/?tipo=movies&formato=movie')).toBe(true)
    expect(tieneTipoRetirado('/?formato=series')).toBe(false)

    expect(sinTipo('/?tipo=live')).toBe('/')
    expect(sinTipo('/search?q=aurora&tipo=animation&provider=fixture')).toBe(
      '/search?q=aurora&provider=fixture',
    )
  })

  test('el formato se pone y se quita sin tocar la consulta ni los espacios', () => {
    // `URLSearchParams` escribiría `+` y la dirección de arranque del CLI escribe
    // `%20`: dos convenciones para la misma búsqueda son dos claves de caché.
    expect(pathConFormato('/search?q=una%20peli', 'movie')).toBe(
      '/search?q=una%20peli&formato=movie',
    )
    expect(pathConFormato('/search?q=a&formato=movie', undefined)).toBe('/search?q=a')
  })

  test('la vista entera descarta el `tipo` retirado y conserva el formato', () => {
    expect(pathConVista('/search?q=a&tipo=live', 'series')).toBe('/search?q=a&formato=series')
    expect(pathConVista('/', undefined)).toBe('/')
  })
})

describe('a qué formato pertenece un título', () => {
  test('lo declarado por título gana sobre el `kind`', () => {
    const pelicula = { providerId: 'uno', kind: 'tv' as const, format: 'movie' as const }

    expect(esDelFormato('movie', pelicula)).toBe(true)
    expect(esDelFormato('series', pelicula)).toBe(false)
  })

  test('sin formato declarado, el `kind` decide; sin nada, serie', () => {
    expect(esDelFormato('movie', { providerId: 'uno', kind: 'movie' })).toBe(true)
    expect(esDelFormato('series', { providerId: 'uno', kind: 'tv' })).toBe(true)
    expect(esDelFormato('series', { providerId: 'uno' })).toBe(true)
    expect(esDelFormato('movie', { providerId: 'uno' })).toBe(false)
  })

  test('sin formato pedido pasa todo', () => {
    expect(esDelFormato(undefined, { providerId: 'uno', kind: 'movie' })).toBe(true)
  })

  test('la lista se filtra entera, con la fuente que diga quien llama', () => {
    const favoritos = [
      resumen('uno', 'serie', { kind: 'tv' }),
      resumen('dos', 'peli', { kind: 'movie' }),
    ]
    // El mismo dato vive en `ref` —con el `kind` al lado— o en `animeRef`, que no lo
    // trae: son dos selectores y cada uno lee lo suyo. Equivocarse aquí no da error
    // de compilación y deja la lista vacía con los datos delante, así que los dos
    // mapeos viven en el módulo y la prueba los usa tal cual.
    const continuar = [
      { animeRef: { providerId: 'uno', value: 'a-medias' }, format: 'series' as const },
      { animeRef: { providerId: 'dos', value: 'otra-a-medias' }, format: 'movie' as const },
    ]

    expect(enElFormato(favoritos, 'movie', fuenteDeResumen).map((item) => item.title)).toEqual([
      'peli',
    ])
    expect(
      enElFormato(continuar, 'series', fuenteDeVisionado).map((item) => item.animeRef.value),
    ).toEqual(['a-medias'])
    expect(enElFormato(favoritos, undefined, fuenteDeResumen)).toEqual(favoritos)
  })

  test('el mapeo del resumen se lleva el `kind` y el formato, que viven al lado', () => {
    // La mutación que importa: leer `kind` dentro del `ref`, donde no está.
    expect(
      fuenteDeResumen({
        ref: { providerId: 'uno', value: 'x' },
        kind: 'movie',
        format: 'movie',
      }),
    ).toEqual({ providerId: 'uno', kind: 'movie', format: 'movie' })
    expect(fuenteDeResumen({ ref: { providerId: 'uno', value: 'x' } })).toEqual({
      providerId: 'uno',
    })
  })

  test('lo que se está viendo lleva su formato', () => {
    expect(
      fuenteDeVisionado({
        animeRef: { providerId: 'uno', value: 'x' },
        format: 'movie',
      }),
    ).toEqual({ providerId: 'uno', format: 'movie' })
  })
})
