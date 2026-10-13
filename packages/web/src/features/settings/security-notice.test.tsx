import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { ApiError } from '../../api/client'
import { describirFallo } from '../../api/fallo'
import { SecurityNotice, SecurityNoticeDialog } from './SecurityNotice'

/**
 * El aviso de seguridad, montado.
 *
 * Lo que se comprueba aquí es lo que pedía el fallo original: que `/settings`
 * **contenga** el documento, no que mande a un archivo que puede no existir. Se
 * monta el documento de verdad —el mismo `SECURITY.md` que se importa en el
 * componente— y se mira que salga en elementos, sin marcas de markdown a la
 * vista.
 */

const DOC = fileURLToPath(new URL('../../../../../SECURITY.md', import.meta.url))

function render(node: ReactNode): string {
  return renderToString(node)
}

async function documento(): Promise<string> {
  return await Bun.file(DOC).text()
}

describe('el documento, en elementos', () => {
  test('traduce títulos, párrafos, listas y la tabla', async () => {
    const html = render(<SecurityNotice markdown={await documento()} />)

    expect(html).toContain('<h3>Seguridad de nn-anime</h3>')
    expect(html).toContain('Riesgo residual, en texto claro')
    expect(html).toContain('<table')
    expect(html).toContain('scope="col"')
    expect(html).toContain('<ol>')
    expect(html).toContain('<li>')
    expect(html).toContain('<strong>plugins de terceros</strong>')
    expect(html).toContain('<code>HttpOnly; SameSite=Strict</code>')
  })

  test('no queda ninguna marca de markdown a la vista', async () => {
    const html = render(<SecurityNotice markdown={await documento()} />)

    expect(html).not.toContain('##')
    expect(html).not.toContain('**')
    expect(html).not.toContain('|---')
  })

  test('la tabla lleva su cabecera como encabezado, no como fila cualquiera', async () => {
    const html = render(<SecurityNotice markdown={await documento()} />)

    expect(html.match(/scope="col"/g)).toHaveLength(3)
    expect(html).toContain('<th')
    expect(html).not.toContain('tabindex')
  })
})

/**
 * El documento es una fuente de verdad, no un folleto: declara lo que está
 * mitigado y lo que no. Estas pruebas son las que impiden que vuelva a decir que
 * el rebinding es imposible de cerrar —lo decía, y era falso— o que deje de
 * declarar lo que el código no cubre.
 */
describe('lo que el documento declara', () => {
  test('el rebinding ya no se declara imposible de cerrar', async () => {
    const markdown = await documento()

    expect(markdown).not.toContain('rompe SNI')
    expect(markdown).not.toContain('riesgo aceptado')
  })

  test('dice con qué se cierra, y en qué rutas', async () => {
    const markdown = await documento()

    // La frase del renglón, no la de la tabla: la tabla también dice «una vez» y
    // «T110», así que una prueba que sólo mirara eso pasaría con el riesgo
    // residual restaurado. Medido: con el texto anterior, esta prueba se pone
    // roja.
    expect(markdown).toContain('así que el certificado se sigue validando contra el nombre')
    expect(markdown).toContain('el proxy de bytes (`pinned-fetch.ts`)')
    expect(markdown).toContain('T110')
  })

  test('mantiene declarado lo que el código no cubre: un plugin que salga por el fetch global', async () => {
    const markdown = await documento()

    expect(markdown).toContain('`fetch` global')
    expect(markdown).toContain('se salte la lista blanca')
  })
})

describe('el diálogo', () => {
  test('enseña el documento y el enlace al archivo, cerrado por defecto', async () => {
    const html = render(
      <SecurityNoticeDialog open={false} onClose={() => {}} markdown={await documento()} />,
    )

    expect(html).toContain('<dialog')
    expect(html).toContain('Antes de copiar un plugin, lee esto')
    expect(html).toContain('Riesgo residual, en texto claro')
    expect(html).toContain('href="/SECURITY.md"')
    expect(html).toContain('Cerrar')
    // El atributo `open` no se pone a mano: lo pone `showModal`, que es lo que
    // además atrapa el foco y habilita `Esc`.
    expect(html).not.toContain(' open=""')
  })

  test('el diálogo se anuncia con su título', async () => {
    const html = render(<SecurityNoticeDialog open onClose={() => {}} markdown="# Hola" />)

    expect(html).toContain('aria-labelledby="security-notice-title"')
    expect(html).toContain('id="security-notice-title"')
  })

  test('mientras el documento viaja lo dice, y no enseña un hueco', async () => {
    const html = render(<SecurityNoticeDialog open onClose={() => {}} />)

    expect(html).toContain('Cargando el aviso de seguridad')
    expect(html).not.toContain('<table')
  })

  test('si el documento no llega, lo dice con el motivo', async () => {
    const html = render(
      <SecurityNoticeDialog
        open
        onClose={() => {}}
        error={describirFallo(new ApiError(404, 'GET /SECURITY.md respondió 404'))}
      />,
    )

    // Lo que se enseña es la clase del fallo —no está— y el mensaje crudo queda
    // plegado, para quien tenga que buscar el fallo en los registros.
    expect(html).toContain('Ese título no está')
    expect(html).toContain('GET /SECURITY.md respondió 404')
    expect(html).toContain('fallo')
  })
})
