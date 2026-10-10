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
import { useEffect } from 'react'
import { t } from '../../i18n'
import { announcement, formatTime, keyAction, needsHls } from './controls'
import { usePlayer } from './usePlayer'

export interface PlayerProps {
  /** URL del proxy: el ticket, nunca la del upstream. */
  readonly url: string
  readonly kind: string
  readonly title?: string | undefined
}

export function Player(props: PlayerProps): ReactNode {
  const { state, videoRef, act } = usePlayer({ url: props.url, kind: props.kind })

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
      />

      <div className="player__controls">
        <button type="button" className="button" onClick={() => act('toggle')}>
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

        <span className="player__time">
          {formatTime(state.positionS)} / {formatTime(state.durationS)}
        </span>
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

      <p className="card__meta">{t(DEFAULT_LOCALE, 'player.shortcuts')}</p>

      {/* La atribución sólo aparece cuando se usa la biblioteca: hls.js es
          Apache 2.0 y su licencia pide conservar el aviso. */}
      {needsHls(props.kind) ? (
        <p className="card__meta">{t(DEFAULT_LOCALE, 'player.attribution')}</p>
      ) : null}
    </section>
  )
}
