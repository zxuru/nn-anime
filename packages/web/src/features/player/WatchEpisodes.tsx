/**
 * La lista de episodios de la pantalla de reproducción.
 *
 * Es la columna de al lado: mientras se ve un episodio, tener a mano el resto es
 * lo que hace que cambiar de episodio no sea volver a la ficha. La fila del que se
 * está viendo va marcada con `aria-current="page"` —y es un `<span>`, no un
 * enlace: un enlace a lo que ya se está reproduciendo no lleva a ninguna parte— y
 * la lista se desplaza sola hasta dejarla a la vista.
 *
 * Se pintan **todos** los episodios del proveedor: la ventana de cien de la ficha
 * no hace falta aquí, porque la lista se desplaza dentro de su columna y no
 * empuja la página. Un título de dos mil episodios montaría dos mil filas, y eso
 * es lo único que habría que vigilar el día que aparezca.
 *
 * El modo con el que se está viendo viaja en cada enlace, igual que en las
 * flechas: cambiar a doblado y saltar al 5 tiene que abrir el 5 en doblado.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { Episode } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { t } from '../../i18n'
import { episodeLabel } from '../../lib/document-title'
import { Link } from '../../router'
import { type PlayMode, watchPath } from './watch-route'

export interface WatchEpisodesProps {
  readonly episodes: readonly Episode[]
  readonly providerId: string
  readonly currentRef: string
  readonly mode: PlayMode
  /** La referencia del título, que viaja en cada enlace. */
  readonly animeRef: string
}

export function WatchEpisodes(props: WatchEpisodesProps): ReactNode {
  const lista = useRef<HTMLOListElement | null>(null)
  const propios = props.episodes.filter((episodio) => episodio.ref.providerId === props.providerId)
  const cuantos = propios.length

  /**
   * La fila del episodio que se está viendo, a la vista.
   *
   * Se lleva el desplazamiento a mano —al centro de la lista— y no con
   * `scrollIntoView`: aquello desplaza **también** la página cuando el contenedor
   * no da de sí, así que al abrir el episodio 40 la pantalla aparecía con el video
   * a medio camino. Sin `behavior: smooth` a propósito: es una colocación, no una
   * animación, y el spec pide respetar el movimiento reducido.
   *
   * `cuantos` no se lee en el cuerpo y va en las dependencias a propósito: la
   * lista llega **después** del primer render —la pide una petición— y sin ella el
   * efecto se quedaría con la lista vacía y no llevaría la vista a ninguna parte.
   * El episodio actual no hace falta en la lista: la pantalla se vuelve a montar
   * entera al cambiar de episodio —lleva la referencia en la `key`—, así que la
   * fila marcada siempre se coloca en el montaje.
   */
  useEffect(() => {
    // Sin filas no hay nada que colocar: la lista todavía no llegó, y es lo que
    // hace que el efecto vuelva a correr cuando llegue.
    if (cuantos === 0) return

    const contenedor = lista.current
    const actual = contenedor?.querySelector('[aria-current="page"]')

    if (!(contenedor instanceof HTMLElement) || !(actual instanceof HTMLElement)) return

    contenedor.scrollTop = Math.max(actual.offsetTop - contenedor.clientHeight / 2, 0)
  }, [cuantos])

  if (cuantos === 0) return null

  return (
    <>
      <h2 className="watch__aside-title">{t(DEFAULT_LOCALE, 'player.episodes')}</h2>
      <ol className="watch__list" ref={lista} aria-label={t(DEFAULT_LOCALE, 'player.episodes')}>
        {propios.map((episodio) => {
          const etiqueta =
            episodeLabel(episodio.number, episodio.title) ??
            t(DEFAULT_LOCALE, 'player.episode', { number: episodio.number })
          const contenido = (
            <>
              <span className="watch__list-number">{episodio.number}</span>
              {episodio.title === undefined ? null : (
                <span className="watch__list-title">{episodio.title}</span>
              )}
            </>
          )

          return (
            <li key={`${episodio.ref.providerId}:${episodio.ref.value}`}>
              {episodio.ref.value === props.currentRef ? (
                // El episodio que ya se está viendo: un enlace de verdad —y no un
                // texto suelto, que no admite nombre accesible— con
                // `aria-current`. Lleva a la misma dirección, así que pulsarlo no
                // cambia de episodio; lo que hace es decir cuál es el actual.
                <Link
                  className="watch__list-item"
                  ariaLabel={etiqueta}
                  ariaCurrent="page"
                  to={watchPath(episodio.ref.providerId, episodio.ref.value, {
                    mode: props.mode,
                    anime: props.animeRef,
                  })}
                >
                  {contenido}
                </Link>
              ) : (
                <Link
                  className="watch__list-item"
                  ariaLabel={etiqueta}
                  to={watchPath(episodio.ref.providerId, episodio.ref.value, {
                    mode: props.mode,
                    anime: props.animeRef,
                  })}
                >
                  {contenido}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </>
  )
}
