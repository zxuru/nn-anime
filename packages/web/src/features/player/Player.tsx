/**
 * Reproductor de la página.
 *
 * Usa el `<video>` del navegador y `hls.js` sólo cuando la fuente es HLS. Los
 * controles son propios porque los del navegador no se pueden atar a los atajos
 * del spec ni anunciarse por `aria-live`, pero **el elemento sigue siendo un
 * `<video>`**: sin `controls`, con controles nuestros, y con el teclado como
 * camino principal.
 *
 * La región `aria-live` es `polite` y no `assertive`: el estado del reproductor
 * cambia constantemente, y una región que interrumpe cada segundo hace que la
 * página sea inservible con un lector de pantalla.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { announcement, formatTime, keyAction, needsHls } from './controls'
import { isProxyPath } from './subtitle-tracks'
import { type SafeTrack, usePlayer } from './usePlayer'

export interface PlayerProps {
  /** URL del proxy: el ticket, nunca la del upstream. */
  readonly url: string
  readonly kind: string
  readonly title?: string | undefined
  /** Pistas que el navegador puede pintar, ya filtradas. */
  readonly tracks?: readonly SafeTrack[] | undefined
  /** Se llama al empezar a reproducir de verdad, no al cargar la página. */
  readonly onPlay?: (() => void) | undefined
  readonly onPause?: (() => void) | undefined
  readonly onProgress?: ((positionS: number, durationS: number) => void) | undefined
  /** Segundo en el que empezar, al reanudar o al cambiar de modo. */
  readonly startAtS?: number | undefined
}

export function Player(props: PlayerProps): ReactNode {
  // Los avisos de reproducción, pausa y avance salen de los eventos del propio
  // elemento, no del render: llamarlos al pintar los dispararía en cada vuelta.
  const { state, videoRef, act, seekTo } = usePlayer({
    url: props.url,
    kind: props.kind,
    ...(props.onPlay === undefined ? {} : { onPlay: props.onPlay }),
    ...(props.onPause === undefined ? {} : { onPause: props.onPause }),
    ...(props.onProgress === undefined ? {} : { onProgress: props.onProgress }),
    ...(props.startAtS === undefined ? {} : { startAtS: props.startAtS }),
  })
  const pistas = props.tracks ?? []

  /**
   * La posición mientras se arrastra la barra, si se está arrastrando.
   *
   * Sin esto, la barra es un campo controlado por el estado del reproductor y el
   * pulgar vuelve a su sitio entre dos avisos del elemento —el `timeupdate` llega
   * cuatro veces por segundo—: se ve temblar y cuesta soltarlo donde se quiere.
   * Mientras dura el arrastre manda el dedo; al soltar, manda el video.
   */
  const [arrastre, setArrastre] = useState<number | undefined>(undefined)

  const duracion = Number.isFinite(state.durationS) && state.durationS > 0 ? state.durationS : 0
  const posicion = Math.min(arrastre ?? state.positionS, duracion)

  // El teclado se escucha en la ventana: el foco puede estar en el propio video
  // o en la página, y obligar a enfocar el reproductor para usar las flechas es
  // una molestia que no hace falta. `keyAction` decide cuándo no hacer nada.
  useEffect(() => {
    const alPulsar = (evento: KeyboardEvent): void => {
      const accion = keyAction({
        key: evento.key,
        tagName: (evento.target as HTMLElement | null)?.tagName,
        isContentEditable: (evento.target as HTMLElement | null)?.isContentEditable,
        ctrlKey: evento.ctrlKey,
        metaKey: evento.metaKey,
        altKey: evento.altKey,
      })

      if (accion === undefined) return

      evento.preventDefault()
      act(accion)
    }

    window.addEventListener('keydown', alPulsar)

    return () => window.removeEventListener('keydown', alPulsar)
  }, [act])

  return (
    <section className="player">
      <video
        ref={videoRef}
        className="player__video"
        controls={false}
        playsInline
        preload="metadata"
        aria-label={props.title ?? t(DEFAULT_LOCALE, 'player.label')}
      >
        {/* Una pista por subtítulo disponible. El navegador pinta la que esté
            marcada como `default`; el `<track>` no admite `default` dinámico, así
            que la primera —la que el proveedor prefiere— se marca desde el
            estado inicial del elemento. */}
        {pistas.map((pista, indice) => (
          <track
            key={pista.url}
            kind="subtitles"
            // La comprobación va **en el atributo**, no sólo al construir la
            // lista: si mañana alguien pasa pistas sin filtrar, aquí no entra una
            // dirección de fuera igualmente.
            src={isProxyPath(pista.url) ? pista.url : ''}
            srcLang={pista.lang}
            label={pista.label}
            default={indice === 0}
          />
        ))}
      </video>

      <div className="player__seek">
        {/* Una barra de progreso de verdad, y un `<input type="range">`: se
            arrastra, se toca y se recorre con el teclado sin escribir nada. El
            `aria-valuetext` dice el tiempo, porque un número de segundos no es
            lo que nadie quiere oír. */}
        <input
          className="player__range"
          type="range"
          min={0}
          max={duracion}
          step={0.1}
          value={posicion}
          disabled={duracion === 0}
          aria-label={t(DEFAULT_LOCALE, 'player.seek')}
          aria-valuetext={`${formatTime(posicion)} / ${formatTime(duracion)}`}
          onChange={(evento) => {
            const segundo = Number(evento.target.value)
            setArrastre(segundo)
            seekTo(segundo)
          }}
          onPointerUp={() => setArrastre(undefined)}
          onPointerCancel={() => setArrastre(undefined)}
          onBlur={() => setArrastre(undefined)}
          onKeyUp={() => setArrastre(undefined)}
        />

        <span className="player__time">
          {formatTime(posicion)} / {formatTime(state.durationS)}
        </span>
      </div>

      <div className="player__controls">
        <button type="button" className="button button--primary" onClick={() => act('toggle')}>
          {state.playing ? t(DEFAULT_LOCALE, 'player.pause') : t(DEFAULT_LOCALE, 'player.play')}
        </button>
        <button type="button" className="button" onClick={() => act('back')}>
          {t(DEFAULT_LOCALE, 'player.back')}
        </button>
        <button type="button" className="button" onClick={() => act('forward')}>
          {t(DEFAULT_LOCALE, 'player.forward')}
        </button>
        <button type="button" className="button" onClick={() => act('mute')}>
          {state.muted ? t(DEFAULT_LOCALE, 'player.unmute') : t(DEFAULT_LOCALE, 'player.mute')}
        </button>
        <button type="button" className="button" onClick={() => act('fullscreen')}>
          {t(DEFAULT_LOCALE, 'player.fullscreen')}
        </button>
      </div>

      {state.loading ? <p className="empty">{t(DEFAULT_LOCALE, 'player.loading')}</p> : null}

      {state.error === undefined ? null : (
        <p className="search__error">
          {t(DEFAULT_LOCALE, 'player.error', { message: state.error })}
        </p>
      )}

      {/* La misma clase que usa la búsqueda para su anuncio: la región existe
          para quien no ve la pantalla, y el estilo la deja fuera del flujo. */}
      <p className="search__status" aria-live="polite">
        {announcement(state)}
      </p>

      {pistas.length === 0 ? null : (
        <p className="card__meta">{t(DEFAULT_LOCALE, 'player.tracks', { count: pistas.length })}</p>
      )}

      <p className="card__meta">{t(DEFAULT_LOCALE, 'player.shortcuts')}</p>

      {/* La atribución sólo aparece cuando se usa la biblioteca: hls.js es
          Apache 2.0 y su licencia pide conservar el aviso. */}
      {needsHls(props.kind) ? (
        <p className="card__meta">{t(DEFAULT_LOCALE, 'player.attribution')}</p>
      ) : null}
    </section>
  )
}
