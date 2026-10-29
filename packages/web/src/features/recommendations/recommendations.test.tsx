import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { Panel } from './Panel'
import { ReasonBadge } from './ReasonBadge'
import { DEBOUNCE_MS, recommendationsPath, retardoDeConsulta } from './useRecommendations'

const ROOT = fileURLToPath(new URL('.', import.meta.url))

function render(node: ReactNode): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory('/')}>{node}</HistoryProvider>,
  )
}

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
  test('se enseña la principal, y las demás en el `title`', () => {
    const html = render(<ReasonBadge text="Comparte acción contigo." others={['Está de moda.']} />)

    expect(html).toContain('Comparte acción contigo.')
    expect(html).toContain('title="Comparte acción contigo. · Está de moda."')
  })

  test('sin más razones, el `title` es la principal', () => {
    const html = render(<ReasonBadge text="Coincide con «mecha»." />)

    expect(html).toContain('title="Coincide con «mecha»."')
  })
})

describe('el panel', () => {
  test('mientras carga lo dice y no deja la página en blanco', () => {
    const html = render(<Panel />)

    expect(html).toContain('Buscando qué recomendarte')
    expect(html).toContain('aria-busy="true"')
  })

  test('el texto sale del catálogo, no incrustado', () => {
    expect(render(<Panel />)).toContain('Recomendado para ti')
  })

  test('el panel usa el planificador, que es donde vive el retardo', async () => {
    // El retardo y la cancelación se prueban en `scheduler.test.ts`, con relojes
    // de mentira. Aquí sólo se comprueba que el panel los usa: una comprobación
    // por texto de que «hay un setTimeout» sobrevivia a quitar el retardo, y por
    // eso el código se separó.
    const fuente = await readFile(`${ROOT}useRecommendations.ts`, 'utf8')

    expect(fuente).toContain('createScheduler')
    expect(fuente).toContain('plan.schedule(')
    expect(fuente).toContain('plan.cancel()')
  })
})
