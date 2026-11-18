/**
 * La carcasa que se abre y se cierra: el menú de ajustes, la ayuda del teclado y
 * el estado de la pantalla completa.
 *
 * El menú es un popover y no un diálogo: se abre sobre el video sin taparlo —lo
 * que se ajusta se ajusta mientras se ve— y se cierra con `Esc`, con un clic
 * fuera o volviendo a pulsar su botón, que es donde queda el foco. Los atajos sí
 * son un `<dialog>`: ahí no hay nada que mirar detrás y el navegador trae el
 * `Esc` y el encierro del foco hechos.
 *
 * Los tres comparten sitio en el hook porque comparten los mismos nodos —el
 * botón, la caja y el diálogo son las anclas del foco y del `Esc`— y porque el
 * reproductor tenía siete `useState` sólo para esto repartidos por su render.
 */

import type { RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface AjustesDelReproductor {
  readonly menu: boolean
  readonly alternarMenu: () => void
  readonly cerrarMenu: () => void
  readonly atajos: boolean
  readonly abrirAyuda: () => void
  readonly cerrarAyuda: () => void
  /** ¿Está el diálogo de la ayuda abierto? Se pregunta por la referencia: el
   * teclado lo necesita en el momento de la tecla, no en el render. */
  readonly ayudaAbierta: () => boolean
  /** El botón de ajustes: es el ancla del foco al cerrar el menú. */
  readonly botonAjustes: RefObject<HTMLButtonElement | null>
  /** La caja del menú: sirve para saber si un clic fue dentro. */
  readonly cajaAjustes: RefObject<HTMLDivElement | null>
  /** El diálogo de atajos, que se abre con la API del elemento. */
  readonly dialogoAtajos: RefObject<HTMLDialogElement | null>
  /** Si se está a pantalla completa, que es lo que decide el dibujo del mando. */
  readonly completa: boolean
}

export function usePlayerAjustes(
  escenario?: RefObject<HTMLDivElement | null>,
): AjustesDelReproductor {
  const [menu, setMenu] = useState(false)
  const [atajos, setAtajos] = useState(false)
  const botonAjustes = useRef<HTMLButtonElement | null>(null)
  const cajaAjustes = useRef<HTMLDivElement | null>(null)
  const dialogoAtajos = useRef<HTMLDialogElement | null>(null)

  const alternarMenu = useCallback(() => setMenu((abierto) => !abierto), [])
  const cerrarMenu = useCallback(() => setMenu(false), [])
  const abrirAyuda = useCallback(() => setAtajos(true), [])
  const cerrarAyuda = useCallback(() => setAtajos(false), [])
  const ayudaAbierta = useCallback(() => dialogoAtajos.current?.open === true, [])

  // El diálogo se abre con la API del elemento y no con un atributo: `showModal`
  // es lo que trae el `Esc`, el encierro del foco y el fondo inerte.
  useEffect(() => {
    const dialogo = dialogoAtajos.current
    if (dialogo === null) return

    if (atajos && !dialogo.open) dialogo.showModal()
    if (!atajos && dialogo.open) dialogo.close()
  }, [atajos])

  // Fuera del menú, y con `Esc`, se cierra. El manejador sólo existe mientras
  // está abierto: uno permanente escucharía clics de toda la aplicación.
  useEffect(() => {
    if (!menu) return

    const alPulsar = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return

      // El gesto es del menú y se queda aquí: sin cortar la propagación, el
      // mismo Escape llegaba al oído de la ventana y apagaba además el modo
      // extendido, que es justo lo que este manejador existe para evitar.
      evento.stopPropagation()

      cerrarMenu()
      botonAjustes.current?.focus()
    }
    const alPulsarFuera = (evento: PointerEvent): void => {
      if (!(evento.target instanceof Node)) return
      if (cajaAjustes.current?.contains(evento.target) === true) return
      if (botonAjustes.current?.contains(evento.target) === true) return

      cerrarMenu()
    }

    document.addEventListener('keydown', alPulsar)
    document.addEventListener('pointerdown', alPulsarFuera)

    return () => {
      document.removeEventListener('keydown', alPulsar)
      document.removeEventListener('pointerdown', alPulsarFuera)
    }
  }, [menu, cerrarMenu])

  // La forma del mando de pantalla completa la decide el navegador: el mismo
  // gesto entra y sale, y también se sale con `Esc`, así que hay que escuchar el
  // cambio o el dibujo se quedaría diciendo «entrar» dentro de la pantalla.
  const [completa, setCompleta] = useState(false)

  useEffect(() => {
    // Se compara con el escenario y no con «hay algo a pantalla completa»: el
    // reproductor la pide sobre su escenario —el marco y los mandos—, y el día
    // que otro elemento de la página la pida, el mando no puede decir que el
    // video está a pantalla completa. Sin escenario —otros montajes— vale la
    // pregunta general.
    const alCambiar = (): void =>
      setCompleta(
        escenario === undefined
          ? document.fullscreenElement !== null
          : document.fullscreenElement === escenario.current,
      )

    document.addEventListener('fullscreenchange', alCambiar)

    return () => document.removeEventListener('fullscreenchange', alCambiar)
  }, [escenario])

  return {
    menu,
    alternarMenu,
    cerrarMenu,
    atajos,
    abrirAyuda,
    cerrarAyuda,
    ayudaAbierta,
    botonAjustes,
    cajaAjustes,
    dialogoAtajos,
    completa,
  }
}
