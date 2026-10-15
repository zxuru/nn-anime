import { describe, expect, test } from 'bun:test'
import {
  hlsSubtitleTracks,
  type SubtitleChoice,
  subtitleAction,
  subtitleOptions,
} from './subtitle-menu'

const NINGUNA: SubtitleChoice = { origen: 'ninguna' }
const DECLARADA = (indice: number): SubtitleChoice => ({ origen: 'declarada', indice })
const MANIFIESTO = (id: number): SubtitleChoice => ({ origen: 'manifiesto', id })

const MENU = {
  declaradas: [{ label: 'Español' }, { label: 'Español (conversión)' }],
  manifiesto: [
    { id: 0, lang: 'ita', label: 'Italian' },
    { id: 1, lang: 'eng', label: 'English' },
  ],
  ninguna: 'Ninguno',
  sinNombre: 'Subtítulos del video',
}

describe('las pistas del manifiesto', () => {
  test('la etiqueta es el nombre de la etiqueta `#EXT-X-MEDIA`', () => {
    const pistas = hlsSubtitleTracks([{ id: 1, name: 'English', lang: 'eng' }])

    expect(pistas).toEqual([{ id: 1, lang: 'eng', label: 'English' }])
  })

  test('sin nombre, la etiqueta es el idioma: un botón vacío no se puede pulsar', () => {
    const pistas = hlsSubtitleTracks([
      { id: 0, lang: 'eng' },
      { id: 1, name: '   ' },
    ])

    expect(pistas.map((pista) => pista.label)).toEqual(['eng', ''])
  })

  test('se conserva el orden y el índice de hls.js, que es el que se le asigna', () => {
    const pistas = hlsSubtitleTracks([
      { id: 0, name: 'Italian' },
      { id: 1, name: 'English' },
    ])

    expect(pistas.map((pista) => pista.id)).toEqual([0, 1])
  })
})

describe('el menú de subtítulos', () => {
  test('los dos orígenes van en una sola lista, y «ninguno» va primero', () => {
    const opciones = subtitleOptions({ ...MENU, elegida: NINGUNA })

    expect(opciones.map((opcion) => opcion.label)).toEqual([
      'Ninguno',
      'Español',
      'Español (conversión)',
      'Italian',
      'English',
    ])
  })

  test('sin nada puesto, la única marcada es «ninguno»', () => {
    const opciones = subtitleOptions({ ...MENU, elegida: NINGUNA })

    expect(opciones.filter((opcion) => opcion.pressed).map((opcion) => opcion.label)).toEqual([
      'Ninguno',
    ])
  })

  test('una pista del manifiesto se marca por su índice, no por su posición en la lista', () => {
    // «English» es el índice 1 de hls.js y va en quinta posición del menú: lo que
    // se le asigna a hls.js es su índice, y confundir los dos enciende otra pista.
    const opciones = subtitleOptions({ ...MENU, elegida: MANIFIESTO(1) })
    const marcadas = opciones.filter((opcion) => opcion.pressed)

    expect(marcadas.length).toBe(1)
    expect(marcadas[0]?.label).toBe('English')
    expect(marcadas[0]?.choice).toEqual({ origen: 'manifiesto', id: 1 })
  })

  test('con una declarada puesta, la del manifiesto no lo está', () => {
    const opciones = subtitleOptions({ ...MENU, elegida: DECLARADA(1) })
    const marcadas = opciones.filter((opcion) => opcion.pressed)

    expect(marcadas.map((opcion) => opcion.label)).toEqual(['Español (conversión)'])
  })

  test('una pista sin nombre ni idioma lleva el respaldo del catálogo', () => {
    const opciones = subtitleOptions({
      ...MENU,
      manifiesto: [{ id: 7, lang: '', label: '' }],
      elegida: NINGUNA,
    })

    expect(opciones.at(-1)?.label).toBe('Subtítulos del video')
  })

  test('cada entrada tiene su clave, y ninguna se repite entre orígenes', () => {
    const claves = subtitleOptions({ ...MENU, elegida: NINGUNA }).map((opcion) => opcion.key)

    expect(new Set(claves).size).toBe(claves.length)
  })

  test('sin pistas de ningún origen queda sólo «ninguno»', () => {
    const opciones = subtitleOptions({
      declaradas: [],
      manifiesto: [],
      elegida: NINGUNA,
      ninguna: 'Ninguno',
      sinNombre: 'Subtítulos del video',
    })

    expect(opciones.map((opcion) => opcion.label)).toEqual(['Ninguno'])
  })
})

describe('lo que se toca al elegir', () => {
  test('«ninguno» apaga los dos orígenes', () => {
    expect(subtitleAction(NINGUNA)).toEqual({ declarada: 'ninguna', manifiesto: -1 })
  })

  test('una declarada enciende su `<track>` y apaga el manifiesto', () => {
    // Las dos encendidas a la vez son dos subtítulos superpuestos en la pantalla.
    expect(subtitleAction(DECLARADA(1))).toEqual({ declarada: 1, manifiesto: -1 })
  })

  test('una del manifiesto se enciende en hls.js y apaga el `<track>`', () => {
    expect(subtitleAction(MANIFIESTO(1))).toEqual({ declarada: 'ninguna', manifiesto: 1 })
  })
})
