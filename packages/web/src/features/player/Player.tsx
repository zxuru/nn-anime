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

/**
 * Los atajos que el reproductor escucha, con su tecla y lo que hace.
 *
 * Es la ayuda que se pinta debajo de los controles, y por eso está en dos
 * piezas: la tecla —que se dibuja como una tecla— y su frase. Antes era una
 * sola línea de texto corrido y no se leía como lo que es: teclas que se pueden
 * pulsar.
 *
 * El orden es el que se aprende, no el del `switch` de `keyAction`: primero lo
 * que hace todo el mundo, y al final lo que se busca una vez.
 */
const ATAJOS: readonly { readonly teclas: readonly string[]; readonly hace: string }[] = [
  { teclas: ['player.key.space', 'player.key.enter', 'player.key.k'], hace: 'player.key.toggle' },
  { teclas: ['player.key.left', 'player.key.right'], hace: 'player.key.seek' },
  { teclas: ['player.key.up', 'player.key.down'], hace: 'player.key.volume' },
  { teclas: ['player.key.m'], hace: 'player.key.mute' },
  { teclas: ['player.key.f'], hace: 'player.key.fullscreen' },
]

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

  /**
   * Suena y no se ve.
   *
   * El audio puede reproducirse con la imagen en negro —un decodificador que no
   * arranca, una GPU que falla— y ni el elemento ni hls.js lo dicen. Se espera a
   * llevar dos segundos reproduciendo para no avisar durante la carga, que es
   * cuando `videoWidth` todavía es cero en cualquier reproducción.
   */
  const sinImagen = state.playing && state.videoWidth === 0 && state.positionS > 2

  /**
   * Lo que se está esperando, si se está esperando algo.
   *
   * Dos esperas distintas y una sola pregunta: al principio no hay ni
   * metadatos, y a mitad se acabaron los datos. Se cuenta encima del video, que
   * es donde está mirando quien la sufre; el texto suelto de antes quedaba
   * debajo de los controles y no se veía.
   */
  const espera = state.loading
    ? t(DEFAULT_LOCALE, 'player.loading')
    : state.buffering
      ? t(DEFAULT_LOCALE, 'player.buffering')
      : undefined

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
      {/* El marco y el video, con la espera encima del segundo. El cartel va
          dentro del marco y no en el flujo: debajo de los controles no lo veía
          nadie, y lo que hay que decir es justo que la imagen todavía no está. */}
      <div className="player__stage">
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

        {espera === undefined ? null : (
          <div className="player__wait">
            {/* El cartel va en su caja y no suelto sobre el velo: el velo oscurece
                el video, y texto oscuro sobre un velo sobre fondo claro se queda
                por debajo del contraste que exige el spec. La caja trae su propio
                fondo, que es el par que la prueba de contraste mide. */}
            <p className="player__wait-box" role="status">
              <span className="player__bar" aria-hidden="true" />
              {espera}
            </p>
          </div>
        )}
      </div>

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
        <button
          type="button"
          className="button button--primary"
          aria-keyshortcuts="Space Enter K"
          onClick={() => act('toggle')}
        >
          {state.playing ? t(DEFAULT_LOCALE, 'player.pause') : t(DEFAULT_LOCALE, 'player.play')}
        </button>
        <button
          type="button"
          className="button"
          aria-keyshortcuts="ArrowLeft"
          onClick={() => act('back')}
        >
          {t(DEFAULT_LOCALE, 'player.back')}
        </button>
        <button
          type="button"
          className="button"
          aria-keyshortcuts="ArrowRight"
          onClick={() => act('forward')}
        >
          {t(DEFAULT_LOCALE, 'player.forward')}
        </button>
        <button type="button" className="button" aria-keyshortcuts="M" onClick={() => act('mute')}>
          {state.muted ? t(DEFAULT_LOCALE, 'player.unmute') : t(DEFAULT_LOCALE, 'player.mute')}
        </button>
        <button
          type="button"
          className="button"
          aria-keyshortcuts="F"
          onClick={() => act('fullscreen')}
        >
          {t(DEFAULT_LOCALE, 'player.fullscreen')}
        </button>
      </div>

      {sinImagen ? <p className="search__error">{t(DEFAULT_LOCALE, 'player.sinImagen')}</p> : null}

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

      {/* Las teclas, como teclas. Un `kbd` por tecla y la frase al lado: la
          ayuda se lee de un vistazo y no hace falta descifrar una línea. */}
      <div className="player__keys">
        <p className="player__keys-title">{t(DEFAULT_LOCALE, 'player.keys')}</p>
        <ul className="player__keys-list">
          {ATAJOS.map((atajo) => (
            <li className="player__key" key={atajo.hace}>
              <span className="player__key-caps">
                {atajo.teclas.map((tecla) => (
                  <kbd className="player__key-cap" key={tecla}>
                    {t(DEFAULT_LOCALE, tecla)}
                  </kbd>
                ))}
              </span>
              <span className="player__key-does">{t(DEFAULT_LOCALE, atajo.hace)}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* La atribución sólo aparece cuando se usa la biblioteca: hls.js es
          Apache 2.0 y su licencia pide conservar el aviso. */}
      {needsHls(props.kind) ? (
        <p className="card__meta">{t(DEFAULT_LOCALE, 'player.attribution')}</p>
      ) : null}
    </section>
  )
}
