/**
 * El teclado del reproductor, escuchado en la ventana.
 *
 * Se escucha en la ventana y no en el elemento porque el foco puede estar en el
 * propio video o en la página, y obligar a enfocar el reproductor para usar las
 * flechas es una molestia que no hace falta. `keyAction` decide cuándo no hacer
 * nada —un campo de texto, un atajo del navegador— y `duenoDelEscape` decide a
 * quién le toca la tecla que cierra cosas.
 *
 * Lo que sí vive aquí y no en `controls.ts` es el gesto de la ayuda (`?`), que no
 * es una acción del reproductor sino una pregunta: la contesta un diálogo.
 */

import { useEffect } from 'react'
import { isTypingTarget, keyAction, type PlayerAction } from './controls'
import { duenoDelEscape } from './player-teclas'

export interface TecladoOpciones {
  readonly act: (accion: PlayerAction) => void
  /** El salto lo resuelve la pantalla: `act` sólo puede tocar el elemento. */
  readonly saltar: () => void
  readonly alternarExtendido: () => void
  readonly extendido: boolean
  readonly menu: boolean
  /** ¿Está el diálogo de la ayuda abierto? Se pregunta al llegar la tecla. */
  readonly ayudaAbierta: () => boolean
  readonly abrirAyuda: () => void
  /** Cualquier tecla que el reproductor entiende enseña los mandos. */
  readonly despertarMandos: () => void
}

export function usePlayerTeclado(opciones: TecladoOpciones): void {
  const {
    act,
    saltar,
    alternarExtendido,
    extendido,
    menu,
    ayudaAbierta,
    abrirAyuda,
    despertarMandos,
  } = opciones

  useEffect(() => {
    const alPulsar = (evento: KeyboardEvent): void => {
      const objetivo = {
        key: evento.key,
        tagName: (evento.target as HTMLElement | null)?.tagName,
        isContentEditable: (evento.target as HTMLElement | null)?.isContentEditable,
        ctrlKey: evento.ctrlKey,
        metaKey: evento.metaKey,
        altKey: evento.altKey,
      }

      // `?` abre la ayuda de los atajos. Va antes que los mandos y no dentro de
      // `keyAction` porque no es una acción del reproductor.
      if (evento.key === '?' && !isTypingTarget(objetivo)) {
        evento.preventDefault()
        abrirAyuda()

        return
      }

      // Con la ayuda abierta, las teclas son del diálogo: la barra espaciadora
      // no puede pausar el video que hay detrás del velo.
      if (ayudaAbierta()) return

      /*
        Escape sale del modo extendido, y sólo de eso.

        Si el menú de ajustes está abierto, ese Escape es suyo: su manejador
        escucha antes —en el documento, no en la ventana— y cierra el menú. Con
        la pantalla completa real puesta, el navegador es quien la abandona: el
        modo extendido se queda y el siguiente Escape es el que lo quita. Así un
        solo gesto no cierra dos cosas a la vez.
      */
      if (evento.key === 'Escape') {
        const dueno = duenoDelEscape({
          menu,
          dialogo: document.querySelector('dialog[open]') !== null,
          tutorial: document.body.classList.contains('driver-active'),
          pantallaCompleta: document.fullscreenElement !== null,
          extendido,
        })

        if (dueno !== 'extendido') return

        evento.preventDefault()
        alternarExtendido()

        return
      }

      const accion = keyAction(objetivo)

      if (accion === undefined) return

      // Cualquier tecla que el reproductor entiende enseña los mandos: se está
      // usándolo, y esconderlos mientras alguien busca el mando con el teclado
      // sería esconderle lo que hace.
      despertarMandos()
      evento.preventDefault()

      // El salto no es una acción del elemento —`act` sólo tiene el video, y un
      // `currentTime` sin destino no es un salto—: lo resuelve la misma función
      // que el botón.
      if (accion === 'skip') {
        saltar()

        return
      }

      // El modo extendido no es una acción del elemento de video: la resuelve
      // la pantalla y no `act`.
      if (accion === 'extended') {
        alternarExtendido()

        return
      }

      act(accion)
    }

    window.addEventListener('keydown', alPulsar)

    return () => window.removeEventListener('keydown', alPulsar)
  }, [act, saltar, alternarExtendido, extendido, menu, ayudaAbierta, abrirAyuda, despertarMandos])
}
