/**
 * La fila de mandos del reproductor.
 *
 * Una sola fila. Los mandos llevan el dibujo y el nombre accesible: el texto en un
 * botón de 44 px no cabe, y el nombre es lo que lee quien no ve la pantalla. El
 * `title` repite el nombre para el ratón.
 *
 * El orden es el de la mano: lo que se toca cada minuto —reproducir, saltar,
 * el volumen— a la izquierda; el reloj en el centro, y lo que se toca una vez
 * —los ajustes, el modo extendido, la pantalla completa— a la derecha.
 *
 * El menú de ajustes entra como hijo y no como propiedad: guarda su propio estado
 * —abierto, el foco, la caja— en el reproductor, y esta fila sólo le da sitio.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { formatTime, type PlayerAction, volumeFromPercent, volumePercent } from './controls'
import {
  IconoAdelante,
  IconoAtras,
  IconoExtendido,
  IconoPantallaCompleta,
  IconoPausar,
  IconoReproducir,
  IconoSalirExtendido,
  IconoSalirPantallaCompleta,
  IconoSilencio,
  IconoVolumen,
} from './icons'

export interface PlayerButtonsProps {
  readonly playing: boolean
  readonly muted: boolean
  /** Volumen entre 0 y 1, que es lo que el elemento entiende. */
  readonly volume: number
  /** El segundo que pinta el reloj. */
  readonly posicion: number
  readonly duracionS: number
  /** Ventana apretada: el volumen se muda al menú de ajustes. */
  readonly estrecho: boolean
  /** Teléfono: además, no caben los saltos de diez segundos. */
  readonly compacto: boolean
  readonly completa: boolean
  readonly extendida: boolean
  readonly act: (accion: PlayerAction) => void
  readonly onVolumen: (volume: number) => void
  readonly onAlternarExtendida: () => void
  readonly children?: ReactNode
}

export function PlayerButtons(props: PlayerButtonsProps): ReactNode {
  const rotuloPausa = props.playing
    ? t(DEFAULT_LOCALE, 'player.pause')
    : t(DEFAULT_LOCALE, 'player.play')
  const rotuloSilencio = props.muted
    ? t(DEFAULT_LOCALE, 'player.unmute')
    : t(DEFAULT_LOCALE, 'player.mute')
  const rotuloPantalla = props.completa
    ? t(DEFAULT_LOCALE, 'player.fullscreen.exit')
    : t(DEFAULT_LOCALE, 'player.fullscreen')
  const rotuloExtendido = props.extendida
    ? t(DEFAULT_LOCALE, 'player.extended.exit')
    : t(DEFAULT_LOCALE, 'player.extended')

  return (
    <div className="player__buttons">
      <button
        type="button"
        className="button button--primary player__control"
        aria-label={rotuloPausa}
        title={rotuloPausa}
        aria-keyshortcuts="Space Enter K"
        onClick={() => props.act('toggle')}
      >
        {props.playing ? <IconoPausar /> : <IconoReproducir />}
      </button>

      {/* Los saltos de diez segundos no caben en un teléfono en vertical, y ahí no
          hacen falta: el doble toque en los bordes del video los hace. Ver
          `usePlayerGestos`. */}
      {props.compacto ? null : (
        <button
          type="button"
          className="button player__control"
          aria-label={t(DEFAULT_LOCALE, 'player.back')}
          title={t(DEFAULT_LOCALE, 'player.back')}
          aria-keyshortcuts="ArrowLeft"
          onClick={() => props.act('back')}
        >
          <IconoAtras />
          <span className="player__control-step">{t(DEFAULT_LOCALE, 'player.seek.step')}</span>
        </button>
      )}

      {props.compacto ? null : (
        <button
          type="button"
          className="button player__control"
          aria-label={t(DEFAULT_LOCALE, 'player.forward')}
          title={t(DEFAULT_LOCALE, 'player.forward')}
          aria-keyshortcuts="ArrowRight"
          onClick={() => props.act('forward')}
        >
          <IconoAdelante />
          <span className="player__control-step">{t(DEFAULT_LOCALE, 'player.seek.step')}</span>
        </button>
      )}

      {/* El silencio y su barra van juntos y en un solo grupo: son el mismo mando
          en dos pasos —uno dice si suena, la otra cuánto— y la barra aparece al
          pasar por encima o al enfocar, que es cuando se va a usar. En una ventana
          estrecha el grupo entero se muda al menú de ajustes: ocupa el ancho de
          tres botones y ahí no cabe. */}
      {props.estrecho ? null : (
        <div className="player__volume">
          <button
            type="button"
            className="button player__control"
            aria-label={rotuloSilencio}
            title={rotuloSilencio}
            aria-keyshortcuts="M"
            onClick={() => props.act('mute')}
          >
            {props.muted ? <IconoSilencio /> : <IconoVolumen />}
          </button>
          {/* Va de 0 a 100 porque es lo que entiende quien oye el valor: «50», no
              «0,5». */}
          <input
            className="player__range player__slider"
            type="range"
            min={0}
            max={100}
            step={1}
            value={volumePercent(props.volume)}
            aria-label={t(DEFAULT_LOCALE, 'player.volume')}
            onChange={(evento) => props.onVolumen(volumeFromPercent(Number(evento.target.value)))}
          />
        </div>
      )}

      {/* El hueco que separa lo que se toca a menudo de lo que se toca una vez: el
          reloj y los mandos de la derecha. */}
      <span className="player__spacer" aria-hidden="true" />

      {/* El contador, con cifras de ancho fijo: sin `tabular-nums` el reloj baila
          en cada segundo y arrastra lo que tenga al lado.

          En un teléfono va sólo la posición. El total cabe en un reloj de mesa y no
          en una fila de 320 px que, con el mando de la reproducción automática, ya
          no daba: la página desbordaba 16 px. Quien necesita el total lo tiene en
          el valor que anuncia la barra —«5:12 de 24:00»—, y la barra dice dónde se
          está, que es para lo que está el reloj. */}
      <span className="player__time">
        {formatTime(props.posicion)}
        {props.compacto ? null : ` / ${formatTime(props.duracionS)}`}
      </span>

      {props.children}

      {/* El modo extendido: llena la ventana sin pedir la pantalla completa. Va
          junto al mando de pantalla completa porque son la misma familia —ver más
          grande— y el dibujo de las flechas los distingue: uno recoge el marco del
          sistema, el otro lo llena. */}
      <button
        type="button"
        className="button player__control"
        aria-label={rotuloExtendido}
        title={rotuloExtendido}
        aria-keyshortcuts="T"
        onClick={props.onAlternarExtendida}
      >
        {props.extendida ? <IconoSalirExtendido /> : <IconoExtendido />}
      </button>

      <button
        type="button"
        className="button player__control"
        aria-label={rotuloPantalla}
        title={rotuloPantalla}
        aria-keyshortcuts="F"
        onClick={() => props.act('fullscreen')}
      >
        {props.completa ? <IconoSalirPantallaCompleta /> : <IconoPantallaCompleta />}
      </button>
    </div>
  )
}
