/**
 * La pieza de la vitrina.
 *
 * Es la unidad del mosaico: arte dibujado —el campo de degradado que le toca por
 * posición más un recurso propio—, el pie con lo que se sepa del título y, en las
 * que lo llevan, el puesto del top, lo que se retoma y la puntuación del motor. El
 * tamaño lo dice su peso (`pz--s` es una celda; `pz--m`, tres de ancho por dos de
 * alto) y eso es lo que hace que la vitrina se lea como una revista.
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

/** El tamaño de la pieza: una celda, dos de ancho, o dos filas de alto. */
export type PesoPieza = 's' | 'w' | 'b' | 'm'

/** Las clases de cada peso, literales: una clase armada a mano no se lee. */
const CLASES_DE_PESO: Record<PesoPieza, string> = {
  s: 'pz pz--s',
  w: 'pz pz--w',
  b: 'pz pz--b',
  m: 'pz pz--m',
}

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

/**
 * Un vacío, en dos renglones.
 *
 * La vitrina explica un vacío con la forma de una pieza fantasma: un titular y su
 * cuerpo, como en las que sí traen algo. Los textos del catálogo ya vienen en una
 * frase —«Nada a medias. Lo que empieces aparecerá aquí.»— y el primer punto es el
 * corte natural entre el titular y el cuerpo. Un vacío de una sola frase se queda
 * con el titular y sin cuerpo: un hueco con un guion es peor que un hueco.
 */
export function tituloYCuerpo(texto: string): { readonly title: string; readonly body?: string } {
  const corte = texto.indexOf('. ')

  if (corte === -1) return { title: texto }

  return { title: texto.slice(0, corte), body: texto.slice(corte + 2) }
}

export interface PiezaProps {
  readonly providerId: string
  readonly ref: string
  readonly title: string
  /** A dónde lleva el cuerpo de la pieza: la ficha. */
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
  /** La puntuación del motor, cuando ha podido calcularse. */
  readonly puntuacion?: number | undefined
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
  const peso = props.peso ?? 's'
  const recurso = props.recurso ?? 'trama'
  const [abierta, setAbierta] = useState(false)
  const hayHoja = props.sinopsis !== undefined || props.motivo !== undefined
  const clases =
    props.apagada === true ? `${CLASES_DE_PESO[peso]} pz--apagada` : CLASES_DE_PESO[peso]

  return (
    <article className={clases}>
      <Link to={props.to} className="pz__enlace" title={props.title}>
        <span className="pz__arte" aria-hidden="true">
          <Cover providerId={props.providerId} ref={props.ref} className={CAMPO_DE_ARTE[recurso]}>
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

        {props.puntuacion === undefined ? null : (
          <span className="pz__punto">
            {t(DEFAULT_LOCALE, 'reco.score', { score: props.puntuacion.toFixed(3) })}
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
