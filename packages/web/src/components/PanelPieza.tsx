/**
 * El asomo de una pieza, en panel inferior.
 *
 * En táctil no hay puntero que descubra el asomo, y en una pieza de una sola fila
 * no cabe: en los dos casos la pieza **presta** su asomo a este panel. Es el mismo
 * contenido —sinopsis, motivo y los dos mandos— en una hoja que sube desde abajo.
 *
 * Cierra de tres maneras porque las tres se intentan: el botón, el asa arrastrando
 * hacia abajo y el fondo. Y con `Escape`, que es lo que hace todo el mundo.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { type ReactNode, useEffect, useRef } from 'react'
import { t } from '../i18n'
import { Link } from '../router'

export interface PanelPiezaProps {
  readonly title: string
  readonly sinopsis?: string | undefined
  readonly motivo?: string | undefined
  /** A dónde lleva «Ver ficha». */
  readonly ficha: string
  /** A dónde lleva «Reproducir», si se conoce el episodio. */
  readonly reproducir?: string | undefined
  readonly onCerrar: () => void
}

export function PanelPieza(props: PanelPiezaProps): ReactNode {
  const cerrar = useRef<HTMLButtonElement>(null)
  const partida = useRef<number | null>(null)

  useEffect(() => {
    cerrar.current?.focus()

    const alTeclear = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape') props.onCerrar()
    }

    document.addEventListener('keydown', alTeclear)

    return () => document.removeEventListener('keydown', alTeclear)
  }, [props])

  return (
    <div className="hoja">
      <button
        type="button"
        className="hoja__fondo"
        aria-label={t(DEFAULT_LOCALE, 'home.panel.cerrar')}
        onClick={props.onCerrar}
      />

      <div className="hoja__caja" role="dialog" aria-modal="true" aria-label={props.title}>
        <button
          type="button"
          className="hoja__asa"
          aria-label={t(DEFAULT_LOCALE, 'home.panel.asa')}
          onPointerDown={(evento) => {
            partida.current = evento.clientY
            evento.currentTarget.setPointerCapture(evento.pointerId)
          }}
          onPointerUp={(evento) => {
            // Arrastrar el asa hacia abajo cierra: es el gesto que la gente intenta.
            if (partida.current !== null && evento.clientY - partida.current > 60) props.onCerrar()
            partida.current = null
          }}
        />

        <h2 className="hoja__titulo">{props.title}</h2>

        <div className="hoja__cuerpo">
          {props.sinopsis === undefined ? null : <p className="pz__sinopsis">{props.sinopsis}</p>}
          {props.motivo === undefined ? null : <p className="pz__motivo">{props.motivo}</p>}
        </div>

        <div className="pz__acciones">
          <Link to={props.ficha} className="button button--primary">
            {t(DEFAULT_LOCALE, 'home.pieza.ficha')}
          </Link>
          {props.reproducir === undefined ? null : (
            <Link to={props.reproducir} className="button">
              {t(DEFAULT_LOCALE, 'home.pieza.reproducir')}
            </Link>
          )}
        </div>

        <button ref={cerrar} type="button" className="button hoja__cerrar" onClick={props.onCerrar}>
          {t(DEFAULT_LOCALE, 'home.panel.cerrar')}
        </button>
      </div>
    </div>
  )
}
