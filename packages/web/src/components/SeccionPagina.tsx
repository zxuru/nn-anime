/**
 * La cabecera de una sección de página.
 *
 * En las pantallas de lista —Perfil, Biblioteca, Ajustes— la sección no es un
 * tramo de la vitrina: su cabecera es **una fila** con el título y su dibujo a la
 * izquierda, la explicación a continuación y, a la derecha, la cuenta y el enlace
 * de «ver todo». Eso es lo que comparten las cuatro secciones del Perfil y lo que
 * evita que cada una invente su reparto.
 *
 * No confundir con `SectionHeader`, que es la nota de la vitrina: ahí el titular
 * vive al margen del mosaico y su sitio lo decide la rejilla de doce columnas.
 * Una lista de tarjetas no tiene margen donde ponerlo.
 */

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export interface SeccionPaginaProps {
  readonly titulo: string
  /** El dibujo del título: `Star`, `CircleCheck`, `Bookmark`, `History`… */
  readonly icono?: LucideIcon | undefined
  /** La línea gris que explica la sección. */
  readonly meta?: string | undefined
  /** La cuenta, a la derecha: «3 títulos». */
  readonly cuenta?: string | undefined
  /** El enlace de «ver todo», a la derecha de la cuenta. */
  readonly accion?: ReactNode | undefined
  readonly children: ReactNode
  readonly dataTour?: string | undefined
}

export function SeccionPagina(props: SeccionPaginaProps): ReactNode {
  const Icono = props.icono

  return (
    <section className="pagina__seccion" data-tour={props.dataTour}>
      <header className="pagina__cabecera">
        <h2 className="pagina__titulo">
          {Icono === undefined ? null : (
            <Icono
              className="pagina__icono"
              size={18}
              strokeWidth={2}
              aria-hidden="true"
              focusable="false"
            />
          )}
          {props.titulo}
        </h2>
        {props.meta === undefined ? null : <p className="pagina__meta">{props.meta}</p>}
        {props.cuenta === undefined ? null : <span className="pagina__cuenta">{props.cuenta}</span>}
        {props.accion === undefined ? null : <span className="pagina__accion">{props.accion}</span>}
      </header>

      {props.children}
    </section>
  )
}
