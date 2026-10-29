import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { AvisoDeConversion } from './LibraryPlayerPage'

/**
 * El aviso de la descarga que se quedó en segmentos.
 *
 * La página entera pide la descarga en un efecto, y `renderToString` no ejecuta
 * efectos: por eso lo que se mide es la pieza que sí se puede ver en un render.
 */
describe('el aviso de conversión', () => {
  test('dice que no hay MP4 y ofrece convertirlo', () => {
    const html = renderToString(<AvisoDeConversion convirtiendo={false} onConvertir={() => {}} />)

    // El texto tiene que explicar el porqué, no sólo ofrecer el botón.
    expect(html).toContain('no como MP4')
    expect(html).toContain('Convertir a MP4')
    expect(html).not.toContain('disabled')
    expect(html).toContain('aria-busy="false"')
  })

  test('mientras convierte, el botón no se puede volver a pulsar', () => {
    const html = renderToString(<AvisoDeConversion convirtiendo onConvertir={() => {}} />)

    expect(html).toContain('Convirtiendo')
    expect(html).toContain('disabled')
    expect(html).toContain('aria-busy="true"')
    // Y ya no invita a pulsarlo otra vez.
    expect(html).not.toContain('Convertir a MP4')
  })
})
