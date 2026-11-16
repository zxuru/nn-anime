/**
 * Los subtítulos que están puestos: una pista del proveedor, una del manifiesto o
 * ninguno.
 *
 * El elemento trae una pista por subtítulo declarado y las pinta él: lo único que
 * hay que hacer es decirle cuál. La primera —la que el proveedor prefiere— viene
 * marcada por defecto, y aquí se puede cambiar o apagar sin salir de la pantalla,
 * que es lo que faltaba: un episodio con subtítulos forzados en otro idioma no
 * tenía arreglo.
 *
 * Las del manifiesto —las que trae la propia lista HLS— son el otro origen, y van
 * en la misma decisión: encender una apaga la otra. Ver `subtitle-menu`.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  type HlsSubtitleTrack,
  type SubtitleChoice,
  type SubtitleOption,
  subtitleAction,
  subtitleOptions,
} from './subtitle-menu'
import type { SafeTrack } from './usePlayer'

export interface SubtitulosDelReproductor {
  /** Las entradas del menú, ya resueltas para pintarlas. */
  readonly opciones: readonly SubtitleOption[]
  readonly elegir: (choice: SubtitleChoice) => void
}

export interface SubtitulosOpciones {
  /** Las pistas declaradas por el proveedor, ya filtradas. */
  readonly declaradas: readonly SafeTrack[]
  /** Las que publicó el manifiesto, si alguna. */
  readonly manifiesto: readonly HlsSubtitleTrack[]
  /** Enciende la pista del manifiesto por su índice, o las apaga con `-1`. */
  readonly pickHlsTrack: (id: number) => void
  /** El elemento, cuando React ya lo montó. */
  readonly elemento: HTMLVideoElement | null
  /** Los dos rótulos que pone el catálogo: aquí no se escribe texto de interfaz. */
  readonly ninguna: string
  readonly sinNombre: string
}

export function usePlayerSubtitulos(entrada: SubtitulosOpciones): SubtitulosDelReproductor {
  const { declaradas, manifiesto, pickHlsTrack, elemento, ninguna, sinNombre } = entrada

  const [elegida, setElegida] = useState<SubtitleChoice>(() =>
    declaradas.length === 0 ? { origen: 'ninguna' } : { origen: 'declarada', indice: 0 },
  )

  /** Aplica una elección: al elemento por un lado y a hls.js por el otro. */
  const elegir = useCallback(
    (choice: SubtitleChoice) => {
      setElegida(choice)
      pickHlsTrack(subtitleAction(choice).manifiesto)
    },
    [pickHlsTrack],
  )

  useEffect(() => {
    const video = elemento
    if (video === null) return

    const lista = video.textTracks
    const encendida = subtitleAction(elegida).declarada

    // Se recorre el número de pistas del componente y no el del elemento: al
    // cambiar de fuente —de subtitulado a doblado— el `<video>` es el mismo y sus
    // `textTracks` se rehacen, así que el efecto tiene que volver a correr cuando
    // la lista cambia aunque el elemento no. Y las que hls.js añade por su cuenta
    // —una pista del manifiesto— van **detrás** de las nuestras, así que este
    // recorrido no las toca.
    for (let indice = 0; indice < declaradas.length; indice++) {
      const actual = lista[indice]
      if (actual === undefined) continue

      actual.mode = encendida === indice ? 'showing' : 'disabled'
    }
  }, [elemento, elegida, declaradas.length])

  /**
   * Las entradas del menú: los dos orígenes en una sola lista.
   *
   * Se calcula al pintar y no se guarda: las pistas del manifiesto llegan cuando
   * hls.js lo parsea, así que una copia guardada se quedaría vieja justo en la
   * vuelta en que aparece la primera pista.
   */
  const opciones = subtitleOptions({ declaradas, manifiesto, elegida, ninguna, sinNombre })

  return { opciones, elegir }
}
