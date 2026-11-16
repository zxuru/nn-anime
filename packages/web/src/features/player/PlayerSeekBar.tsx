/**
 * La barra de progreso: carril, búfer, lo reproducido y el pulgar.
 *
 * Va por capas porque el navegador no deja pedirle dos tramos de color al carril
 * de un `input`: lo que hay en búfer debajo, lo ya reproducido encima y el
 * `input` arriba del todo, transparente, para no perder ni el arrastre ni el
 * teclado. Pintarlo él mismo obligaría a un degradado calculado en cada vuelta.
 *
 * El `aria-valuetext` dice el tiempo **en palabras** y no el número de segundos:
 * `0:31 de 24:55` es lo que se lee, y «31 segundos de 1495 segundos» no es lo que
 * nadie quiere oír.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { SkipInterval } from '@rona/core/schema'
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react'
import { t } from '../../i18n'
import { formatTime, spokenTime } from './controls'

/**
 * Lo que ocupa una parte del total, en por ciento, sin salirse de la barra.
 *
 * El guardián de los no-números no es adorno: la duración llega del elemento y
 * vale cero hasta que hay metadatos, y `0/0` daría `NaN` en el `width`, que el
 * navegador descarta dejando el carril sin pintar.
 */
export function porcentaje(valor: number, total: number): number {
  if (!Number.isFinite(valor) || !Number.isFinite(total) || total <= 0) return 0

  return Math.min(Math.max((valor / total) * 100, 0), 100)
}

export interface PlayerSeekBarProps {
  readonly posicion: number
  readonly duracion: number
  readonly bufferedS: number
  /** El segundo bajo el puntero, si está sobre la barra. */
  readonly sobreBarra: number | undefined
  /**
   * Los intervalos saltables del episodio, si se conocen.
   *
   * Se marcan en el carril como contexto —dónde está el opening antes de llegar a
   * él— y sólo se pintan con datos: sin ellos la barra queda exactamente como
   * estaba.
   */
  readonly intervalos?: readonly SkipInterval[] | undefined
  /** Se arrastra: el dedo manda y el salto se pide en el acto. */
  readonly onArrastrar: (segundos: number) => void
  /** Se suelta el pulgar, o se sale con el teclado. */
  readonly onSoltar: () => void
  readonly onMoverPuntero: (evento: ReactPointerEvent<HTMLDivElement>) => void
  readonly onSalir: () => void
}

export function PlayerSeekBar(props: PlayerSeekBarProps): ReactNode {
  return (
    <div
      className="player__seek"
      onPointerMove={props.onMoverPuntero}
      onPointerLeave={props.onSalir}
    >
      <span className="player__track" aria-hidden="true">
        <span
          className="player__buffer"
          style={{ width: `${porcentaje(props.bufferedS, props.duracion)}%` }}
        />
        <span
          className="player__played"
          style={{ width: `${porcentaje(props.posicion, props.duracion)}%` }}
        />
        {/* Los intervalos saltables, marcados en el carril: dicen dónde está el
            opening antes de llegar a él. Van por debajo del `input`, que es quien
            recibe el gesto. */}
        {(props.intervalos ?? []).map((intervalo) => (
          <span
            key={`${intervalo.type}-${intervalo.start}-${intervalo.end}`}
            className="player__skip-marker"
            style={{
              insetInlineStart: `${porcentaje(intervalo.start, props.duracion)}%`,
              inlineSize: `${porcentaje(intervalo.end - intervalo.start, props.duracion)}%`,
            }}
          />
        ))}
      </span>

      {/* Una barra de progreso de verdad, y un `<input type="range">`: se
          arrastra, se toca y se recorre con el teclado sin escribir nada. */}
      <input
        className="player__range"
        type="range"
        min={0}
        max={props.duracion}
        step={0.1}
        value={props.posicion}
        disabled={props.duracion === 0}
        aria-label={t(DEFAULT_LOCALE, 'player.seek')}
        aria-valuetext={`${spokenTime(props.posicion)} de ${spokenTime(props.duracion)}`}
        onChange={(evento) => props.onArrastrar(Number(evento.target.value))}
        onPointerUp={props.onSoltar}
        onPointerCancel={props.onSoltar}
        onBlur={props.onSoltar}
        onKeyUp={props.onSoltar}
      />

      {props.sobreBarra === undefined ? null : (
        <span
          className="player__tooltip"
          style={{ left: `${porcentaje(props.sobreBarra, props.duracion)}%` }}
          aria-hidden="true"
        >
          {formatTime(props.sobreBarra)}
        </span>
      )}
    </div>
  )
}
