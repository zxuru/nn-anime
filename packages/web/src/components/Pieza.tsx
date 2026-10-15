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

export function Pieza(props: PiezaProps): ReactNode {
  const peso = props.peso ?? 's'
  const recurso = props.recurso ?? 'trama'
  const clases = ['pz', `pz--${peso}`]
  if (props.apagada === true) clases.push('pz--apagada')

  // Los recursos que son un dibujo van en clase; la inicial y la cifra son texto
  // y van en su propio elemento, porque el CSS no sabe qué letra es.
  const dibujo =
    recurso === 'letra' || recurso === 'cifra' ? 'pz__arte' : `pz__arte pz__arte--${recurso}`

  return (
    <article className={clases.join(' ')}>
      <Link to={props.to} className="pz__enlace" title={props.title}>
        <span className={dibujo} aria-hidden="true">
          <Cover providerId={props.providerId} ref={props.ref} className="pz__campo" />
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

        {recurso === 'letra' ? (
          <span className="pz__letra" aria-hidden="true">
            {props.title.slice(0, 1)}
          </span>
        ) : null}

        {recurso === 'cifra' && props.year !== undefined ? (
          <span className="pz__cifra" aria-hidden="true">
            {props.year}
          </span>
        ) : null}
      </Link>
    </article>
  )
}
