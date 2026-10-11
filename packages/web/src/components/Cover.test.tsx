import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { Cover } from './Cover'

describe('la portada', () => {
  test('pide la imagen al proxy, nunca al proveedor', () => {
    const html = renderToString(<Cover providerId="fixture" ref="aurora-nocturna" />)

    expect(html).toContain('src="/api/cover/fixture/aurora-nocturna"')
    expect(html).toContain('loading="lazy"')
    expect(html).not.toContain('http')
  })

  test('la referencia se escapa', () => {
    const html = renderToString(<Cover providerId="fixture" ref="a/b c" />)

    expect(html).toContain('src="/api/cover/fixture/a%2Fb%20c"')
  })

  test('la clase se puede cambiar: el detalle usa otra', () => {
    const html = renderToString(<Cover providerId="fixture" ref="x" className="detail__cover" />)

    expect(html).toContain('class="detail__cover"')
  })
})
