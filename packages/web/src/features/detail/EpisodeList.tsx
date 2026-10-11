/**
 * Lista de episodios.
 *
 * Es una lista ordenada y no una rejilla: el número importa y el orden importa,
 * y `<ol>` dice las dos cosas sin ayuda. Cada episodio muestra su modo, porque
 * un título puede tener el 3 en subtitulado y el 4 doblado, y elegir sin saberlo
 * es la forma más rápida de que la reproducción falle.
 *
 * **Cada fila es un enlace al reproductor**, no una fila que parece pulsable: el
 * episodio es la acción de la pantalla, y un `<li>` con `onClick` no se puede
 * abrir en otra pestaña, ni copiar, ni recorrer con el teclado sin inventar nada.
 * El modo elegido en la ficha viaja en la dirección.
 *
 * La marca de visto es del **episodio**, no del par episodio y modo: verlo en
 * subtitulado es haberlo visto. Un episodio a medias lleva su barra con la
 * proporción que calculó el servidor, y uno del que no se sabe la duración no
 * lleva ni barra ni marca: inventar el dato sería peor que no decirlo.
 *
 * **La lista se pinta por ventanas de cien.** Una serie de mil ciento ochenta
 * episodios no se busca leyendo: se busca saltando al número, y mil filas en el
 * documento no ayudan a ninguna de las dos cosas. Con cien episodios o menos no
 * hay controles, porque una barra de paginación para doce filas es un mueble.
 */

import type { WatchedEpisodePayload } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { Episode } from '@nn-anime/core/models'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { Link } from '../../router'
import { type PlayMode, watchPath } from '../player/watch-route'
import {
  EPISODE_WINDOW,
  type EpisodeWindow,
  watchedInWindow,
  windowAt,
  windowForNumber,
} from './episode-window'
import { formatDuration, watchedPercent } from './useDetail'

/**
 * Las claves del catálogo, escritas una a una.
 *
 * Una clave compuesta con el modo —`detail.mode.${modo}`— funcionaría igual en
 * tiempo de ejecución y escondería las claves al buscador de textos sin usar:
 * acabarían borradas del catálogo por parecer huérfanas.
 */
const MODE_KEYS = {
  sub: 'detail.mode.sub',
  dub: 'detail.mode.dub',
  raw: 'detail.mode.raw',
} as const

export interface EpisodeListProps {
  readonly episodes: readonly Episode[]
  /** El modo con el que se abre el reproductor. Sin él, el que elija el reproductor. */
  readonly mode?: PlayMode
  /** Lo que ya se vio de este título, por número de episodio. */
  readonly watched?: readonly WatchedEpisodePayload[]
}

/** Lo que se pinta en la fila por haberlo visto: terminado, a medias o nada. */
type Marca = { readonly tipo: 'visto' } | { readonly tipo: 'progreso'; readonly percent: number }

/**
 * La marca de una fila.
 *
 * Sin duración no hay proporción, y sin proporción no se marca nada: un
 * episodio abierto y cerrado en el segundo uno no está «a medias» de nada.
 */
function marcaDe(visto: WatchedEpisodePayload | undefined): Marca | undefined {
  if (visto === undefined) return undefined
  if (visto.finished) return { tipo: 'visto' }
  if (visto.durationS <= 0) return undefined

  return { tipo: 'progreso', percent: watchedPercent(visto.ratio) }
}

/**
 * Los controles de una lista larga.
 *
 * Sólo aparecen cuando hay más de una ventana: con doce episodios, una barra de
 * paginación es un mueble que nadie usa. El salto es un formulario y no un campo
 * suelto para que la tecla Intro funcione sin JavaScript de más, y lleva su
 * etiqueta porque un número sin nombre no dice qué se escribe ahí.
 */
function WindowControls(props: {
  readonly total: number
  readonly window: EpisodeWindow
  readonly seen: number
  readonly onWindow: (index: number) => void
  readonly onJump: (number: number) => void
}): ReactNode {
  const [salto, setSalto] = useState('')
  const primero = props.window.start + 1
  const ultimo = props.window.end

  return (
    <div className="episodes__windows">
      <button
        type="button"
        className="button"
        disabled={props.window.start === 0}
        onClick={() => props.onWindow(props.window.start / EPISODE_WINDOW - 1)}
      >
        {t(DEFAULT_LOCALE, 'detail.window.previous')}
      </button>

      <span className="episodes__range">
        {t(DEFAULT_LOCALE, 'detail.window.range', { from: primero, to: ultimo })}
      </span>

      <button
        type="button"
        className="button"
        disabled={props.window.end >= props.total}
        onClick={() => props.onWindow(props.window.start / EPISODE_WINDOW + 1)}
      >
        {t(DEFAULT_LOCALE, 'detail.window.next')}
      </button>

      <form
        className="episodes__jump"
        onSubmit={(event) => {
          event.preventDefault()
          const numero = Number(salto)
          if (Number.isInteger(numero) && numero > 0) props.onJump(numero)
        }}
      >
        <label className="field__label" htmlFor="salto-episodio">
          {t(DEFAULT_LOCALE, 'detail.window.jump')}
        </label>
        <input
          id="salto-episodio"
          className="field__input episodes__input"
          type="number"
          min={1}
          max={props.total}
          value={salto}
          onChange={(event) => setSalto(event.target.value)}
        />
        <button type="submit" className="button">
          {t(DEFAULT_LOCALE, 'detail.window.go')}
        </button>
      </form>

      <p className="episodes__watched">
        {t(DEFAULT_LOCALE, 'detail.window.watched', {
          seen: props.seen,
          total: ultimo - props.window.start,
        })}
      </p>
    </div>
  )
}

export function EpisodeList(props: EpisodeListProps): ReactNode {
  const [ventana, setVentana] = useState(0)
  /**
   * El episodio al que hay que llevar el foco después de un salto.
   *
   * Es estado y no una llamada directa porque el foco tiene que ponerse **cuando
   * la fila ya está pintada**: al saltar, la ventana cambia en el mismo paso, y
   * buscar el elemento antes de que exista no encuentra nada.
   */
  const [foco, setFoco] = useState<number | undefined>(undefined)
  const lista = useRef<HTMLOListElement | null>(null)

  useEffect(() => {
    if (foco === undefined) return

    const fila = lista.current?.querySelector(`#episodio-${foco} a`)
    if (fila instanceof HTMLElement) fila.focus()
    setFoco(undefined)
  }, [foco])

  if (props.episodes.length === 0) {
    return <p className="empty">{t(DEFAULT_LOCALE, 'detail.noEpisodes')}</p>
  }

  const total = props.episodes.length
  const numeros = props.episodes.map((episode) => episode.number)
  // Con una sola ventana no hay controles ni recorte: la lista se pinta entera y
  // el navegador no tiene que montar cien filas para nada.
  const conVentanas = total > EPISODE_WINDOW
  const rango = conVentanas ? windowAt(ventana, total) : { start: 0, end: total }
  const visibles = conVentanas ? props.episodes.slice(rango.start, rango.end) : props.episodes

  const vistos = new Map((props.watched ?? []).map((fila) => [fila.number, fila]))

  const irA = (numero: number): void => {
    setVentana(windowForNumber(numero, numeros))
    setFoco(numero)
  }

  return (
    <>
      {conVentanas ? (
        <WindowControls
          total={total}
          window={rango}
          seen={watchedInWindow(rango, numeros, props.watched ?? [])}
          onWindow={setVentana}
          onJump={irA}
        />
      ) : null}

      <ol className="episodes" start={rango.start + 1} ref={lista}>
        {visibles.map((episode) => {
          const duracion = formatDuration(episode.durationS)
          const marca = marcaDe(vistos.get(episode.number))

          return (
            <li
              key={`${episode.ref.providerId}:${episode.ref.value}`}
              id={`episodio-${episode.number}`}
            >
              <Link
                className={marca?.tipo === 'visto' ? 'episode episode--visto' : 'episode'}
                to={watchPath(episode.ref.providerId, episode.ref.value, {
                  ...(props.mode === undefined ? {} : { mode: props.mode }),
                  // El título viaja con el enlace: la lista lo trae en cada
                  // episodio, y sin él el reproductor tenía que adivinarlo de la
                  // referencia y con jkanime adivinaba mal.
                  anime: episode.animeRef.value,
                })}
              >
                <span className="episode__number">
                  {t(DEFAULT_LOCALE, 'detail.episode', { number: episode.number })}
                </span>
                {episode.title === undefined ? null : (
                  <span className="episode__title">{episode.title}</span>
                )}
                {marca?.tipo === 'progreso' ? (
                  <progress
                    className="episode__progress"
                    value={marca.percent}
                    max={100}
                    aria-label={t(DEFAULT_LOCALE, 'detail.episode.progress', {
                      percent: marca.percent,
                    })}
                  />
                ) : null}
                {duracion === undefined ? null : <span className="episode__time">{duracion}</span>}
                {marca?.tipo === 'visto' ? (
                  // La palabra, no sólo el color: el estado tiene que leerse también
                  // sin distinguir colores.
                  <span className="badge badge--visto">
                    {t(DEFAULT_LOCALE, 'detail.episode.watched')}
                  </span>
                ) : null}
                <span className="badge">{t(DEFAULT_LOCALE, MODE_KEYS[episode.mode])}</span>
              </Link>
            </li>
          )
        })}
      </ol>
    </>
  )
}
