/**
 * El picture-in-picture del navegador, por las dos puertas que existen.
 *
 * La estándar pregunta `document.pictureInPictureEnabled` y usa
 * `requestPictureInPicture`; la de WebKit —Safari, iOS— pregunta
 * `webkitSupportsPresentationMode('picture-in-picture')` y alterna con
 * `webkitSetPresentationMode`. No todos los navegadores tienen una: con
 * `false` —o sin `document`, que es el renderizado de servidor— no hay mando.
 * Un botón que sólo puede fallar es peor que no tenerlo.
 *
 * El estado no se inventa al pulsar: lo dicen los eventos del propio elemento
 * (`enterpictureinpicture`/`leavepictureinpicture` en la estándar y
 * `webkitpresentationmodechanged` en WebKit). El navegador puede rechazar la
 * petición y entonces no hay nada que anunciar; el botón sigue diciendo la
 * verdad.
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

/** Lo que Safari añade al `<video>` y TypeScript no declara. */
export interface VideoWebKit {
  readonly webkitSupportsPresentationMode?: (
    mode: 'picture-in-picture' | 'inline',
  ) => boolean | undefined
  readonly webkitPresentationMode?: 'picture-in-picture' | 'inline' | undefined
  readonly webkitSetPresentationMode?: (mode: 'picture-in-picture' | 'inline') => void
}

/** ¿El navegador ofrece la ventana flotante por la vía estándar? */
function soporteEstandar(): boolean {
  return typeof document !== 'undefined' && document.pictureInPictureEnabled === true
}

/** ¿El video está en la ventana flotante según WebKit? */
export function presentacionWebKit(video: VideoWebKit): boolean {
  return video.webkitPresentationMode === 'picture-in-picture'
}

/**
 * ¿Hay ventana flotante, por la vía que sea?
 *
 * Se exporta para poder probar la decisión sin un navegador: es la parte que
 * decide si el mando existe, y la que más fácil se rompe al tocar una rama.
 */
export function soporteDeVentanaFlotante(video: VideoWebKit | null): boolean {
  if (soporteEstandar()) return true
  if (video === null) return false

  return video.webkitSupportsPresentationMode?.('picture-in-picture') === true
}

/** ¿El video está ya en la ventana flotante? */
function enVentanaFlotante(video: HTMLVideoElement): boolean {
  const webkit = video as unknown as VideoWebKit

  if (typeof document !== 'undefined' && document.pictureInPictureElement === video) return true

  return presentacionWebKit(webkit)
}

/** La rama WebKit del elemento, si la tiene. */
function webkitDe(video: HTMLVideoElement): VideoWebKit {
  return video as unknown as VideoWebKit
}

export function usePictureInPicture(video: HTMLVideoElement | null): PictureInPictureHandle {
  const [activo, setActivo] = useState(false)
  const disponible = soporteDeVentanaFlotante(video as unknown as VideoWebKit | null)

  useEffect(() => {
    if (video === null) {
      setActivo(false)

      return
    }

    const webkit = webkitDe(video)

    // El elemento puede llegar después del primer render, cuando el `<video>`
    // ya está montado y el navegador pudo haberlo metido en la ventana flotante
    // antes de que este efecto se suscribiera.
    setActivo(enVentanaFlotante(video))

    const alEntrar = (): void => setActivo(true)
    const alSalir = (): void => setActivo(false)
    const alCambiarWebKit = (): void => setActivo(presentacionWebKit(webkit))

    video.addEventListener('enterpictureinpicture', alEntrar)
    video.addEventListener('leavepictureinpicture', alSalir)
    // TypeScript no conoce el evento de WebKit; el `EventTarget` sí acepta el
    // nombre y el navegador lo emite igual.
    const escucha = video as unknown as EventTarget
    escucha.addEventListener('webkitpresentationmodechanged', alCambiarWebKit)

    return () => {
      video.removeEventListener('enterpictureinpicture', alEntrar)
      video.removeEventListener('leavepictureinpicture', alSalir)
      escucha.removeEventListener('webkitpresentationmodechanged', alCambiarWebKit)
    }
  }, [video])

  const alternar = useCallback(async () => {
    if (!disponible || video === null) return

    const webkit = webkitDe(video)

    try {
      // La estándar manda cuando existe. Si no, WebKit: en Safari el elemento
      // ya sabe si está dentro y sólo hay que pedirle el modo contrario.
      if (soporteEstandar()) {
        // Se compara con **este** video, no con que el documento esté libre: si
        // otro elemento ocupa la ventana, pedir la de este la reemplaza, que es
        // lo que espera quien pulsa el mando del video que está viendo.
        if (enVentanaFlotante(video)) {
          await document.exitPictureInPicture()
        } else {
          await video.requestPictureInPicture()
        }

        return
      }

      const destino = presentacionWebKit(webkit) ? 'inline' : 'picture-in-picture'
      webkit.webkitSetPresentationMode?.(destino)
    } catch {
      // El navegador dijo que no. No se cambia el estado a mano: si de verdad
      // entró o salió, los eventos del elemento se encargan.
    }
  }, [disponible, video])

  return { disponible, activo, alternar }
}
