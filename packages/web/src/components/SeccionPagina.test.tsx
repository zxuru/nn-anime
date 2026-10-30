/**
 * La cabecera de sección y la tarjeta de vacío.
 *
 * Son las dos piezas que comparten el Perfil, la Biblioteca y Ajustes, así que se
 * miden aquí y no en cada pantalla: que el dibujo sea decorativo, que la cuenta y
 * el enlace vayan después del título y que el vacío traiga título y ayuda.
 */

import { describe, expect, test } from 'bun:test'
import { Star } from 'lucide-react'
import { renderToString } from 'react-dom/server'
import { EstadoVacio } from './EstadoVacio'
import { SeccionPagina } from './SeccionPagina'

describe('la cabecera de una sección de página', () => {
  test('junta título, dibujo, explicación, cuenta y enlace en ese orden', () => {
    const html = renderToString(
      <SeccionPagina
        titulo="Favoritos"
        icono={Star}
        meta="Lo que has guardado"
        cuenta="3 títulos"
        accion={<a href="/history">Ver todo</a>}
      >
        <p>cuerpo</p>
      </SeccionPagina>,
    )

    expect(html).toContain('pagina__cabecera')
    expect(html).toContain('Favoritos')
    expect(html).toContain('Lo que has guardado')
    expect(html).toContain('3 títulos')
    expect(html).toContain('Ver todo')

    // El dibujo va dentro del titular y es decorativo: el nombre lo dice el
    // texto, y un icono con nombre propio lo repetiría.
    expect(html).toContain('<svg')
    expect(html).toContain('aria-hidden="true"')

    // El orden es el de la lectura: título, explicación, cuenta y enlace.
    const titulo = html.indexOf('pagina__titulo')
    const meta = html.indexOf('Lo que has guardado')
    const cuenta = html.indexOf('3 títulos')
    const accion = html.indexOf('Ver todo')

    expect(titulo).toBeLessThan(meta)
    expect(meta).toBeLessThan(cuenta)
    expect(cuenta).toBeLessThan(accion)
  })

  test('sin dibujo ni cuenta no inventa huecos', () => {
    const html = renderToString(<SeccionPagina titulo="Historial">{null}</SeccionPagina>)

    expect(html).toContain('Historial')
    expect(html).not.toContain('<svg')
    expect(html).not.toContain('pagina__cuenta')
  })
})

describe('la tarjeta de un estado vacío', () => {
  test('lleva dibujo, titular y una línea de ayuda', () => {
    const html = renderToString(
      <EstadoVacio
        icono={Star}
        titulo="Todavía no has marcado ninguno"
        ayuda="Pulsa la estrella de la ficha."
      />,
    )

    expect(html).toContain('estado-vacio')
    expect(html).toContain('Todavía no has marcado ninguno')
    expect(html).toContain('Pulsa la estrella de la ficha.')
    expect(html).toContain('aria-hidden="true"')
  })
})
