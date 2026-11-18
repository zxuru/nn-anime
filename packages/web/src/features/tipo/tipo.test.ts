import { describe, expect, test } from 'bun:test'
import type { AnimeSummary, MediaFamily } from '@rona/core/models'
import {
  enElFormato,
  enLaFamilia,
  esDeLaFamilia,
  esDelFormato,
  FAMILIA_POR_DEFECTO,
  familiaFromPath,
  formatoFromPath,
  fuenteDeResumen,
  fuenteDeVisionado,
  pathConFamilia,
  pathConFormato,
  pathConVista,
  sinFuenteQueSirva,
  tieneTipoViejo,
} from './tipo'

const FAMILIAS: ReadonlyMap<string, readonly MediaFamily[]> = new Map([
  ['anime', ['anime']],
  ['pelis', ['animation', 'live']],
  ['mixta', ['anime', 'animation', 'live']],
])

function resumen(
  providerId: string,
  value: string,
  extra: Pick<AnimeSummary, 'kind' | 'family' | 'format'> = {},
): AnimeSummary {
  return { ref: { providerId, value }, title: value, ...extra }
}

describe('la familia que pide una ruta', () => {
  test('sin parámetro se mira anime', () => {
    expect(familiaFromPath('/')).toBe('anime')
    expect(familiaFromPath('/search?q=aurora')).toBe('anime')
    expect(FAMILIA_POR_DEFECTO).toBe('anime')
  })

  test('las tres familias se leen, y `movies` es la dirección vieja de acción real', () => {
    expect(familiaFromPath('/?tipo=anime')).toBe('anime')
    expect(familiaFromPath('/?tipo=animation')).toBe('animation')
    expect(familiaFromPath('/?tipo=live')).toBe('live')
    // `movies` significaba «todo lo que no es anime»; su sucesor natural es `live`.
    expect(familiaFromPath('/?tipo=movies')).toBe('live')
    expect(tieneTipoViejo('/?tipo=movies')).toBe(true)
    expect(tieneTipoViejo('/?tipo=live')).toBe(false)
  })

  test('un valor que no está en el vocabulario cae en el defecto', () => {
    // La dirección la escribe cualquiera: una pestaña inventada no puede dejar la
    // pantalla en un estado que no existe.
    expect(familiaFromPath('/?tipo=peliculas')).toBe('anime')
  })

  test('el formato se lee aparte, y sin él no se filtra', () => {
    expect(formatoFromPath('/')).toBeUndefined()
    expect(formatoFromPath('/?formato=series')).toBe('series')
    expect(formatoFromPath('/?formato=movie')).toBe('movie')
    expect(formatoFromPath('/?formato=miniserie')).toBeUndefined()
  })
})

describe('la misma ruta con la vista puesta', () => {
  test('la familia de por defecto se quita de la dirección', () => {
    expect(pathConFamilia('/?tipo=live', 'anime')).toBe('/')
  })

  test('se añade al final, sin tocar lo que ya había', () => {
    expect(pathConFamilia('/', 'live')).toBe('/?tipo=live')
    expect(pathConFamilia('/search?q=aurora&provider=fixture', 'animation')).toBe(
      '/search?q=aurora&provider=fixture&tipo=animation',
    )
  })

  test('no reescribe los espacios de la consulta', () => {
    // `URLSearchParams` los escribiría como `+` y la dirección de arranque del CLI
    // los escribe como `%20`: dos convenciones para la misma búsqueda son dos
    // claves de caché distintas.
    expect(pathConFamilia('/search?q=una%20peli', 'live')).toBe('/search?q=una%20peli&tipo=live')
  })

  test('volver a ponerlo no lo duplica', () => {
    expect(pathConFamilia('/search?tipo=movies&q=a', 'live')).toBe('/search?q=a&tipo=live')
  })

  test('el formato se pone y se quita sin tocar la familia ni la consulta', () => {
    expect(pathConFormato('/search?q=a&tipo=live', 'movie')).toBe(
      '/search?q=a&tipo=live&formato=movie',
    )
    expect(pathConFormato('/search?q=a&formato=movie&tipo=live', undefined)).toBe(
      '/search?q=a&tipo=live',
    )
  })

  test('la vista entera, para los destinos que la conservan', () => {
    expect(pathConVista('/search?q=a', 'live', 'series')).toBe(
      '/search?q=a&tipo=live&formato=series',
    )
    expect(pathConVista('/', 'anime', undefined)).toBe('/')
  })
})

describe('a qué familia y formato pertenece un título', () => {
  test('la fuente de una sola familia se lleva lo suyo', () => {
    expect(esDeLaFamilia('anime', FAMILIAS, { providerId: 'anime', kind: 'tv' })).toBe(true)
    expect(esDeLaFamilia('anime', FAMILIAS, { providerId: 'pelis', kind: 'tv' })).toBe(false)
    expect(esDeLaFamilia('live', FAMILIAS, { providerId: 'pelis', kind: 'movie' })).toBe(true)
    expect(esDeLaFamilia('live', FAMILIAS, { providerId: 'pelis', kind: 'tv' })).toBe(false)
  })

  test('la mixta se reparte por el `kind`, y sin `kind` cuenta como anime', () => {
    expect(esDeLaFamilia('live', FAMILIAS, { providerId: 'mixta', kind: 'movie' })).toBe(true)
    expect(esDeLaFamilia('live', FAMILIAS, { providerId: 'mixta', kind: 'tv' })).toBe(false)
    expect(esDeLaFamilia('anime', FAMILIAS, { providerId: 'mixta' })).toBe(true)
  })

  test('lo declarado por título gana: una película de anime vive en Anime', () => {
    const peliculaDeAnime = {
      providerId: 'mixta',
      kind: 'movie' as const,
      family: 'anime' as const,
      format: 'movie' as const,
    }

    expect(esDeLaFamilia('anime', FAMILIAS, peliculaDeAnime)).toBe(true)
    expect(esDeLaFamilia('live', FAMILIAS, peliculaDeAnime)).toBe(false)
    expect(esDelFormato('movie', FAMILIAS, peliculaDeAnime)).toBe(true)
    expect(esDelFormato('series', FAMILIAS, peliculaDeAnime)).toBe(false)
  })

  test('una fuente que ya no está cuenta como anime', () => {
    expect(esDeLaFamilia('anime', FAMILIAS, { providerId: 'desinstalada', kind: 'movie' })).toBe(
      true,
    )
  })

  test('la lista se filtra entera, con la fuente que diga quien llama', () => {
    const favoritos = [
      resumen('anime', 'serie', { kind: 'tv' }),
      resumen('pelis', 'peli', { kind: 'movie' }),
      resumen('mixta', 'otra-peli', { kind: 'movie' }),
    ]
    // El mismo dato vive en `ref` —con el `kind` al lado— o en `animeRef`, que no lo
    // trae: son dos selectores y cada uno lee lo suyo. Equivocarse aquí no da error
    // de compilación y deja la pestaña vacía con los datos delante, así que los dos
    // mapeos viven en el módulo y la prueba los usa tal cual.
    const continuar = [
      { animeRef: { providerId: 'pelis', value: 'a-medias' } },
      {
        animeRef: { providerId: 'anime', value: 'otra-a-medias' },
        family: 'anime' as const,
        format: 'series' as const,
      },
    ]

    expect(
      enLaFamilia(favoritos, 'live', FAMILIAS, fuenteDeResumen).map((item) => item.title),
    ).toEqual(['peli', 'otra-peli'])
    // Sin `kind`, una fuente que sirve animación y acción real cae en la primera
    // de su conjunto: es la regla de compatibilidad de `familyOf`.
    expect(
      enLaFamilia(continuar, 'animation', FAMILIAS, fuenteDeVisionado).map(
        (item) => item.animeRef.value,
      ),
    ).toEqual(['a-medias'])
    expect(enLaFamilia(continuar, 'live', FAMILIAS, fuenteDeVisionado)).toEqual([])
    // Y el formato recorta lo que la familia dejó.
    expect(
      enElFormato(favoritos, 'movie', FAMILIAS, fuenteDeResumen).map((item) => item.title),
    ).toEqual(['peli', 'otra-peli'])
    expect(
      enElFormato(continuar, 'movie', FAMILIAS, fuenteDeVisionado).map(
        (item) => item.animeRef.value,
      ),
    ).toEqual([])
  })

  test('el mapeo del resumen se lleva el `kind` y la clasificación, que viven al lado', () => {
    // La mutación que importa: leer `kind` dentro del `ref`, donde no está.
    expect(
      fuenteDeResumen({
        ref: { providerId: 'mixta', value: 'x' },
        kind: 'movie',
        family: 'live',
        format: 'movie',
      }),
    ).toEqual({ providerId: 'mixta', kind: 'movie', family: 'live', format: 'movie' })
    expect(fuenteDeResumen({ ref: { providerId: 'mixta', value: 'x' } })).toEqual({
      providerId: 'mixta',
    })
  })

  test('lo que se está viendo lleva su familia y su formato desde T257b', () => {
    expect(
      fuenteDeVisionado({
        animeRef: { providerId: 'mixta', value: 'x' },
        family: 'live',
        format: 'movie',
      }),
    ).toEqual({ providerId: 'mixta', family: 'live', format: 'movie' })
  })
})

describe('avisar de que no hay fuente para esta familia', () => {
  test('con el mapa vacío no se afirma nada: no se sabe, y es el arranque de todo', () => {
    // El mapa está vacío mientras los proveedores llegan —y si esa lectura falla—:
    // avisar ahí diría «ninguna fuente sirve esta familia» en el primer render de
    // todas las pantallas.
    expect(sinFuenteQueSirva(new Map(), 'live')).toBe(false)
    expect(sinFuenteQueSirva(new Map(), 'anime')).toBe(false)
  })

  test('una fuente de anime no sirve la pestaña de acción real', () => {
    const soloAnime: ReadonlyMap<string, readonly MediaFamily[]> = new Map([['anime', ['anime']]])

    expect(sinFuenteQueSirva(soloAnime, 'live')).toBe(true)
    expect(sinFuenteQueSirva(soloAnime, 'anime')).toBe(false)
  })

  test('una fuente de las tres familias sirve las tres', () => {
    const mixta: ReadonlyMap<string, readonly MediaFamily[]> = new Map([
      ['mixta', ['anime', 'animation', 'live']],
    ])
    const familias: readonly MediaFamily[] = ['anime', 'animation', 'live']

    for (const familia of familias) expect(sinFuenteQueSirva(mixta, familia)).toBe(false)
  })
})
