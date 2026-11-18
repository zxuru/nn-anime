import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  DEBOUNCE_MS,
  type RecommendationsStore,
  recommendationsPath,
  recommendationsVisible,
  retardoDeConsulta,
} from './useRecommendations'

const ROOT = fileURLToPath(new URL('.', import.meta.url))

describe('la dirección de la petición', () => {
  test('lleva el límite siempre', () => {
    expect(recommendationsPath(undefined, 10)).toBe('/api/recommendations?limit=10')
  })

  test('la consulta va escapada y recortada', () => {
    const ruta = recommendationsPath('  mecha & acción  ', 5)

    expect(ruta).toContain('limit=5')
    expect(ruta).toContain('q=mecha')
    expect(ruta).not.toContain(' ')
  })

  test('una consulta vacía no se manda', () => {
    expect(recommendationsPath('   ', 10)).not.toContain('q=')
  })

  test('el tipo va en la petición: el motor filtra sus candidatos antes de puntuar', () => {
    expect(recommendationsPath(undefined, 10, 'movies')).toBe(
      '/api/recommendations?limit=10&media=movies',
    )
    // Sin tipo —el defecto del servidor— no se manda parámetro: así la respuesta es
    // la de siempre para quien no conoce el filtro.
    expect(recommendationsPath(undefined, 10)).toBe('/api/recommendations?limit=10')
  })

  test('el retardo es el del spec', () => {
    expect(DEBOUNCE_MS).toBe(400)
  })

  /**
   * El retardo sólo existe para colapsar lo que se escribe.
   *
   * Sin consulta no hay teclas que esperar, y esperar de todos modos retrasaba la
   * marquesina: el destacado salía del feed y se cambiaba por la recomendación a
   * los 400 ms, con dos cadenas de detalle y un salto de maquetación. Las tres
   * ramas se fijan aquí porque la regla vive en una función pura y no dentro del
   * efecto, que no se puede medir sin temporizador.
   */
  test('sin consulta no se espera nada', () => {
    expect(retardoDeConsulta(undefined, undefined)).toBe(0)
    expect(retardoDeConsulta('   ', undefined)).toBe(0)
  })

  test('con consulta se espera el del spec', () => {
    expect(retardoDeConsulta('mecha', undefined)).toBe(DEBOUNCE_MS)
  })

  test('un retardo explícito manda sobre la regla', () => {
    expect(retardoDeConsulta(undefined, 5)).toBe(5)
  })
})

describe('la razón de una tarjeta', () => {
  test('el motivo lo escribe el motor y la pieza lo pinta sin componerlo', async () => {
    // El motivo ya no tiene un componente propio: viaja en `Pieza` como texto.
    // Lo que se sujeta es que la fila lo pasa tal cual, sin inventar una segunda
    // redacción que acabaría diciendo otra cosa.
    const fila = await readFile(`${ROOT}../home/RecommendedRow.tsx`, 'utf8')

    expect(fila).toContain('motivo={item.reason.text}')
  })
})

describe('el gancho', () => {
  test('usa el planificador, que es donde vive el retardo', async () => {
    // El retardo y la cancelación se prueban en `scheduler.test.ts`, con relojes
    // de mentira. Aquí sólo se comprueba que el gancho los usa: una comprobación
    // por texto de que «hay un setTimeout» sobrevivia a quitar el retardo, y por
    // eso el código se separó.
    const fuente = await readFile(`${ROOT}useRecommendations.ts`, 'utf8')

    expect(fuente).toContain('createScheduler')
    expect(fuente).toContain('plan.schedule(')
    expect(fuente).toContain('plan.cancel()')
  })
})

/**
 * Las recomendaciones de la ruta anterior no se heredan.
 *
 * Cambiar `?tipo=` —o la consulta— dejaba en pantalla las piezas de la ruta
 * anterior hasta que llegaba la nueva respuesta, y si la nueva fallaba se
 * quedaban para siempre. La transición se mide en la función pura porque el hook
 * necesita un navegador.
 */
describe('las recomendaciones al cambiar de ruta', () => {
  const A = '/api/recommendations?limit=10&q=mecha'
  const B = '/api/recommendations?limit=10&media=movies'
  const deA: RecommendationsStore = {
    ruta: A,
    state: 'ready',
    data: { items: [], coldStart: false },
    error: undefined,
  }

  test('A conserva lo suyo; B empieza cargando y sin lista', () => {
    expect(recommendationsVisible(deA, A)).toEqual({
      state: 'ready',
      data: deA.data,
      error: undefined,
    })

    expect(recommendationsVisible(deA, B)).toEqual({
      state: 'loading',
      data: undefined,
      error: undefined,
    })
  })

  test('un fallo de A no se cuenta como fallo de B', () => {
    const conFallo: RecommendationsStore = {
      ...deA,
      state: 'error',
      data: undefined,
      error: { clase: 'servidor', estado: 500, detalle: undefined, tecnico: 'falló' },
    }

    expect(recommendationsVisible(conFallo, A).error).toBe(conFallo.error)
    expect(recommendationsVisible(conFallo, B).error).toBeUndefined()
    expect(recommendationsVisible(conFallo, B).state).toBe('loading')
  })
})
