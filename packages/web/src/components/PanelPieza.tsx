/**
 * El asomo de una pieza, en panel inferior.
 *
 * En táctil no hay puntero que descubra el asomo, y en una pieza de una sola fila
 * no cabe: en los dos casos la pieza **presta** su asomo a este panel. Es el mismo
 * contenido —sinopsis, motivo y los dos mandos— en una hoja que sube desde abajo.
 *
 * Es un `<dialog>` nativo y no un `div` con `role="dialog"`: la pieza es un
 * contenedor de consulta y la hoja vive dentro, así que el `div` dependía del
 * recorte y del apilado de la pieza; el velo quedaba por debajo de la cabecera.
 * El diálogo modal se pinta en la capa superior, atrapa el foco, deja inerte lo
 * de detrás y devuelve el foco a su disparador al cerrarse. Lo que queda aquí es
 * la superficie y su movimiento.
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

/** La salida si el token no se puede leer: la misma duración que `--transition-fast`. */
const SALIDA_POR_DEFECTO = 120

/** Los milisegundos de un token de duración, o el respaldo. */
function duracionDe(nombre: string, respaldo: number): number {
  const valor = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(nombre),
  )

  return Number.isFinite(valor) && valor >= 0 ? valor : respaldo
}

export function PanelPieza(props: PanelPiezaProps): ReactNode {
  const dialogo = useRef<HTMLDialogElement>(null)
  const cerrar = useRef<HTMLButtonElement>(null)
  const partida = useRef<number | null>(null)
  const cerrando = useRef(false)

  useEffect(() => {
    const elemento = dialogo.current
    if (elemento === null) return

    if (!elemento.open) elemento.showModal()
    // El foco entra por el cierre y no por el asa: el asa es un gesto, no una
    // decisión, y quien llega con el teclado tiene que poder salir sin buscar.
    cerrar.current?.focus()

    // El diálogo nativo deja inerte lo de detrás, pero no bloquea el
    // desplazamiento del documento: sin esto, la rueda sigue moviendo la home
    // por debajo del velo.
    const anterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = anterior
      if (elemento.open) elemento.close()
    }
  }, [])

  /**
   * Cierra con la salida ya medida: el diálogo pierde `[open]`, la hoja baja y
   * el fondo se apaga; el desmontaje llega cuando termina la transición.
   *
   * El padre no puede desmontar al instante o no se vería la salida, así que la
   * demora sale del token `--transition-fast`, que el movimiento reducido deja en
   * cero y convierte el cierre en inmediato.
   */
  const salir = (): void => {
    const elemento = dialogo.current
    if (elemento === null || cerrando.current) return

    cerrando.current = true
    elemento.close()
    window.setTimeout(() => props.onCerrar(), duracionDe('--transition-fast', SALIDA_POR_DEFECTO))
  }

  return (
    <dialog
      ref={dialogo}
      className="hoja"
      aria-label={props.title}
      onCancel={(evento) => {
        evento.preventDefault()
        salir()
      }}
      onPointerDown={(evento) => {
        if (evento.target === evento.currentTarget) salir()
      }}
    >
      <div className="hoja__caja">
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
            if (partida.current !== null && evento.clientY - partida.current > 60) salir()
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

        <button ref={cerrar} type="button" className="button hoja__cerrar" onClick={salir}>
          {t(DEFAULT_LOCALE, 'home.panel.cerrar')}
        </button>
      </div>
    </dialog>
  )
}
