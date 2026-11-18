import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { Cover, type FalloDePortada, portadaFallida } from './Cover'

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

  /**
   * La portada de la primera pantalla no se difiere.
   *
   * El cartel del destacado estaba con `loading="lazy"` como cualquier miniatura:
   * el navegador lo dejaba en la cola hasta decidir que estaba en pantalla, y era
   * el elemento grande de la vitrina. La prueba fija las tres marcas que lo
   * sacan de esa cola; sin ellas, el cartel vuelve a esperar detrás de las
   * miniaturas de las filas.
   */
  test('el cartel del destacado se pide ya y con prioridad alta', () => {
    const html = renderToString(<Cover providerId="fixture" ref="aurora-nocturna" prioridad />)

    expect(html).toContain('loading="eager"')
    // El atributo lo escribe React tal cual en el marcado de servidor
    // (`fetchPriority`), y el navegador lo lee sin distinguir mayúsculas.
    expect(html).toMatch(/fetchpriority="high"/i)
    expect(html).not.toContain('loading="lazy"')
  })

  test('la decodificación no se queda en el hilo de la pintura', () => {
    expect(renderToString(<Cover providerId="fixture" ref="x" />)).toContain('decoding="async"')
  })

  /**
   * Falla A → llega B → se pinta B.
   *
   * Era el fallo del hueco eterno: el estado de error no sabía de qué portada
   * era, así que una que no llegó dejaba a la siguiente sin pedir. La decisión
   * vive en `portadaFallida` para poder medir la transición sin un DOM.
   */
  test('una portada que falló no deja sin intentar la de la ruta siguiente', () => {
    const falloDeA: FalloDePortada = { ruta: '/api/cover/fixture/a', fallo: true }

    // A falló: su hueco es el correcto.
    expect(portadaFallida(falloDeA, '/api/cover/fixture/a')).toBe(true)

    // Llega B: el fallo de A no se hereda y B se pide.
    expect(portadaFallida(falloDeA, '/api/cover/fixture/b')).toBe(false)
    expect(renderToString(<Cover src="/api/cover/fixture/b" />)).toContain(
      'src="/api/cover/fixture/b"',
    )
  })
})
