import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { DirectoryPicker, rutaDeListado } from './DirectoryPicker'

/**
 * El explorador de carpetas.
 *
 * Se mide lo que puede romperse sin navegador: cómo viaja la ruta en la consulta
 * —una carpeta con `#`, `&` o espacio se comería media ruta sin codificar— y que
 * el diálogo no deje elegir nada antes de saber qué carpeta está enseñando.
 * El recorrido de navegar y elegir lo mide el e2e, que es donde hay navegador.
 */

describe('la ruta del listado', () => {
  test('sin carpeta se pide la raíz de descargas', () => {
    expect(rutaDeListado(undefined)).toBe('/api/downloads/dirs')
  })

  test('una ruta con caracteres que rompen la consulta viaja codificada', () => {
    const ruta = 'C:\\Videos\\Temporada #2 & más'
    const pedida = rutaDeListado(ruta)

    expect(pedida).toBe(`/api/downloads/dirs?path=${encodeURIComponent(ruta)}`)
    // Lo que de verdad importa: el `#` no parte la consulta y el `&` no abre un
    // parámetro nuevo.
    expect(pedida).not.toContain('#')
    expect(pedida.split('&')).toHaveLength(1)
  })
})

describe('el diálogo', () => {
  function render(): string {
    return renderToString(
      <DirectoryPicker open start={undefined} onClose={() => {}} onChoose={async () => {}} />,
    )
  }

  test('se anuncia con su título y ofrece elegir la carpeta que enseña', () => {
    const html = render()

    expect(html).toContain('aria-labelledby="picker-title"')
    expect(html).toContain('id="picker-title"')
    expect(html).toContain('Elegir carpeta')
    expect(html).toContain('Usar esta carpeta')
  })

  test('antes de saber qué carpeta es, elegir está apagado', () => {
    const html = render()

    expect(html).toContain('Leyendo carpetas')
    // Elegir «la carpeta actual» sin listado guardaría una ruta inventada.
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Usar esta carpeta/)
  })
})
