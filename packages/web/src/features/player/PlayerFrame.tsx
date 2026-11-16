/**
 * El marco: el `<video>`, sus pistas y las capas que van encima.
 *
 * Es la caja que mide el video, y por eso el botón grande, la espera y el lienzo
 * del modo compatible se centran en **la imagen** y no en la caja entera: en una
 * ventana estrecha los mandos van debajo, dentro del escenario, y centrar sobre el
 * escenario dejaría el botón fuera del video.
 *
 * El elemento sigue siendo un `<video>` de verdad cuando el modo compatible pinta
 * el lienzo: es quien reproduce, quien lleva los subtítulos y quien habla con
 * hls.js. El lienzo sólo tapa lo que se ve.
 *
 * Los hijos son las capas que decide el reproductor —el botón grande de
 * reproducir—, y van entre el lienzo y el cartel de la espera: el cartel es lo
 * último porque dice qué se está esperando y nada lo tapa.
 */

import type { ReactNode, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { isProxyPath } from './subtitle-tracks'
import type { SafeTrack } from './usePlayer'

export interface PlayerFrameProps {
  readonly refVideo: (nodo: HTMLVideoElement | null) => void
  /**
   * El marco, para quien necesite el elemento: la pantalla completa y la Sala.
   *
   * La pantalla completa se pide sobre esta caja y no sobre el `<video>` porque
   * las capas de encima —el botón de saltar, el cartel de la espera— son sus
   * hermanas, y sobre el video se quedarían fuera de la pantalla.
   */
  readonly marco?: RefObject<HTMLDivElement | null> | undefined
  readonly onClick: () => void
  readonly onDoubleClick: (evento: ReactPointerEvent<HTMLVideoElement>) => void
  readonly poster: string | undefined
  /** El nombre accesible del video: el título, o el del catálogo. */
  readonly etiqueta: string
  readonly pistas: readonly SafeTrack[]
  readonly pintando: boolean
  readonly canvasRef: (nodo: HTMLCanvasElement | null) => void
  /** El texto de la espera, si se está esperando algo. */
  readonly espera: string | undefined
  readonly children?: ReactNode
}

export function PlayerFrame(props: PlayerFrameProps): ReactNode {
  return (
    <div className="player__frame" ref={props.marco}>
      <video
        ref={props.refVideo}
        className="player__video"
        controls={false}
        playsInline
        preload="metadata"
        poster={props.poster}
        aria-label={props.etiqueta}
        // El clic sobre la imagen pausa y el doble clic salta en los bordes o pone
        // pantalla completa en el centro: la superficie que se mira es la que se
        // toca, y quien mira el video no tiene por qué bajar la vista a los
        // mandos. Los dos gestos se separan con una espera corta —ver
        // `CLICK_DELAY_MS`— en `usePlayerGestos`.
        onClick={props.onClick}
        onDoubleClick={props.onDoubleClick}
      >
        {/* Una pista por subtítulo disponible. El navegador pinta la que esté
          marcada como `default`; el `<track>` no admite `default` dinámico, así
          que la primera —la que el proveedor prefiere— se marca desde el estado
          inicial del elemento. */}
        {props.pistas.map((pista, indice) => (
          <track
            key={pista.url}
            kind="subtitles"
            // La comprobación va **en el atributo**, no sólo al construir la lista:
            // si mañana alguien pasa pistas sin filtrar, aquí no entra una
            // dirección de fuera igualmente.
            src={isProxyPath(pista.url) ? pista.url : ''}
            srcLang={pista.lang}
            label={pista.label}
            default={indice === 0}
          />
        ))}
      </video>

      {/* El modo compatible: encima del video y en su misma caja. Va sin nombre
        accesible y sin `aria-hidden` a propósito: un canvas sin contenido de
        reserva no tiene rol ni nombre, así que no se anuncia, y lo que sí se
        anuncia es el `<video>` de debajo. */}
      {props.pintando ? <canvas className="player__canvas" ref={props.canvasRef} /> : null}

      {props.children}

      {props.espera === undefined ? null : (
        <div className="player__wait">
          {/* El cartel va en su caja y no suelto sobre el velo: el velo oscurece el
            video, y texto oscuro sobre un velo sobre fondo claro se queda por
            debajo del contraste que exige el spec. La caja trae su propio fondo,
            que es el par que la prueba de contraste mide. */}
          <p className="player__wait-box" role="status">
            <span className="player__bar" aria-hidden="true" />
            {props.espera}
          </p>
        </div>
      )}
    </div>
  )
}
