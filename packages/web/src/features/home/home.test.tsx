import { describe, expect, test } from 'bun:test'
import type { ContinueWatchingItem, RecommendationResponse } from '@nn-anime/core/api'
import type { AnimeSummary } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { ApiError } from '../../api/client'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { ContinueRow } from './ContinueRow'
import { FavoritesRow } from './FavoritesRow'
import { FeaturedHero } from './FeaturedHero'
import { FeedRow } from './FeedRow'
import { featuredOf, HomePage, marcaDeRefresco, minutosDesde, textoDeRefresco } from './HomePage'
import { continuePath, progressPercent, resumeLabel } from './rows'
import { TopRow } from './TopRow'
import {
  combineRows,
  debeReleer,
  mergeRows,
  REFRESCO_MS,
  type RowResults,
  rutasDeTipo,
} from './useHomeRows'

function render(node: ReactNode): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory('/')}>{node}</HistoryProvider>,
  )
}

function item(overrides: Partial<ContinueWatchingItem> = {}): ContinueWatchingItem {
  return {
    animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
    title: 'Aurora Nocturna',
    episodeRef: { providerId: 'fixture', value: 'aurora-nocturna#3' },
    episodeNumber: 3,
    mode: 'sub',
    positionS: 720,
    durationS: 1440,
    ratio: 0.5,
    watchedAt: '2026-01-31T00:00:00.000Z',
    ...overrides,
  }
}

function resumen(titulo: string): AnimeSummary {
  return { ref: { providerId: 'fixture', value: titulo }, title: titulo }
}

function recomendacion(titulo: string): RecommendationResponse {
  return {
    ref: { providerId: 'fixture', value: titulo },
    title: titulo,
    score: 0.5,
    tags: ['Acción'],
    reason: { kind: 'popular', text: 'Es de lo más visto.' },
    reasons: [{ kind: 'popular', text: 'Es de lo más visto.' }],
  }
}

describe('la fila de continuar viendo', () => {
  test('enseña la posición donde se dejó', () => {
    expect(resumeLabel(item({ positionS: 720 }))).toBe('12:00')
    expect(resumeLabel(item({ positionS: 3900 }))).toBe('1 h 5 min')
  })

  test('la proporción se redondea a porcentaje', () => {
    expect(progressPercent(item({ ratio: 0.5 }))).toBe(50)
    expect(progressPercent(item({ ratio: 1.5 }))).toBe(100)
    expect(progressPercent(item({ ratio: -1 }))).toBe(0)
  })

  test('el enlace va al episodio, escapado, con el modo y el segundo donde se dejó', () => {
    expect(continuePath(item())).toBe(
      '/watch/fixture/aurora-nocturna%233?mode=sub&at=720&anime=aurora-nocturna',
    )
  })

  test('el modo con el que se veía viaja al reproductor', () => {
    expect(continuePath(item({ mode: 'dub' }))).toContain('mode=dub')
  })

  test('sin posición no se inventa un segundo: se empieza por el principio', () => {
    expect(continuePath(item({ positionS: 0 }))).toBe(
      '/watch/fixture/aurora-nocturna%233?mode=sub&anime=aurora-nocturna',
    )
  })

  test('la tarjeta lleva su barra de progreso', () => {
    const html = render(<ContinueRow items={[item()]} />)

    expect(html).toContain('<progress')
    expect(html).toContain('value="50"')
    expect(html).toContain('12:00')
  })

  test('sin nada a medias lo dice, y dice qué aparecerá aquí', () => {
    const html = render(<ContinueRow items={[]} />)

    expect(html).toContain('Nada a medias')
    expect(html).not.toContain('<progress')
  })
})

describe('la fila de favoritos', () => {
  test('el estado vacío explica dónde se marca', () => {
    const html = render(<FavoritesRow items={[]} />)

    expect(html).toContain('La estrella está en la ficha')
  })

  test('con favoritos, cada uno enlaza a su ficha', () => {
    const html = render(<FavoritesRow items={[resumen('Aurora Nocturna')]} />)

    // La referencia se escapa: un espacio no puede viajar crudo en una ruta.
    expect(html).toContain('href="/anime/fixture/Aurora%20Nocturna"')
  })
})

describe('la fila del top', () => {
  test('sin proveedor que lo publique lo dice', () => {
    expect(render(<TopRow items={[]} />)).toContain('Ningún proveedor activo publica un top')
  })

  test('cada puesto enlaza a su ficha', () => {
    const html = render(<TopRow items={[resumen('Mar de Cristal')]} />)

    expect(html).toContain('Mar de Cristal')
    expect(html).toContain('href="/anime/fixture/Mar%20de%20Cristal"')
    expect(html).toContain('src="/api/cover/fixture/Mar%20de%20Cristal"')
  })
})

describe('la fila de novedades', () => {
  test('sin proveedor que las publique lo dice', () => {
    expect(render(<FeedRow items={[]} />)).toContain('Ningún proveedor activo publica novedades')
  })

  test('con novedades, cada una enlaza a su ficha y no reordena', () => {
    const html = render(
      <FeedRow
        items={[
          { ...resumen('Mar de Cristal'), publishedAt: '2026-09-01T12:00:00.000Z' },
          { ...resumen('Aurora Nocturna'), publishedAt: '2026-10-01T12:00:00.000Z' },
        ]}
      />,
    )

    // El orden lo decide el servidor: la fila pinta lo que le dan, tal cual.
    expect(html.indexOf('Mar de Cristal')).toBeLessThan(html.indexOf('Aurora Nocturna'))
    expect(html).toContain('href="/anime/fixture/Aurora%20Nocturna"')
  })
})

describe('el destacado con reservas', () => {
  test('manda el motor cuando tiene algo', () => {
    const destacado = featuredOf([recomendacion('Del motor')], [], [])

    expect(destacado?.title).toBe('Del motor')
    expect(destacado?.reason?.text).toBe('Es de lo más visto.')
  })

  test('sin recomendaciones, sale del feed', () => {
    const destacado = featuredOf([], [{ ...resumen('Del feed'), publishedAt: undefined }], [])

    expect(destacado?.title).toBe('Del feed')
    // Una reserva no inventa un motivo: no viene del motor.
    expect(destacado?.reason).toBeUndefined()
  })

  test('sin feed, sale de lo último que la aplicación conoce', () => {
    expect(featuredOf([], [], [resumen('De la caché')])?.title).toBe('De la caché')
  })

  test('sin nada de nada no hay destacado: el titular vuelve a ser el de la página', () => {
    expect(featuredOf([], [], [])).toBeUndefined()
  })
})

describe('las filas, cuando una lectura falla', () => {
  // Declaración y no flecha con genérico: en un `.tsx` un `<T>` se lee como JSX.
  function ok<T>(value: T): PromiseFulfilledResult<T> {
    return { status: 'fulfilled', value }
  }
  const mal: PromiseRejectedResult = { status: 'rejected', reason: new Error('sin red') }

  test('una que falla deja su fila vacía y las demás se pintan', () => {
    const filas = combineRows({
      continueWatching: mal,
      favorites: ok({ favorites: [resumen('Aurora Nocturna')] }),
      trending: ok({ items: [resumen('Mar de Cristal')] }),
      feed: ok({ items: [resumen('Del feed')] }),
      recent: ok({ items: [resumen('De la caché')] }),
    })

    expect(filas.loading).toBe(false)
    expect(filas.error).toBeUndefined()
    expect(filas.continueWatching).toEqual([])
    expect(filas.favorites).toHaveLength(1)
    expect(filas.trending).toHaveLength(1)
    expect(filas.feed).toHaveLength(1)
    expect(filas.recent).toHaveLength(1)
  })

  test('sólo se declara el error cuando fallan todas', () => {
    const filas = combineRows({
      continueWatching: mal,
      favorites: mal,
      trending: mal,
      feed: mal,
      recent: mal,
    })

    expect(filas.error).toBeDefined()
    expect(filas.feed).toEqual([])
  })

  test('sin sesión lo dice, en vez de mandar a mirar el servidor', () => {
    // La cookie es de cada navegador: abrir la misma dirección en otro no hereda
    // la sesión, y las cinco lecturas fallan con 401 a la vez.
    const sinSesion: PromiseRejectedResult = {
      status: 'rejected',
      reason: new ApiError(401, 'GET /api/favorites respondió 401'),
    }

    const filas = combineRows({
      continueWatching: sinSesion,
      favorites: sinSesion,
      trending: sinSesion,
      feed: sinSesion,
      recent: sinSesion,
    })

    expect(filas.error?.clase).toBe('sesion')
  })
})

describe('la home', () => {
  test('arranca cargando, con esqueletos y con las filas anunciadas', () => {
    const html = render(<HomePage />)

    // La frase no desaparece: se va al texto que sólo lee un lector de pantalla,
    // porque el esqueleto es decoración y no dice qué está pasando.
    expect(html).toContain('Cargando tu inicio')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('class="esqueleto"')
    expect(html).toContain('solo-lectores')
    // Y el esqueleto tiene la métrica del mosaico: dos filas de seis carteles, todos
    // iguales, que es lo que va a llegar. El número va escrito aquí y no se lee de
    // `ESQUELETOS`: si el componente cambia de idea, la prueba lo tiene que decir.
    expect(html.match(/class="esq" aria-hidden="true"/g)?.length).toBe(12)
    expect(html).not.toContain('esq--')
  })

  test('el panel de recomendaciones es una fila más', () => {
    const html = render(<HomePage />)

    expect(html).toContain('Recomendado para ti')
  })

  /**
   * El orden de las filas.
   *
   * «Continuar viendo» va la primera: es lo único de la página que pide una
   * acción concreta, y quien entra a seguir un episodio no debería buscarlo
   * entre las recomendaciones. Se mide sobre el marcado, que es donde vive el
   * orden, y no sobre una captura.
   */
  test('«continuar viendo» es la primera fila, antes que el top y las novedades', () => {
    const html = render(<HomePage />)
    const seguir = html.indexOf('Continuar viendo')

    expect(seguir).toBeGreaterThan(-1)
    for (const despues of ['Top', 'Novedades', 'Tus favoritos']) {
      expect(seguir, despues).toBeLessThan(html.indexOf(despues))
    }
  })

  /**
   * La franja que explicaba el motor se retiró de la home.
   *
   * Ocupaba el ancho del tramo para decir lo que ya dicen la nota —«Lo que el motor
   * cree que va contigo»— y cada pieza, con su puntuación a la vista. Se mide para
   * que no vuelva por su cuenta con el panel del motor colgando de la composición.
   *
   * Se nombran las clases de la franja (`franja`, `franja__*`) y no la palabra
   * «franja»: cuando el conmutador de tipo tenía una franja propia encima de la
   * marquesina, una comprobación por el substring daba la franja del motor por
   * retirada estando delante.
   */
  test('la franja de motivos ya no está', () => {
    const html = render(<HomePage />)

    expect(html).not.toContain('Lo que el motor ha elegido')
    expect(html).not.toContain('¿Por qué estas recomendaciones?')
    expect(html).not.toContain('class="franja"')
    expect(html).not.toContain('franja__')
  })
})

/**
 * La marquesina mientras llega la ficha.
 *
 * El primer render no tiene ficha —la sinopsis viaja en una petición, y es lo
 * último que aparece— y antes eso se veía como un salto: al llegar la respuesta, la
 * columna de texto crecía y el titular subía, porque la marquesina centra lo que
 * hay dentro. Lo que se mide es que el hueco ya está: el esqueleto ocupa el sitio de
 * la sinopsis y la columna se declara ocupada. El titular, además, sale entero —el
 * recorte de la hoja es visual— y con `aria-busy` quien no ve la pantalla sabe que
 * ahí todavía está llegando algo.
 *
 * En estos renders no corren los efectos, así que es exactamente el estado de los
 * primeros milisegundos de la aplicación. Que la respuesta llegue y el titular no se
 * mueva se mide en el e2e, que es donde hay navegador.
 */
describe('la marquesina', () => {
  const DESTACADO = {
    ref: { providerId: 'fixture', value: 'aurora-nocturna' },
    title: 'Aurora Nocturna',
    tags: ['Misterio'],
  }

  test('el hueco de la sinopsis lo ocupa un esqueleto, y la columna lo dice', () => {
    const html = render(<FeaturedHero item={DESTACADO} />)

    expect(html).toContain('marquesina__esqueleto')
    expect(html).toContain('marquesina__hueso--corto')
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('marquesina__sinopsis')
  })

  test('el titular sale entero: el recorte es de la hoja, no del marcado', () => {
    const largo =
      'Aurora Nocturna: la segunda temporada, con la película recapitulatoria y el resto del subtítulo'

    expect(render(<FeaturedHero item={{ ...DESTACADO, title: largo }} />)).toContain(largo)
  })
})

/**
 * La mitad que se está mirando.
 *
 * El tipo vive en la dirección y las filas que salen de las fuentes se piden ya
 * filtradas, así que aquí se mide lo que se puede ver en un `renderToString`: que
 * las tres direcciones que sí llevan el tipo lo llevan y que el aviso de «ninguna
 * fuente sirve esta mitad» no sale antes de saberlo. La petición en sí no corre
 * —no hay efectos en servidor—, y por eso `rutasDeTipo` se prueba aparte.
 *
 * El conmutador que cambia de mitad ya no lo pinta esta pantalla: vive en la
 * cabecera, y su sitio lo mide la prueba de la aplicación.
 */
describe('el tipo de la home', () => {
  function renderEn(path: string): string {
    return renderToString(
      <HistoryProvider history={createMemoryHistory(path)}>
        <HomePage />
      </HistoryProvider>,
    )
  }

  /**
   * Sin los proveedores leídos no se avisa de nada.
   *
   * En este render no hay efectos, así que la lista de proveedores está vacía: es
   * exactamente el estado de los primeros milisegundos de la aplicación —y el que
   * queda si esa lectura falla—. Decir ahí «ningún proveedor sirve películas» sería
   * afirmar algo que no se sabe, en el arranque de todas las pantallas.
   */
  test('con los proveedores sin leer no dice que no haya fuente', () => {
    expect(renderEn('/')).not.toContain('Ningún proveedor instalado sirve')
    expect(renderEn('/?tipo=movies')).not.toContain('Ningún proveedor instalado sirve')
  })

  test('las tres filas que mezclan fuentes piden su mitad al servidor', () => {
    expect(rutasDeTipo('anime')).toEqual({
      trending: '/api/trending?media=anime',
      feed: '/api/feed?media=anime',
      recent: '/api/catalog/recent?media=anime',
    })
    expect(rutasDeTipo('movies')).toEqual({
      trending: '/api/trending?media=movies',
      feed: '/api/feed?media=movies',
      recent: '/api/catalog/recent?media=movies',
    })
  })
})

describe('la relectura de la home', () => {
  // Declaración y no flecha con genérico: en un `.tsx` un `<T>` se lee como JSX.
  function ok<T>(value: T): PromiseFulfilledResult<T> {
    return { status: 'fulfilled', value }
  }
  const mal: PromiseRejectedResult = { status: 'rejected', reason: new Error('sin red') }

  function lectura(overrides: Partial<RowResults> = {}): RowResults {
    return {
      continueWatching: ok({ items: [] }),
      favorites: ok({ favorites: [] }),
      trending: ok({ items: [] }),
      feed: ok({ items: [] }),
      recent: ok({ items: [] }),
      ...overrides,
    }
  }

  const todasMalas: RowResults = {
    continueWatching: mal,
    favorites: mal,
    trending: mal,
    feed: mal,
    recent: mal,
  }

  test('la pestaña oculta no relee, por mucho tiempo que pase', () => {
    expect(debeReleer('hidden', undefined, 1_000)).toBe(false)
    expect(debeReleer('hidden', 0, 100 * REFRESCO_MS)).toBe(false)
  })

  test('con la pestaña visible, la cadencia son dos minutos', () => {
    expect(debeReleer('visible', 0, REFRESCO_MS - 1)).toBe(false)
    expect(debeReleer('visible', 0, REFRESCO_MS)).toBe(true)
  })

  test('sin intento previo, la primera vuelta a la pestaña relee', () => {
    // Es el caso de una pestaña que se abre después de cargar la home: no hay
    // reloj que mirar y esperar dos minutos sería no refrescar nunca.
    expect(debeReleer('visible', undefined, 1_000)).toBe(true)
  })

  test('una lectura que falla conserva su fila y las demás se actualizan', () => {
    const primera = combineRows(lectura({ feed: ok({ items: [resumen('Del feed')] }) }))
    const segunda = mergeRows(
      primera,
      lectura({ feed: mal, trending: ok({ items: [resumen('Mar de Cristal')] }) }),
    )

    expect(segunda.feed.map((item) => item.title)).toEqual(['Del feed'])
    expect(segunda.trending.map((item) => item.title)).toEqual(['Mar de Cristal'])
    expect(segunda.error).toBeUndefined()
    expect(segunda.relecturas).toBe(1)
    expect(segunda.loading).toBe(false)
  })

  test('si fallan todas pero había datos, no se declara error ni se vacía nada', () => {
    const primera = combineRows(lectura({ feed: ok({ items: [resumen('Del feed')] }) }))
    const segunda = mergeRows(primera, todasMalas)

    expect(segunda.error).toBeUndefined()
    expect(segunda.feed.map((item) => item.title)).toEqual(['Del feed'])
    // No llegó nada: el reloj de lo que se ve no se mueve, y la marca no diría
    // «actualizado ahora mismo» sobre un dato que no se ha refrescado.
    expect(segunda.refreshedAt).toEqual(primera.refreshedAt)
  })

  test('sin nada que enseñar, el error sí se declara', () => {
    const segunda = mergeRows(combineRows(lectura()), todasMalas)

    expect(segunda.error).toBeDefined()
  })

  test('la sesión perdida se avisa aunque haya datos', () => {
    // Un 401 no es un dato viejo: es que este navegador no puede pedir nada, y el
    // aviso dice qué hacer. Esconderlo tras las filas pintadas dejaría al usuario
    // con una página que no responde y sin saber por qué.
    const sinSesion: PromiseRejectedResult = {
      status: 'rejected',
      reason: new ApiError(401, 'GET /api/feed respondió 401'),
    }
    const primera = combineRows(lectura({ feed: ok({ items: [resumen('Del feed')] }) }))
    const segunda = mergeRows(primera, lectura({ feed: sinSesion }))

    expect(segunda.error?.clase).toBe('sesion')
    expect(segunda.feed).toHaveLength(1)
  })

  test('al abrir no hay relecturas: la marca no tiene nada que decir', () => {
    const primera = combineRows(lectura({ feed: ok({ items: [resumen('Del feed')] }) }))

    expect(primera.relecturas).toBe(0)
  })

  test('los minutos van hacia abajo y nunca son negativos', () => {
    const ahora = new Date('2026-10-11T12:00:00.000Z')

    expect(minutosDesde(undefined, ahora)).toBe(0)
    expect(minutosDesde(new Date('2026-10-11T11:58:30.000Z'), ahora)).toBe(1)
    expect(minutosDesde(new Date('2026-10-11T12:05:00.000Z'), ahora)).toBe(0)
  })

  test('la marca no sale al abrir, sale en la relectura y dice sus minutos', () => {
    const ahora = new Date('2026-10-11T12:00:00.000Z')
    const base = { refrescando: false, refreshedAt: ahora, relecturas: 0 }

    expect(textoDeRefresco(base, ahora)).toBeUndefined()
    expect(textoDeRefresco({ ...base, relecturas: 1 }, ahora)).toBe('Actualizado ahora mismo')
    expect(
      textoDeRefresco(
        { ...base, relecturas: 1, refreshedAt: new Date('2026-10-11T11:57:00.000Z') },
        ahora,
      ),
    ).toBe('Actualizado hace 3 min')
    expect(textoDeRefresco({ ...base, relecturas: 1, refrescando: true }, ahora)).toBe(
      'Actualizando…',
    )
    expect(marcaDeRefresco(0)).toBe('home.refreshedNow')
    expect(marcaDeRefresco(1)).toBe('home.refreshed')
  })
})
