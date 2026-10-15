import { describe, expect, test } from 'bun:test'
import { episodeSeasonOf, episodeSeasons } from './episodes'

describe('episodeSeasonOf', () => {
  test('lee la temporada del marcador que escriben las fuentes', () => {
    // Los tres títulos son los que hay guardados en la base real del título
    // «Rick y Morty» de cuevana3, copiados tal cual.
    expect(episodeSeasonOf('T1 E1 · Buscando las semillas')).toBe(1)
    expect(episodeSeasonOf('T2 E1 · Ruptura')).toBe(2)
    expect(episodeSeasonOf('T9 E10 · El Ca...')).toBe(9)
  })

  test('sin nombre detrás también es un marcador', () => {
    // pelisplushd numera y no nombra: `T2 E5` a secas. Lo que se devuelve es la
    // temporada, no el episodio.
    expect(episodeSeasonOf('T2 E5')).toBe(2)
  })

  test('los espacios de sobra del título no estorban', () => {
    expect(episodeSeasonOf('  T3 E4 · Algo  ')).toBe(3)
  })

  test('sin marcador no hay temporada: no se asume la 1', () => {
    // El listado de jkanime escribe el título del sitio —«Tsuki ga Michibiku
    // Isekai Douchuu 2nd Season 13»— y ahí no hay marcador.
    expect(episodeSeasonOf('Tsuki ga Michibiku Isekai Douchuu 2nd Season 13')).toBeUndefined()
    expect(episodeSeasonOf('Episodio 12')).toBeUndefined()
    expect(episodeSeasonOf('')).toBeUndefined()
    expect(episodeSeasonOf(undefined)).toBeUndefined()
  })

  test('el marcador se exige entero y anclado', () => {
    // La `E` es parte del marcador: sin ella no se sabe qué episodio es.
    expect(episodeSeasonOf('T2 · Ruptura')).toBeUndefined()
    // Y no vale llevarlo en medio, ni un número pegado detrás.
    expect(episodeSeasonOf('Algo T2 E1 · Ruptura')).toBeUndefined()
    expect(episodeSeasonOf('T2 E1x')).toBeUndefined()
    // La convención de otras fuentes es otro hueco declarado, no se adivina.
    expect(episodeSeasonOf('1x02 Ruptura')).toBeUndefined()
    // Y un título que empieza por `T` sin ser marcador no cuenta.
    expect(episodeSeasonOf('Tokyo Ghoul')).toBeUndefined()
  })
})

describe('episodeSeasons', () => {
  test('cuenta cada temporada y las devuelve en el orden en que aparecen', () => {
    const temporadas = episodeSeasons([
      { title: 'T1 E1 · Uno' },
      { title: 'T1 E2 · Dos' },
      { title: 'T2 E1 · Tres' },
      { title: 'T3 E1 · Cuatro' },
      { title: 'T3 E2 · Cinco' },
      { title: 'T3 E3 · Seis' },
    ])

    expect(temporadas).toEqual([
      { season: 1, count: 2 },
      { season: 2, count: 1 },
      { season: 3, count: 3 },
    ])
  })

  test('cuenta los episodios de una temporada aunque la fuente los intercale', () => {
    // Quien pide la temporada 1 recibe los suyos, y son dos aunque no vayan
    // seguidos: la cuenta es por temporada, no por tramo.
    expect(
      episodeSeasons([
        { title: 'T1 E1 · Uno' },
        { title: 'T2 E1 · Dos' },
        { title: 'T1 E2 · Tres' },
      ]),
    ).toEqual([
      { season: 1, count: 2 },
      { season: 2, count: 1 },
    ])
  })

  test('una sola temporada no se agrupa', () => {
    // Mutar el corte de `cuenta.size < 2` devuelve una temporada y esta prueba
    // cae: una fila de un solo botón es un mueble, no un selector.
    expect(episodeSeasons([{ title: 'T1 E1 · Uno' }, { title: 'T1 E2 · Dos' }])).toBeUndefined()
  })

  test('un episodio sin marcador deshace el grupo entero', () => {
    // Mutar el `return undefined` para saltarse ese episodio deja el índice en
    // pie y esta prueba cae: agrupar escondería el episodio que no declara
    // temporada.
    expect(
      episodeSeasons([{ title: 'T1 E1 · Uno' }, { title: undefined }, { title: 'T2 E1 · Dos' }]),
    ).toBeUndefined()
  })

  test('una lista vacía no tiene temporadas', () => {
    expect(episodeSeasons([])).toBeUndefined()
  })
})
