/**
 * Los mandos a la vista y la forma que toman según el ancho del marco.
 *
 * Las dos cosas van juntas porque deciden lo mismo: **qué se ve**. La barra se
 * esconde sola mientras reproduce, y el ancho de la **columna del reproductor**
 * —no el de la ventana— decide qué mandos existen y dónde va el volumen. La
 * lista de episodios se lleva su parte, así que la ventana sola mentía: a 1024
 * la columna no cabía con el volumen dentro y la fila se partía en dos.
 *
 * Sólo se esconden mientras reproduce: en pausa no hay nada que quitar de encima
 * del fotograma y los mandos son lo único que se puede hacer. El temporizador se
 * reinicia con cualquier gesto sobre el marco y con el foco del teclado —eso lo
 * resuelve el CSS con `:focus-within`—, así que la barra vuelve antes de que
 * nadie la eche de menos.
 */

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'

/**
 * Lo que tarda la barra en esconderse sola mientras el video reproduce.
 *
 * Tres segundos: lo que se tarda en decidir que no se va a tocar nada. Menos
 * parpadea cada vez que alguien señala la pantalla, y más deja los mandos encima
 * de la imagen todo el rato, que es lo que había antes.
 */
const INACTIVIDAD_MS = 3000

/**
 * Los dos anchos a partir de los cuales la barra cambia de forma.
 *
 * En una ventana estrecha los mandos dejan de superponerse al video y se van
 * debajo, dentro del reproductor: con un video de 167 px de alto, una barra
 * encima se come la imagen. Y por debajo del segundo —un teléfono en vertical— no
 * caben los saltos de diez segundos, que en el táctil los hace el doble toque en
 * los bordes.
 *
 * Los mismos números viven en `tokens.css` como puntos de corte, porque el CSS no
 * puede leer un token dentro de un `@media`: la prueba de la hoja comprueba que
 * coincidan. Aquí deciden **qué mandos hay** —y dónde va el volumen, que en móvil
 * se muda al menú—; allí, cómo se colocan.
 */
const ANCHO_ESTRECHO = 600
const ANCHO_COMPACTO = 480

/**
 * El ancho de **columna** por debajo del cual el volumen se muda al menú.
 *
 * No es el mismo número que `ANCHO_ESTRECHO`: aquél dice cuándo los mandos dejan
 * de superponerse al video (una decisión de la ventana y de la hoja), y éste,
 * cuándo la fila ya no cabe con el volumen dentro (una decisión de la columna).
 * A 1024 px de ventana la columna mide ~612 y la fila necesita ~622: el botón de
 * pantalla completa caía solo a una segunda línea. Con 700 px de columna hay
 * margen para el volumen y para los dos botones de la derecha.
 */
const ANCHO_VOLUMEN = 700

/**
 * ¿La ventana cumple esta consulta de ancho?
 *
 * Se pregunta al montar y se escucha el cambio: girar el teléfono o encoger la
 * ventana tiene que mover el volumen al menú sin recargar la página. La primera
 * respuesta llega en un efecto y no en el render, así que en el servidor —donde no
 * hay `window`— vale «no»: la barra se pinta como la de escritorio y se corrige en
 * el primer efecto, que es antes de que el video tenga imagen.
 */
function useAnchoHasta(ancho: number): boolean {
  const [cumple, setCumple] = useState(false)

  useEffect(() => {
    const consulta = window.matchMedia(`(max-width: ${ancho}px)`)
    const alCambiar = (): void => setCumple(consulta.matches)

    alCambiar()
    consulta.addEventListener('change', alCambiar)

    return () => consulta.removeEventListener('change', alCambiar)
  }, [ancho])

  return cumple
}

/**
 * El ancho real del marco, que es el que decide la fila de mandos.
 *
 * La ventana no sirve: la lista de episodios se lleva 320–352 px, así que dos
 * ventanas del mismo ancho pueden dejar columnas muy distintas. Se observa el
 * marco que ya existe —el mismo que mide la imagen y viaja dentro del escenario
 * a pantalla completa— y se cae a la ventana sólo hasta la primera medida, que
 * es antes de que el video tenga imagen.
 */
function useAnchoDelMarco(marco: RefObject<HTMLElement | null> | undefined): number {
  const [ancho, setAncho] = useState(0)

  useEffect(() => {
    const nodo = marco?.current
    if (nodo === null || nodo === undefined) return

    setAncho(nodo.getBoundingClientRect().width)

    if (typeof ResizeObserver === 'undefined') return

    const observador = new ResizeObserver((entradas) => {
      const medida = entradas[0]?.contentRect.width
      if (medida !== undefined) setAncho(medida)
    })

    observador.observe(nodo)

    return () => observador.disconnect()
  }, [marco])

  return ancho
}

export interface MandosDelReproductor {
  /** Si la barra se ve ahora mismo. */
  readonly visibles: boolean
  /** Cualquier gesto que la enseñe y reinicie su cuenta atrás. */
  readonly despertar: () => void
  /** Ventana apretada: el volumen se muda al menú de ajustes. */
  readonly estrecho: boolean
  /** Teléfono: además, no caben los saltos de diez segundos. */
  readonly compacto: boolean
}

export function usePlayerMandos(
  reproduciendo: boolean,
  marco?: RefObject<HTMLElement | null>,
): MandosDelReproductor {
  const [visibles, setVisibles] = useState(true)
  const ventanaEstrecha = useAnchoHasta(ANCHO_ESTRECHO)
  const ventanaCompacta = useAnchoHasta(ANCHO_COMPACTO)
  const ancho = useAnchoDelMarco(marco)
  const estrecho = ancho > 0 ? ancho < ANCHO_VOLUMEN : ventanaEstrecha
  const compacto = ancho > 0 ? ancho < ANCHO_COMPACTO : ventanaCompacta
  const reloj = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const despertar = useCallback(() => {
    setVisibles(true)
    if (reloj.current !== undefined) clearTimeout(reloj.current)

    reloj.current = setTimeout(() => setVisibles(false), INACTIVIDAD_MS)
  }, [])

  useEffect(() => {
    if (reloj.current !== undefined) clearTimeout(reloj.current)

    if (!reproduciendo) {
      setVisibles(true)

      return
    }

    despertar()

    return () => {
      if (reloj.current !== undefined) clearTimeout(reloj.current)
    }
  }, [reproduciendo, despertar])

  return {
    visibles,
    despertar,
    estrecho,
    compacto,
  }
}
