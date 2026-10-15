/**
 * La pieza de la vitrina.
 *
 * Es la unidad del mosaico: arte dibujado —el campo de degradado que le toca por
 * posición más un recurso propio— y un pie con lo que se sepa del título. El
 * tamaño lo dice su peso (`pz--s` es una celda, `pz--m` tres de ancho por dos de
 * alto) y eso es lo que hace que la vitrina se lea como una revista.
 *
 * La pieza entera es un enlace a la ficha, y por eso el asomo que aparece con el
 * puntero encima **no lleva mandos**: dentro de un enlace, otro control sería un
 * control dentro de otro. Lo que hay que pulsar de verdad —reproducir, marcar—
 * vive en la ficha, y aquí sólo se lee.
 *
 * El arte no cambia con el tema: sobre la pieza el texto es crema en los dos,
 * porque debajo hay un degradado oscuro y no el fondo de la aplicación.
 */

import type { ReactNode } from 'react'
import { Link } from '../router'
import { Cover } from './Cover'

/** El tamaño de la pieza: una celda, dos de ancho, o dos filas de alto. */
export type PesoPieza = 's' | 'w' | 'b' | 'm'

/**
 * El recurso de arte de una pieza.
 *
 * Los seis campos de degradado dicen la posición y se reparten por `nth-child`;
 * el recurso dice **qué** pieza es, para que doce no parezcan la misma. Se elige
 * por el puesto y no al azar: el mismo título enseña el mismo dibujo en cada
 * carga.
 */
export const RECURSOS = ['trama', 'letra', 'mitad', 'cifra', 'circulo', 'caja'] as const

export type RecursoPieza = (typeof RECURSOS)[number]

/** El recurso que le toca a la pieza que va en el puesto `indice`. */
export function recursoDe(indice: number): RecursoPieza {
  return RECURSOS[indice % RECURSOS.length] ?? 'trama'
}

/**
 * Lo que se dibuja cuando la portada no llega.
 *
 * La inicial a cuerpo enorme y la cifra del año en voladizo: son texto y no un
 * degradado, así que van en su propio elemento. Se pintan **dentro del campo**, y
 * el campo sólo los deja ver cuando ha fallado la portada: si la portada llega,
 * manda la portada y el dibujo se aparta.
 */
export function arteDibujado(
  recurso: RecursoPieza,
  title: string,
  year: number | undefined,
): ReactNode {
  if (recurso === 'letra') {
    return (
      <span className="pz__letra" aria-hidden="true">
        {title.slice(0, 1)}
      </span>
    )
  }

  if (recurso === 'cifra' && year !== undefined) {
    return (
      <span className="pz__cifra" aria-hidden="true">
        {year}
      </span>
    )
  }

  return null
}

/**
 * El peso de una pieza dentro de su tramo: la que abre pesa más.
 *
 * Es lo que hace que un mosaico se lea como una revista y no como una cuadrícula:
 * el primer título del tramo manda —más superficie— y los demás lo acompañan. Los
 * tramos que ya pesan por sí mismos —lo que se retoma, el top— usan el peso
 * grande en su primera pieza y el suyo en el resto.
 */
export function pesoDelTramo(indice: number, base: PesoPieza, lider: PesoPieza): PesoPieza {
  return indice === 0 ? lider : base
}

export interface AsomoPieza {
  readonly sinopsis?: string | undefined
  readonly motivo?: string | undefined
}

export interface PiezaProps {
  readonly providerId: string
  readonly ref: string
  readonly title: string
  /** A dónde lleva la pieza. */
  readonly to: string
  /** Una celda por defecto; el peso lo elige la sección. */
  readonly peso?: PesoPieza | undefined
  readonly recurso?: RecursoPieza | undefined
  /** El año, que la cifra usa en voladizo. */
  readonly year?: number | undefined
  /** La línea de datos del pie: géneros, año, episodios. */
  readonly meta?: string | undefined
  /** El puesto del top, enorme y recortado por el borde. */
  readonly posicion?: number | undefined
  /** Lo que se retoma: el episodio y lo que queda. */
  readonly episodio?: string | undefined
  readonly resto?: string | undefined
  readonly progreso?: number | undefined
  readonly progresoEtiqueta?: string | undefined
  /** Lo que dice la pieza cuando hay puntero encima. Sólo donde cabe. */
  readonly asomo?: AsomoPieza | undefined
  /** Una pieza de favoritos, apagada: no compite con lo que no se ha empezado. */
  readonly apagada?: boolean | undefined
}

/**
 * Lo que se le pone al campo de cada recurso.
 *
 * Los dibujos van en la clase del campo y no en un elemento aparte: un `<img>` no
 * pinta pseudo-elementos, así que si la portada llega, el dibujo se aparta solo.
 * La inicial y la cifra son texto y viajan dentro del campo, por lo mismo.
 */
const CAMPO_DE_ARTE: Record<RecursoPieza, string> = {
  trama: 'pz__campo pz__campo--trama',
  letra: 'pz__campo',
  mitad: 'pz__campo pz__campo--mitad',
  cifra: 'pz__campo',
  circulo: 'pz__campo pz__campo--circulo',
  caja: 'pz__campo pz__campo--caja',
}

export function Pieza(props: PiezaProps): ReactNode {
  const peso = props.peso ?? 's'
  const recurso = props.recurso ?? 'trama'
  const clases = ['pz', `pz--${peso}`]
  if (props.apagada === true) clases.push('pz--apagada')

  return (
    <article className={clases.join(' ')}>
      <Link to={props.to} className="pz__enlace" title={props.title}>
        <span className="pz__arte" aria-hidden="true">
          <Cover providerId={props.providerId} ref={props.ref} className={CAMPO_DE_ARTE[recurso]}>
            {arteDibujado(recurso, props.title, props.year)}
          </Cover>
          <span className="pz__velo" />
        </span>

        {props.posicion === undefined ? null : (
          <span className="pz__posicion" aria-hidden="true">
            {props.posicion}
          </span>
        )}

        <span className="pz__pie">
          <span className="pz__titulo">{props.title}</span>
          {props.meta === undefined ? null : <span className="pz__meta">{props.meta}</span>}
        </span>

        {props.episodio === undefined && props.progreso === undefined ? null : (
          <span className="pz__retomar">
            <span className="pz__linea">
              {props.episodio === undefined ? null : (
                <span className="pz__ep">{props.episodio}</span>
              )}
              {props.resto === undefined ? null : <span className="pz__resto">{props.resto}</span>}
            </span>

            {props.progreso === undefined ? null : (
              <progress
                className="pz__barra-control"
                value={props.progreso}
                max={100}
                aria-label={props.progresoEtiqueta ?? props.title}
              />
            )}
          </span>
        )}

        {props.asomo === undefined ? null : (
          <span className="pz__asomo">
            {props.asomo.sinopsis === undefined ? null : (
              <span className="pz__sinopsis">{props.asomo.sinopsis}</span>
            )}
            {props.asomo.motivo === undefined ? null : (
              <span className="pz__motivo">{props.asomo.motivo}</span>
            )}
          </span>
        )}
      </Link>
    </article>
  )
}
