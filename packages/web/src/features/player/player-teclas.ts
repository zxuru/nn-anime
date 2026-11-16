/**
 * A quién le toca el `Escape` del reproductor.
 *
 * Cuatro cosas se cierran con la misma tecla —el menú de ajustes, un diálogo
 * modal, el tutorial de la guía y el modo extendido— y una sola pulsación no
 * puede cerrar dos: el gesto se siente roto y lo que se quería cerrar se queda
 * abierto. El orden vive aquí, en una función pura, porque es la regla que más
 * fácil se rompe al mover los manejadores de sitio y la única que se puede
 * probar sin navegador.
 *
 * El menú gana a todo lo demás y **también al modo extendido**: su oído va en el
 * documento y el del modo en la ventana, así que decide antes. Está escrito aquí
 * para que ese «antes» no dependa del orden en que se registren dos efectos.
 */

/** De quién es el `Escape` que acaba de llegar. */
export type DuenoDelEscape = 'menu' | 'extendido' | 'nadie'

/** Lo que hay abierto cuando se pulsa `Escape`. */
export interface EscenaDeEscape {
  /** El menú de ajustes del reproductor. */
  readonly menu: boolean
  /** Un `<dialog open>` cualquiera: la ayuda, la sala, un aviso de seguridad. */
  readonly dialogo: boolean
  /** El tutorial de la guía, que gasta su propio `Escape` para avanzar. */
  readonly tutorial: boolean
  /** La pantalla completa real: el navegador es quien la abandona. */
  readonly pantallaCompleta: boolean
  /** El modo extendido del reproductor, que sí lo quita esta tecla. */
  readonly extendido: boolean
}

export function duenoDelEscape(escena: EscenaDeEscape): DuenoDelEscape {
  if (escena.menu) return 'menu'

  // Un diálogo modal, el tutorial y la pantalla completa se quedan con la tecla:
  // el modo extendido espera a la siguiente pulsación. Con la pantalla completa
  // puesta, el navegador sale de ella y el modo sigue —son dos cosas distintas—.
  if (escena.dialogo || escena.tutorial || escena.pantallaCompleta) return 'nadie'

  return escena.extendido ? 'extendido' : 'nadie'
}
