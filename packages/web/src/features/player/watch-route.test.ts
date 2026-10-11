import { describe, expect, test } from 'bun:test'
import { animeRefOf, modeFromPath, neighbourEpisodes, PLAY_MODES, watchPath } from './watch-route'

describe('la ruta del reproductor', () => {
  test('sin modo, la dirección limpia', () => {
    expect(watchPath('fixture', 'aurora-nocturna#3')).toBe('/watch/fixture/aurora-nocturna%233')
  })

  test('con modo, el modo viaja en la consulta', () => {
    expect(watchPath('fixture', 'aurora-nocturna#3', 'dub')).toBe(
      '/watch/fixture/aurora-nocturna%233?mode=dub',
    )
  })

  test('la referencia se escapa: puede llevar barras', () => {
    expect(watchPath('fixture', 'temporada/1#2')).toBe('/watch/fixture/temporada%2F1%232')
  })

  test('los modos son los dos que existen', () => {
    expect(PLAY_MODES).toEqual(['sub', 'dub'])
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

describe('el título que se deduce del episodio', () => {
  test('la referencia del episodio lleva el número detrás de la almohadilla', () => {
    expect(animeRefOf('aurora-nocturna#3')).toBe('aurora-nocturna')
  })

  test('sin número, la referencia es su propio título', () => {
    expect(animeRefOf('aurora-nocturna')).toBe('aurora-nocturna')
  })

  test('se corta en la primera almohadilla', () => {
    expect(animeRefOf('temporada/1#2')).toBe('temporada/1')
    expect(animeRefOf('titulo#con#dos')).toBe('titulo')
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
})
