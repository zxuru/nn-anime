/**
 * El picture-in-picture del navegador.
 *
 * No todos los navegadores lo tienen: `document.pictureInPictureEnabled` es la
 * pregunta que lo dice, y con `false` —o sin `document`, que es el renderizado
 * de servidor— no hay mando. Un botón que sólo puede fallar es peor que no
 * tenerlo.
 *
 * El estado no se inventa al pulsar: lo dicen los eventos del propio elemento
 * (`enterpictureinpicture` y `leavepictureinpicture`). El navegador puede
 * rechazar la petición —sin gesto, sin permiso, con el reproductor ya ocupado—
 * y entonces no hay nada que anunciar; el botón sigue diciendo la verdad.
 *
 * El estado inicial se lee del documento, no se supone `false`: al volver de una
 * pantalla en la que el video ya estaba en la ventana flotante, el mando nace
 * encendido. Es la diferencia entre un interruptor y un botón que miente hasta
 * el primer clic.
 */

import { useCallback, useEffect, useState } from 'react'

export interface PictureInPictureHandle {
  /** ¿El navegador ofrece la función? */
  readonly disponible: boolean
  /** ¿Está el video ahora mismo en la ventana flotante? */
  readonly activo: boolean
  /** Entra o sale, según el estado que diga el documento. */
  readonly alternar: () => Promise<void>
}

/** ¿El navegador ofrece la ventana flotante? */
function soporteEstandar(): boolean {
  return typeof document !== 'undefined' && document.pictureInPictureEnabled === true
}

/** El video que el documento tiene en la ventana flotante, si hay alguno. */
function enVentanaFlotante(video: HTMLVideoElement): boolean {
  return typeof document !== 'undefined' && document.pictureInPictureElement === video
}

export function usePictureInPicture(video: HTMLVideoElement | null): PictureInPictureHandle {
  const [activo, setActivo] = useState(false)
  const disponible = soporteEstandar()

  useEffect(() => {
    if (video === null) {
      setActivo(false)

      return
    }

    // El elemento puede llegar después del primer render, cuando el `<video>`
    // ya está montado y el navegador pudo haberlo metido en la ventana flotante
    // antes de que este efecto se suscribiera.
    setActivo(enVentanaFlotante(video))

    const alEntrar = (): void => setActivo(true)
    const alSalir = (): void => setActivo(false)

    video.addEventListener('enterpictureinpicture', alEntrar)
    video.addEventListener('leavepictureinpicture', alSalir)

    return () => {
      video.removeEventListener('enterpictureinpicture', alEntrar)
      video.removeEventListener('leavepictureinpicture', alSalir)
    }
  }, [video])

  const alternar = useCallback(async () => {
    if (!disponible || video === null) return

    try {
      // Se compara con **este** video, no con que el documento esté libre: si
      // otro elemento ocupa la ventana, pedir la de este la reemplaza, que es
      // lo que espera quien pulsa el mando del video que está viendo.
      if (enVentanaFlotante(video)) {
        await document.exitPictureInPicture()
      } else {
        await video.requestPictureInPicture()
      }
    } catch {
      // El navegador dijo que no. No se cambia el estado a mano: si de verdad
      // entró o salió, los eventos del elemento se encargan.
    }
  }, [disponible, video])

  return { disponible, activo, alternar }
}
