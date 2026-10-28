import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { DownloadFolder } from './DownloadFolder'

/**
 * El campo de la carpeta de descargas.
 *
 * Se mide lo que decide la forma del control y no su dibujo: que enseñe la
 * carpeta que anuncia el servidor, que se pueda escribir a mano y que el
 * explorador esté montado para el clic que no tiene anfitrión detrás. El
 * recorrido completo —elegir en el explorador y guardarlo— lo mide el e2e, que es
 * donde hay navegador.
 */

function render(current: string | undefined): string {
  return renderToString(<DownloadFolder current={current} onSave={async () => {}} />)
}

describe('la carpeta de descargas', () => {
  test('el campo enseña la carpeta que dice el servidor y se puede escribir', () => {
    const html = render('D:\\Videos\\nn-anime')

    expect(html).toContain('value="D:\\Videos\\nn-anime"')
    expect(html).toContain('Carpeta de descargas')
    expect(html).toContain('Se guardan en')
    expect(html).toContain('Guardar carpeta')
    // La ayuda va descrita al campo, no suelta al lado: quien navega con lector
    // de pantalla oye el ejemplo al enfocar el campo y no al pasar de largo.
    expect(html).toContain('aria-describedby="downloads-folder-hint"')
  })

  test('sin carpeta todavía el campo sale vacío y no se puede guardar', () => {
    const html = render(undefined)

    expect(html).toContain('value=""')
    expect(html).toContain('disabled')
  })

  test('elegir carpeta se ofrece siempre y monta el explorador', () => {
    // Con anfitrión el clic abre el diálogo del sistema y sin él el explorador de
    // la aplicación; el botón es el mismo, así que se pinta en los dos casos y
    // quién lo atiende se decide al pulsar.
    const html = render('/srv/videos')

    expect(html).toContain('Elegir carpeta')
    expect(html).toContain('Usar esta carpeta')
  })
})
