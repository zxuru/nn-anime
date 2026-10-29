/**
 * La pieza de la vitrina.
 *
 * Es la unidad del mosaico: arte dibujado —el campo de degradado que le toca por
 * posición más un recurso propio—, el pie con lo que se sepa del título y, en las
 * que lo llevan, el puesto del top y lo que se retoma.
 *
 * **Todas pesan lo mismo**: un cartel de una columna, con la proporción de una
 * portada (2:3). El tamaño decía la jerarquía mientras el mosaico fue ancho, pero
 * una pieza de dos columnas dejaba tres títulos a la vista con un hueco al lado y
 * once en una fila de dos; la rejilla apretada enseña seis veces más títulos por
 * fila y no deja huecos. Lo que distingue una pieza de otra fila es lo que lleva
 * dentro —el puesto, la barra de lo que se retoma— y el orden de los tramos, no el
 * ancho.
 *
 * **El cuerpo de la pieza es un enlace de verdad** —el arte y el pie— y lo que se
 * pulsa vive fuera de él: el botón «i», que abre la hoja, y los dos mandos del
 * asomo. Un control dentro de otro control no es un control, y la navegación por
 * teclado de la cuadrícula cuenta con el enlace.
 *
 * El arte no cambia con el tema: sobre la pieza el texto es crema en los dos,
 * porque debajo hay un degradado oscuro y no el fondo de la aplicación.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { type ReactNode, useState } from 'react'
import { t } from '../i18n'
import { Link } from '../router'
import { Cover } from './Cover'
import { PanelPieza } from './PanelPieza'

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
 * degradado, así que van en su propio elemento. Viajan **dentro del campo**, y el
 * campo sólo los deja ver cuando ha fallado la portada: si la portada llega,
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
 * Lo que se le pone al campo de cada recurso.
 *
 * Los dibujos van en la clase del campo y no en un elemento aparte: un `<img>` no
 * pinta pseudo-elementos, así que si la portada llega, el dibujo se aparta solo.
 */
const CAMPO_DE_ARTE: Record<RecursoPieza, string> = {
  trama: 'pz__campo pz__campo--trama',
  letra: 'pz__campo',
  mitad: 'pz__campo pz__campo--mitad',
  cifra: 'pz__campo',
  circulo: 'pz__campo pz__campo--circulo',
  caja: 'pz__campo pz__campo--caja',
}

export interface PiezaProps {
  /** La referencia local, cuando la pieza es de una ficha. */
  readonly providerId?: string | undefined
  readonly ref?: string | undefined
  /** Una ruta de portada ya compuesta —la de AniList— que gana sobre la referencia. */
  readonly portada?: string | undefined
  readonly title: string
  /** A dónde lleva el cuerpo de la pieza: la ficha o la búsqueda. */
  readonly to: string
  readonly recurso?: RecursoPieza | undefined
  /** El año, que la cifra usa en voladizo. */
  readonly year?: number | undefined
  /** La línea de datos del pie: géneros, año, episodios. */
  readonly meta?: string | undefined
  /** El puesto del top: la cifra, entera y con su velo debajo. */
  readonly posicion?: number | undefined
  /** Lo que se retoma: el episodio y lo que queda. */
  readonly episodio?: string | undefined
  readonly resto?: string | undefined
  readonly progreso?: number | undefined
  readonly progresoEtiqueta?: string | undefined
  /** El sello de origen y de otras fuentes, en Buscar. */
  readonly sello?: readonly string[] | undefined
  /** Lo que cuenta la pieza: sinopsis y motivo, en el asomo y en la hoja. */
  readonly sinopsis?: string | undefined
  readonly motivo?: string | undefined
  /** A dónde lleva «Reproducir», si se conoce el episodio. */
  readonly reproducir?: string | undefined
  /** Una pieza de favoritos, apagada: no compite con lo que no se ha empezado. */
  readonly apagada?: boolean | undefined
}

export function Pieza(props: PiezaProps): ReactNode {
  const recurso = props.recurso ?? 'trama'
  const [abierta, setAbierta] = useState(false)
  const hayHoja = props.sinopsis !== undefined || props.motivo !== undefined
  // La pieza numerada lleva el velo de su cifra: sobre una portada clara, el crema
  // del puesto no se lee. Va en la clase y no en un estilo suelto para que la hoja
  // —y no el componente— decida cómo se oscurece.
  const clases = `pz${props.apagada === true ? ' pz--apagada' : ''}${
    props.posicion === undefined ? '' : ' pz--puesto'
  }`

  return (
    <article className={clases}>
      <Link to={props.to} className="pz__enlace" title={props.title}>
        <span className="pz__arte" aria-hidden="true">
          <Cover
            {...(props.providerId === undefined ? {} : { providerId: props.providerId })}
            {...(props.ref === undefined ? {} : { ref: props.ref })}
            {...(props.portada === undefined ? {} : { src: props.portada })}
            className={CAMPO_DE_ARTE[recurso]}
          >
            {arteDibujado(recurso, props.title, props.year)}
          </Cover>
          <span className="pz__velo" />
        </span>

        {props.sello === undefined ? null : (
          <span className="pz__sello">
            {props.sello.map((texto) => (
              <span key={texto}>{texto}</span>
            ))}
          </span>
        )}

        {props.posicion === undefined ? null : (
          <span className="pz__posicion" aria-hidden="true">
            {props.posicion}
          </span>
        )}

        <span className="pz__pie">
          <span className="pz__titulo">
            {props.posicion === undefined ? null : (
              <span className="solo-lectores">{props.posicion}. </span>
            )}
            {props.title}
          </span>
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
      </Link>

      {hayHoja ? (
        <button
          type="button"
          className="pz__abrir"
          aria-label={t(DEFAULT_LOCALE, 'home.pieza.abrir', { title: props.title })}
          onClick={() => setAbierta(true)}
        />
      ) : null}

      {hayHoja ? (
        <span className="pz__asomo">
          {props.sinopsis === undefined ? null : (
            <span className="pz__sinopsis">{props.sinopsis}</span>
          )}
          {props.motivo === undefined ? null : <span className="pz__motivo">{props.motivo}</span>}
          <span className="pz__acciones">
            <Link to={props.to} className="button button--primary">
              {t(DEFAULT_LOCALE, 'home.pieza.ficha')}
            </Link>
            {props.reproducir === undefined ? null : (
              <Link to={props.reproducir} className="button">
                {t(DEFAULT_LOCALE, 'home.pieza.reproducir')}
              </Link>
            )}
          </span>
        </span>
      ) : null}

      {abierta && hayHoja ? (
        <PanelPieza
          title={props.title}
          sinopsis={props.sinopsis}
          motivo={props.motivo}
          ficha={props.to}
          reproducir={props.reproducir}
          onCerrar={() => setAbierta(false)}
        />
      ) : null}
    </article>
  )
}
