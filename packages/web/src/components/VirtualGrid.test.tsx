import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { VIRTUAL_THRESHOLD, VirtualGrid, visibleCount } from './VirtualGrid'

describe('cuántos se pintan', () => {
  test('el umbral es el del spec', () => {
    expect(VIRTUAL_THRESHOLD).toBe(60)
  })

  test('por debajo del umbral se pintan todos', () => {
    expect(visibleCount(10)).toBe(10)
    expect(visibleCount(60)).toBe(60)
  })

  test('por encima se corta en el umbral', () => {
    expect(visibleCount(61)).toBe(60)
    expect(visibleCount(1000)).toBe(60)
  })

  test('un límite propio manda', () => {
    expect(visibleCount(100, 10)).toBe(10)
    expect(visibleCount(5, 10)).toBe(5)
  })
})

describe('la rejilla', () => {
  const items = Array.from({ length: 100 }, (_valor, indice) => ({ id: `t${indice}` }))

  test('una lista larga no lo pinta todo y lo dice', () => {
    const html = renderToString(
      <VirtualGrid
        items={items}
        keyOf={(item) => item.id}
        render={(item) => <span>{item.id}</span>}
      />,
    )

    expect(html.match(/<li>/g)?.length).toBe(VIRTUAL_THRESHOLD)
    expect(html).toContain('40 más')
  })

  test('una lista corta se pinta entera y no avisa de nada', () => {
    const html = renderToString(
      <VirtualGrid
        items={items.slice(0, 3)}
        keyOf={(item) => item.id}
        render={(item) => <span>{item.id}</span>}
      />,
    )

    expect(html.match(/<li>/g)?.length).toBe(3)
    expect(html).not.toContain('más')
  })

  test('una lista vacía no rompe nada', () => {
    const html = renderToString(
      <VirtualGrid items={[]} keyOf={(item: { id: string }) => item.id} render={() => null} />,
    )

    expect(html).toContain('<ul')
  })
})
