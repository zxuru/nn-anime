import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { DownloadFolder } from './DownloadFolder'

/**
 * El campo de la carpeta de descargas.
 *
 * Se mide lo que decide la forma del control y no su dibujo: que enseñe la
 * carpeta que anuncia el servidor, que en el navegador se escriba a mano y que
 * el diálogo nativo aparezca **sólo** cuando hay anfitrión detrás —ofrecerlo en
 * la web llamaría a un IPC que no existe—. El recorrido completo de guardar una
 * ruta lo mide el e2e, que es donde hay navegador.
 */

function render(current: string | undefined): string {
  return renderToString(<DownloadFolder current={current} onSave={async () => {}} />)
}

/** El anfitrión existe para la función que lo detecta; se quita al terminar. */
function conAnfitrion(): () => void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: { invoke: async () => null } },
  })

  return () => {
    Reflect.deleteProperty(globalThis, 'window')
  }
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

  test('en el navegador no se ofrece el diálogo nativo', () => {
    const html = render('/srv/videos')

    expect(html).not.toContain('Elegir carpeta')
  })

  test('con el anfitrión detrás se ofrece el diálogo nativo', () => {
    const quitar = conAnfitrion()

    try {
      expect(render('/srv/videos')).toContain('Elegir carpeta')
    } finally {
      quitar()
    }
  })
})
