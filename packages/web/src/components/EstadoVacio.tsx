/**
 * Una sección vacía, explicada en una tarjeta.
 *
 * El vacío de una lista no es un error: es una función que existe y todavía no
 * se ha usado. Por eso trae el dibujo de la sección, un título corto y una línea
 * de ayuda que dice **dónde** se marca. Antes era una frase en negrita y una
 * segunda frase pegada en el mismo renglón, sin caja ni jerarquía: se leía como
 * un descuido de la pantalla y no como una explicación.
 */

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export interface EstadoVacioProps {
  readonly icono: LucideIcon
  readonly titulo: string
  readonly ayuda: string
}

export function EstadoVacio(props: EstadoVacioProps): ReactNode {
  const Icono = props.icono

  return (
    <div className="estado-vacio">
      <Icono
        className="estado-vacio__icono"
        size={20}
        strokeWidth={2}
        aria-hidden="true"
        focusable="false"
      />
      <div className="estado-vacio__texto">
        <p className="estado-vacio__titulo">{props.titulo}</p>
        <p className="estado-vacio__ayuda">{props.ayuda}</p>
      </div>
    </div>
  )
}
