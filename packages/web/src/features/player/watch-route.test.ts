import { describe, expect, test } from 'bun:test'
import {
  animeRefFromPath,
  animeRefOf,
  episodePosition,
  modeFromPath,
  neighbourEpisodes,
  PLAY_MODES,
  startAtFromPath,
  watchPath,
} from './watch-route'

describe('la ruta del reproductor', () => {
  test('sin modo, la dirección limpia', () => {
    expect(watchPath('fixture', 'aurora-nocturna#3')).toBe('/watch/fixture/aurora-nocturna%233')
  })

  test('con modo, el modo viaja en la consulta', () => {
    expect(watchPath('fixture', 'aurora-nocturna#3', { mode: 'dub' })).toBe(
      '/watch/fixture/aurora-nocturna%233?mode=dub',
    )
  })

  test('la referencia se escapa: puede llevar barras', () => {
    expect(watchPath('fixture', 'temporada/1#2')).toBe('/watch/fixture/temporada%2F1%232')
  })

  test('el título viaja en la consulta cuando quien escribe lo conoce', () => {
    expect(watchPath('jkanime', 'dandadan/12', { anime: 'dandadan' })).toBe(
      '/watch/jkanime/dandadan%2F12?anime=dandadan',
    )
  })

  test('sin título, la consulta no lleva el parámetro', () => {
    expect(watchPath('fixture', 'aurora-nocturna#3', { anime: '' })).toBe(
      '/watch/fixture/aurora-nocturna%233',
    )
  })

  test('los modos son los dos que existen', () => {
    expect(PLAY_MODES).toEqual(['sub', 'dub'])
  })
})

describe('el título que la dirección trae escrito', () => {
  test('lo lee de la consulta, con las otras dos cosas', () => {
    expect(animeRefFromPath('/watch/jkanime/dandadan%2F12?mode=sub&at=30&anime=dandadan')).toBe(
      'dandadan',
    )
  })

  test('sin él, no hay título escrito y toca deducirlo', () => {
    expect(animeRefFromPath('/watch/jkanime/dandadan%2F12?mode=sub')).toBeUndefined()
    expect(animeRefFromPath('/watch/jkanime/dandadan%2F12?anime=')).toBeUndefined()
    expect(animeRefFromPath('/watch/jkanime/dandadan%2F12')).toBeUndefined()
  })
})

describe('el modo que pide una dirección', () => {
  test('lo lee de la consulta', () => {
    expect(modeFromPath('/watch/fixture/aurora-nocturna%233?mode=dub')).toBe('dub')
    expect(modeFromPath('/watch/fixture/x?mode=sub')).toBe('sub')
  })

  test('sin consulta o con otro parámetro, no hay modo pedido', () => {
    expect(modeFromPath('/watch/fixture/x')).toBeUndefined()
    expect(modeFromPath('/watch/fixture/x?t=30')).toBeUndefined()
  })

  test('un modo inventado no se acepta', () => {
    expect(modeFromPath('/watch/fixture/x?mode=raw')).toBeUndefined()
    expect(modeFromPath('/watch/fixture/x?mode=')).toBeUndefined()
  })
})

describe('el segundo desde el que seguir', () => {
  test('lo lee de la consulta, junto al modo', () => {
    expect(startAtFromPath('/watch/fixture/x?mode=dub&at=709')).toBe(709)
    expect(startAtFromPath('/watch/fixture/x?at=30')).toBe(30)
  })

  test('sin él, se empieza por el principio', () => {
    expect(startAtFromPath('/watch/fixture/x?mode=sub')).toBeUndefined()
    expect(startAtFromPath('/watch/fixture/x')).toBeUndefined()
  })

  test('un valor que no es un segundo real no se interpreta', () => {
    // Una dirección escrita a mano no puede dejar el reproductor en un segundo
    // que no existe, ni en medio de un segundo.
    expect(startAtFromPath('/watch/fixture/x?at=0')).toBeUndefined()
    expect(startAtFromPath('/watch/fixture/x?at=-5')).toBeUndefined()
    expect(startAtFromPath('/watch/fixture/x?at=12.5')).toBeUndefined()
    expect(startAtFromPath('/watch/fixture/x?at=abc')).toBeUndefined()
  })
})

describe('el título que se deduce del episodio', () => {
  test('la referencia del episodio lleva el número detrás de la almohadilla', () => {
    expect(animeRefOf('aurora-nocturna#3')).toBe('aurora-nocturna')
  })

  test('la otra convención numera con barra', () => {
    expect(animeRefOf('dandadan/12')).toBe('dandadan')
    expect(animeRefOf('kimetsu-no-yaiba/1')).toBe('kimetsu-no-yaiba')
  })

  test('una barra que no precede a un número es parte de la referencia', () => {
    // Sin esta guarda, `temporada/extra` se leería como el título `temporada`, y
    // el visionado se registraría contra un título que no existe.
    expect(animeRefOf('temporada/extra')).toBe('temporada/extra')
    expect(animeRefOf('12/abc')).toBe('12/abc')
  })

  test('sin número, la referencia es su propio título', () => {
    expect(animeRefOf('aurora-nocturna')).toBe('aurora-nocturna')
  })

  test('se corta en la primera almohadilla', () => {
    expect(animeRefOf('temporada/1#2')).toBe('temporada/1')
    expect(animeRefOf('titulo#con#dos')).toBe('titulo')
  })

  test('el corte por barra mira la forma del número, no su tamaño', () => {
    // T68 ya cubre las dos convenciones y la guarda de la barra que no precede a
    // un número. Esto añade lo que queda: los ceros delante y un número largo.
    // En esta ruta la referencia es **siempre** la de un episodio, así que un
    // `temporada/2024` es el episodio 2024 y no un título llamado así.
    expect(animeRefOf('dandadan/007')).toBe('dandadan')
    expect(animeRefOf('temporada/2024')).toBe('temporada')
    expect(animeRefOf('dandadan/')).toBe('dandadan/')
  })
})

/** Tres episodios de un título, como los devuelve la lista. */
const LISTA = [1, 2, 3].map((numero) => ({
  ref: { providerId: 'fixture', value: `aurora-nocturna#${numero}` },
  number: numero,
}))

describe('los vecinos de un episodio', () => {
  test('el del medio tiene los dos', () => {
    expect(neighbourEpisodes(LISTA, 'fixture', 'aurora-nocturna#2')).toEqual({
      previous: { providerId: 'fixture', value: 'aurora-nocturna#1' },
      next: { providerId: 'fixture', value: 'aurora-nocturna#3' },
    })
  })

  test('el primero no tiene anterior y el último no tiene siguiente', () => {
    expect(neighbourEpisodes(LISTA, 'fixture', 'aurora-nocturna#1').previous).toBeUndefined()
    expect(neighbourEpisodes(LISTA, 'fixture', 'aurora-nocturna#3').next).toBeUndefined()
  })

  test('un episodio que no está en la lista no inventa vecinos', () => {
    expect(neighbourEpisodes(LISTA, 'fixture', 'aurora-nocturna#9')).toEqual({
      previous: undefined,
      next: undefined,
    })
  })

  test('otro proveedor no cuenta como el mismo título', () => {
    expect(neighbourEpisodes(LISTA, 'otro', 'aurora-nocturna#2')).toEqual({
      previous: undefined,
      next: undefined,
    })
  })

  test('si la referencia no coincide, se busca por el número', () => {
    // Un proveedor puede servir la lista con una referencia y el episodio con
    // otra; el número es lo que queda para reconocerlo.
    const otra = [1, 2, 3].map((numero) => ({
      ref: { providerId: 'fixture', value: `capitulo-${numero}` },
      number: numero,
    }))

    expect(neighbourEpisodes(otra, 'fixture', 'aurora-nocturna#2')).toEqual({
      previous: { providerId: 'fixture', value: 'capitulo-1' },
      next: { providerId: 'fixture', value: 'capitulo-3' },
    })
  })

  test('una referencia sin número no se empareja con el primero de la lista', () => {
    expect(neighbourEpisodes(LISTA, 'fixture', 'aurora-nocturna')).toEqual({
      previous: undefined,
      next: undefined,
    })
  })

  test('una lista vacía no tiene flechas', () => {
    expect(neighbourEpisodes([], 'fixture', 'aurora-nocturna#1')).toEqual({
      previous: undefined,
      next: undefined,
    })
  })

  /**
   * El caso que se veía en la pantalla: doce episodios servidos como
   * `dandadan/N`, el último abierto y la flecha de atrás apagada.
   *
   * No era la lista —tenía los doce— sino que se pedía con la referencia del
   * episodio, `dandadan/12`, y el proveedor no conocía ese título. Aquí se
   * mide lo que la pantalla hace con la lista buena.
   */
  test('con la lista servida como `titulo/N`, el último tiene anterior', () => {
    const doce = Array.from({ length: 12 }, (_, indice) => ({
      ref: { providerId: 'jkanime', value: `dandadan/${indice + 1}` },
      number: indice + 1,
    }))

    expect(neighbourEpisodes(doce, 'jkanime', 'dandadan/12')).toEqual({
      previous: { providerId: 'jkanime', value: 'dandadan/11' },
      next: undefined,
    })
    expect(episodePosition(doce, 'jkanime', 'dandadan/12')).toEqual({ number: 12, total: 12 })
  })
})

describe('el episodio que se está viendo, de cuántos', () => {
  test('el número y el total de la lista', () => {
    expect(episodePosition(LISTA, 'fixture', 'aurora-nocturna#2')).toEqual({ number: 2, total: 3 })
  })

  test('el primero y el último también se sitúan', () => {
    expect(episodePosition(LISTA, 'fixture', 'aurora-nocturna#1')).toEqual({ number: 1, total: 3 })
    expect(episodePosition(LISTA, 'fixture', 'aurora-nocturna#3')).toEqual({ number: 3, total: 3 })
  })

  test('un episodio que no está en la lista no se sitúa', () => {
    expect(episodePosition(LISTA, 'fixture', 'aurora-nocturna#9')).toBeUndefined()
    expect(episodePosition(LISTA, 'otro', 'aurora-nocturna#2')).toBeUndefined()
    expect(episodePosition([], 'fixture', 'aurora-nocturna#1')).toBeUndefined()
  })

  test('el total es el del título, no el de la lista entera', () => {
    const mezcla = [
      ...LISTA,
      { ref: { providerId: 'otro', value: 'otra-cosa#1' }, number: 1 },
      { ref: { providerId: 'otro', value: 'otra-cosa#2' }, number: 2 },
    ]

    expect(episodePosition(mezcla, 'fixture', 'aurora-nocturna#2')).toEqual({
      number: 2,
      total: 3,
    })
  })
})
