/**
 * La confirmación de una acción destructiva.
 *
 * Borrar un episodio descargado o una carpeta entera no se deshace, así que el
 * gesto se parte en dos: el botón que borra abre esto y aquí se decide. No es un
 * `confirm()` del navegador —bloquea el hilo, no se puede vestir con los tokens y
 * en una ventana de escritorio aparece fuera de sitio— ni un `div` con
 * `aria-modal`: es un `<dialog>` nativo, que trae el `Esc`, el encierro del foco
 * y el velo sin reproducirlos a mano.
 *
 * El componente no sabe qué se borra: recibe el título, el cuerpo y la etiqueta
 * del botón ya traducidos. Así lo usan la biblioteca y los repositorios de
 * proveedores sin compartir textos ni estados.
 */

import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'

export interface ConfirmacionProps {
  readonly open: boolean
  readonly titulo: string
  readonly cuerpo: string
  /** La etiqueta del botón que confirma. «Eliminar», «Borrar completadas»… */
  readonly confirmar: string
  readonly cancelar: string
  readonly onConfirmar: () => void
  readonly onCerrar: () => void
}

export function Confirmacion(props: ConfirmacionProps): ReactNode {
  const dialogo = useRef<HTMLDialogElement>(null)

  /*
   * El `open` de React no sirve para un `<dialog>`: es un atributo del DOM que
   * no abre el modo modal. Se abre y se cierra con los métodos nativos en un
   * efecto, y el cierre por `Esc` vuelve por `onClose`, que es el mismo camino
   * que el botón de cancelar.
   */
  useEffect(() => {
    const nodo = dialogo.current
    if (nodo === null) return

    if (props.open && !nodo.open) nodo.showModal()
    else if (!props.open && nodo.open) nodo.close()
  }, [props.open])

  return (
    <dialog
      ref={dialogo}
      className="confirmacion"
      aria-labelledby="confirmacion-titulo"
      onClose={props.onCerrar}
    >
      <h2 className="confirmacion__titulo" id="confirmacion-titulo">
        {props.titulo}
      </h2>
      <p className="confirmacion__cuerpo">{props.cuerpo}</p>
      <div className="confirmacion__acciones">
        <button type="button" className="button" onClick={props.onCerrar}>
          {props.cancelar}
        </button>
        <button
          type="button"
          className="button confirmacion__borrar"
          onClick={() => {
            props.onConfirmar()
            props.onCerrar()
          }}
        >
          {props.confirmar}
        </button>
      </div>
    </dialog>
  )
}
