import { describe, expect, test } from 'bun:test'
import type { AnimeDetail } from '@nn-anime/core/models'
import {
  composeTitle,
  detailTitleParts,
  episodeLabel,
  pageTitle,
  routeTitleParts,
  setDocumentTitle,
  watchTitleParts,
} from './document-title'

/**
 * El título de la pestaña, medido sin un DOM.
 *
 * Lo que se comprueba aquí es la composición —de qué partes sale el texto— y la
 * escritura sobre un `document` de mentira. El efecto de React que las une no
 * corre en el renderizado de servidor, así que su cableado se verifica en el e2e
 * del detalle y del reproductor, que abre un navegador de verdad.
 */

function detalle(overrides: Partial<AnimeDetail> = {}): AnimeDetail {
  return {
    ref: { providerId: 'fixture', value: 'aurora-nocturna' },
    title: 'Aurora Nocturna',
    genres: [],
    studios: [],
    ...overrides,
  }
}

/** Un `document` con lo único que se usa aquí: `title`. */
function conDocumentoDeMentira(): { leido: () => string } {
  const falso = { title: '' }
  Object.defineProperty(globalThis, 'document', { value: falso, configurable: true })

  return { leido: () => falso.title }
}

function sinDocumento(): void {
  Reflect.deleteProperty(globalThis, 'document')
}

describe('composeTitle', () => {
  test('une las partes con un punto medio', () => {
    expect(composeTitle(['Aurora Nocturna', 'Episodio 3', 'nn-anime'])).toBe(
      'Aurora Nocturna · Episodio 3 · nn-anime',
    )
  })

  test('una sola parte no lleva separador', () => {
    expect(composeTitle(['Aurora Nocturna'])).toBe('Aurora Nocturna')
  })

  test('lo ausente y lo vacío no dejan separador suelto', () => {
    // El caso real: el episodio no tiene nombre y el título sí.
    expect(composeTitle([undefined, '  ', 'Aurora Nocturna'])).toBe('Aurora Nocturna')
    expect(composeTitle([])).toBe('')
  })
})

describe('pageTitle', () => {
  test('añade el nombre de la aplicación al final', () => {
    expect(pageTitle(['Aurora Nocturna'])).toBe('Aurora Nocturna · nn-anime')
  })

  test('sin partes queda sólo el nombre de la aplicación', () => {
    expect(pageTitle([])).toBe('nn-anime')
  })
})

describe('setDocumentTitle', () => {
  test('escribe el título en la pestaña', () => {
    const { leido } = conDocumentoDeMentira()

    setDocumentTitle('Aurora Nocturna · nn-anime')

    expect(leido()).toBe('Aurora Nocturna · nn-anime')
    sinDocumento()
  })

  test('un título vacío no borra el que había', () => {
    const { leido } = conDocumentoDeMentira()

    setDocumentTitle('Aurora Nocturna · nn-anime')
    setDocumentTitle('')

    expect(leido()).toBe('Aurora Nocturna · nn-anime')
    sinDocumento()
  })

  test('sin documento —renderizado en servidor— no lanza', () => {
    sinDocumento()

    expect(() => setDocumentTitle('Aurora Nocturna · nn-anime')).not.toThrow()
  })
})

describe('routeTitleParts', () => {
  test('cada pantalla sin datos propios tiene el suyo', () => {
    expect(routeTitleParts('home', '/')).toEqual(['Inicio'])
    expect(routeTitleParts('settings', '/settings')).toEqual(['Ajustes'])
    expect(routeTitleParts('not-found', '/raro')).toEqual(['Esa ruta no existe'])
  })

  test('la búsqueda lleva la consulta delante', () => {
    expect(routeTitleParts('search', '/search?q=aurora%20nocturna')).toEqual([
      '«aurora nocturna»',
      'Buscar',
    ])
  })

  test('sin consulta, o en blanco, la búsqueda se queda con su nombre', () => {
    expect(routeTitleParts('search', '/search')).toEqual(['Buscar'])
    expect(routeTitleParts('search', '/search?q=%20%20')).toEqual(['Buscar'])
  })

  test('la ficha y el reproductor no reciben título de aquí', () => {
    // Es la trampa que este caso cierra: el efecto de la pantalla padre corre
    // después del de la hija, así que un título aquí borraría el del título que
    // se está viendo y las dos pestañas volverían a llamarse igual.
    expect(routeTitleParts('detail', '/anime/fixture/aurora-nocturna')).toEqual([])
    expect(routeTitleParts('watch', '/watch/fixture/aurora-nocturna%233')).toEqual([])
  })
})

describe('detailTitleParts', () => {
  test('con la ficha cargada manda el nombre del título', () => {
    expect(detailTitleParts('ready', detalle())).toEqual(['Aurora Nocturna'])
  })

  test('mientras carga y si falla se dice qué pasa', () => {
    expect(detailTitleParts('loading', undefined)).toEqual(['Cargando…'])
    expect(detailTitleParts('error', undefined)).toEqual(['No se pudo cargar'])
  })

  test('un título que no está lo dice, y no «error»', () => {
    expect(detailTitleParts('ready', undefined)).toEqual(['Ese título no está en el proveedor.'])
  })
})

describe('watchTitleParts', () => {
  test('el título y el episodio, que es lo que distingue una pestaña de otra', () => {
    expect(watchTitleParts('Aurora Nocturna', 'Episodio 3')).toEqual([
      'Aurora Nocturna',
      'Episodio 3',
    ])
  })

  test('lo que falte no deja hueco', () => {
    expect(watchTitleParts('Aurora Nocturna', undefined)).toEqual(['Aurora Nocturna'])
    expect(watchTitleParts(undefined, 'Episodio 3')).toEqual(['Episodio 3'])
  })

  test('sin ninguno de los dos se dice que carga', () => {
    expect(watchTitleParts(undefined, undefined)).toEqual(['Cargando…'])
    expect(watchTitleParts('   ', '   ')).toEqual(['Cargando…'])
  })
})

describe('episodeLabel', () => {
  test('con nombre propio, el número y el nombre', () => {
    expect(episodeLabel(3, 'El bosque')).toBe('Episodio 3 · El bosque')
  })

  test('sin nombre, sólo el número', () => {
    expect(episodeLabel(3, undefined)).toBe('Episodio 3')
  })

  test('sin número, el nombre que dio el proveedor', () => {
    expect(episodeLabel(undefined, 'El bosque')).toBe('El bosque')
  })

  test('un nombre que ya es el número no se repite', () => {
    // El fixture numera así: «Episodio 3» como nombre del episodio 3.
    expect(episodeLabel(3, 'Episodio 3')).toBe('Episodio 3')
  })

  test('sin número ni nombre no se inventa nada', () => {
    expect(episodeLabel(undefined, undefined)).toBeUndefined()
    expect(episodeLabel(undefined, '  ')).toBeUndefined()
  })
})
