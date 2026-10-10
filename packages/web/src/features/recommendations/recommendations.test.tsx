import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { Panel } from './Panel'
import { ReasonBadge } from './ReasonBadge'
import { DEBOUNCE_MS, recommendationsPath } from './useRecommendations'

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

  test('el retardo es el del spec', () => {
    expect(DEBOUNCE_MS).toBe(400)
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
