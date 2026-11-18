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

export function usePictureInPicture(video: HTMLVideoElement | null): PictureInPictureHandle {
  const [activo, setActivo] = useState(false)

  const disponible = typeof document !== 'undefined' && document.pictureInPictureEnabled === true

  useEffect(() => {
    if (video === null) return

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
      if (document.pictureInPictureElement === null) {
        await video.requestPictureInPicture()
      } else {
        await document.exitPictureInPicture()
      }
    } catch {
      // El navegador dijo que no. No se cambia el estado a mano: si de verdad
      // entró o salió, los eventos del elemento se encargan.
    }
  }, [disponible, video])

  return { disponible, activo, alternar }
}
